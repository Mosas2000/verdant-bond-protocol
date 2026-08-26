import { Injectable } from '@nestjs/common';
import { ContractService } from '../stellar/contract.service';
import { StellarService } from '../stellar/stellar.service';
import { IpfsService } from './ipfs.service';
import { NonceService } from '../common/services/nonce.service';
import { RedisService } from '../common/services/redis.service';
import { SigningKeyProvider } from '../common/services/signing-key.provider';
import { nativeToScVal, scValToNative, Address } from '@stellar/stellar-sdk';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectResponse, ProjectStatusEnum, DocumentUploadResponse } from './interfaces/project.interface';
import { encodeCid, decodeCid, toBigIntString } from '../common/utils';
import { ConfigService } from '../config/config.service';



@Injectable()
export class ProjectsService {
  constructor(
    private readonly contractService: ContractService,
    private readonly stellarService: StellarService,
    private readonly ipfsService: IpfsService,
    private readonly nonceService: NonceService,
    private readonly redis: RedisService,
    private readonly signingKeys: SigningKeyProvider,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: CreateProjectDto, ownerAddress: string): Promise<ProjectResponse> {
    const metadata = {
      name: dto.name,
      methodology: dto.methodology,
      country: dto.country,
      location: dto.location,
      totalAreaHa: dto.totalAreaHa,
      carbonSequestrationEstimate: dto.carbonSequestrationEstimate,
      blueCarbon: dto.blueCarbon ?? false,
      biodiversityCorridor: dto.biodiversityCorridor ?? false,
      description: dto.description ?? '',
      timestamp: new Date().toISOString(),
    };

    const ipfsResult = await this.ipfsService.uploadJson(metadata);
    const ipfsHash = encodeCid(ipfsResult.hash);

    const ownerSecret = this.signingKeys.userSecret();
    const nonce = await this.nonceService.next(this.configService.getProjectRegistryAddress(), ownerAddress);

    const { result, transactionHash } = await this.contractService.invokeContractMethod(
      this.configService.getProjectRegistryAddress(), 'register_project', ownerSecret,
      [
        Address.fromString(ownerAddress).toScVal(),
        nativeToScVal(ipfsHash, { type: 'bytes' }),
        nativeToScVal(dto.methodology, { type: 'symbol' }),
        nativeToScVal(dto.country, { type: 'symbol' }),
      ],
      nonce,
    );

    const projectId = Number(scValToNative(result));
    const project = await this.buildProjectResponse(projectId);

    await this.redis.setEx(`project:${projectId}`, 300, JSON.stringify(project));

    return { ...project, transactionHash };
  }

  async findAll(page = 1, limit = 20) {
    const cacheKey = `projects:${page}:${limit}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    let total = 0;
    try {
      const countScVal = await this.contractService.simulateCall({
        contractAddress: this.configService.getProjectRegistryAddress(), method: 'project_count', args: [],
      });
      total = Number(scValToNative(countScVal));
    } catch {}

    const projects: ProjectResponse[] = [];
    const start = (page - 1) * limit;
    const end = Math.min(start + limit, total);

    for (let id = 1; id <= total; id++) {
      if (id > start && id <= end) {
        try {
          projects.push(await this.buildProjectResponse(id));
        } catch {}
      }
    }

    const result = {
      data: projects,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };

    await this.redis.setEx(cacheKey, 60, JSON.stringify(result));
    return result;
  }

  async findOne(id: number): Promise<ProjectResponse> {
    const cached = await this.redis.get(`project:${id}`);
    if (cached) return JSON.parse(cached);

    const project = await this.buildProjectResponse(id);
    await this.redis.setEx(`project:${id}`, 300, JSON.stringify(project));
    return project;
  }

  async approve(id: number): Promise<ProjectResponse> {
    const adminSecret = this.getAdminSecret();
    const adminAddress = this.stellarService.getKeypairFromSecret(adminSecret).publicKey();
    const nonce = await this.nonceService.next(this.configService.getProjectRegistryAddress(), adminAddress);

    await this.contractService.invokeContractMethod(
      this.configService.getProjectRegistryAddress(), 'approve_project', adminSecret,
      [Address.fromString(adminAddress).toScVal(), nativeToScVal(BigInt(id), { type: 'u64' })],
      nonce,
    );

    await this.redis.del(`project:${id}`);
    return this.buildProjectResponse(id);
  }

  async reject(id: number): Promise<ProjectResponse> {
    const adminSecret = this.getAdminSecret();
    const adminAddress = this.stellarService.getKeypairFromSecret(adminSecret).publicKey();
    const nonce = await this.nonceService.next(this.configService.getProjectRegistryAddress(), adminAddress);

    await this.contractService.invokeContractMethod(
      this.configService.getProjectRegistryAddress(), 'reject_project', adminSecret,
      [Address.fromString(adminAddress).toScVal(), nativeToScVal(BigInt(id), { type: 'u64' })],
      nonce,
    );

    await this.redis.del(`project:${id}`);
    return this.buildProjectResponse(id);
  }

  async uploadDocuments(id: number, files: any[]): Promise<DocumentUploadResponse> {
    const documentHashes: string[] = [];
    const gatewayUrls: string[] = [];

    for (const file of files) {
      const result = await this.ipfsService.uploadFile(file.buffer, file.originalname);
      documentHashes.push(result.hash);
      gatewayUrls.push(result.gatewayUrl);
    }

    const existing = await this.redis.get(`project:${id}:documents`);
    const allHashes = existing ? [...JSON.parse(existing), ...documentHashes] : documentHashes;
    await this.redis.set(`project:${id}:documents`, JSON.stringify(allHashes));

    return { projectId: id, documentHashes, gatewayUrls };
  }

  private async buildProjectResponse(id: number): Promise<ProjectResponse> {
    const projectScVal = await this.contractService.simulateCall({
      contractAddress: this.configService.getProjectRegistryAddress(), method: 'get_project',
      args: [nativeToScVal(BigInt(id), { type: 'u64' })],
    });

    const project = scValToNative(projectScVal) as any[];

    const metadataIpfsHash = decodeCid(project[2] as Uint8Array);
    let metadata: any = {};
    try {
      metadata = await this.ipfsService.getContent(metadataIpfsHash);
    } catch {}

    return {
      id: Number(project[0]),
      name: metadata.name || `Project #${id}`,
      status: project[3] as ProjectStatusEnum,
      methodology: project[4] as string,
      country: project[5] as string,
      metadataIpfsHash,
      ownerAddress: (project[1] as any).toString?.() || '',
      totalAreaHa: metadata.totalAreaHa || 0,
      carbonSequestrationEstimate: metadata.carbonSequestrationEstimate || 0,
      createdAt: new Date().toISOString(),
    };
  }

  private getAdminSecret(): string {
    return this.signingKeys.adminSecret();
  }
}
