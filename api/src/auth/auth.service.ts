import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import { RedisService } from '../common/services/redis.service';
import { StellarService } from '../stellar/stellar.service';
import { KycService } from './kyc.service';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { ChallengeResponse, AuthTokenResponse, UserProfileResponse } from './interfaces/auth.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly kycService: KycService,
    private readonly stellarService: StellarService,
    private readonly redis: RedisService,
  ) {}

  async generateChallenge(address: string): Promise<ChallengeResponse> {
    if (!this.stellarService.isValidPublicKey(address)) {
      throw new BadRequestException('Invalid Stellar address');
    }

    const nonce = crypto.randomBytes(32).toString('hex');
    const serverSecretKey = process.env.STELLAR_AUTH_SECRET_KEY || process.env.ADMIN_SECRET_KEY;
    if (!serverSecretKey) {
      throw new InternalServerErrorException('Missing Stellar authentication signing key');
    }

    let serverKeypair: Keypair;
    try {
      serverKeypair = Keypair.fromSecret(serverSecretKey);
    } catch {
      throw new InternalServerErrorException('Invalid Stellar authentication signing key');
    }

    const homeDomain = process.env.STELLAR_HOME_DOMAIN || 'localhost:3000';
    const challengeTransaction = new TransactionBuilder(
      new Account(serverKeypair.publicKey(), '0'),
      {
        fee: '100',
        networkPassphrase: this.stellarService.getNetworkPassphrase(),
      },
    )
      .addOperation(Operation.manageData({
        name: `${homeDomain} auth`,
        value: Buffer.from(nonce, 'hex'),
        source: address,
      }))
      .setTimeout(300)
      .build();
    challengeTransaction.sign(serverKeypair);
    const challenge = challengeTransaction.toXDR();

    await this.redis.set(`challenge:${address}`, challenge, { EX: 300 });

    return { challenge, nonce };
  }

  async verifySignature(dto: VerifySignatureDto): Promise<AuthTokenResponse> {
    const storedChallenge = await this.redis.get(`challenge:${dto.address}`);
    if (!storedChallenge || storedChallenge !== dto.originalChallenge) {
      throw new UnauthorizedException('Challenge not found or expired');
    }

    const serverSecretKey = process.env.STELLAR_AUTH_SECRET_KEY || process.env.ADMIN_SECRET_KEY;
    if (!serverSecretKey) {
      throw new InternalServerErrorException('Missing Stellar authentication signing key');
    }

    try {
      const serverKeypair = Keypair.fromSecret(serverSecretKey);
      const originalTransaction = TransactionBuilder.fromXDR(
        dto.originalChallenge,
        this.stellarService.getNetworkPassphrase(),
      );
      const signedTransaction = TransactionBuilder.fromXDR(
        dto.signedChallenge,
        this.stellarService.getNetworkPassphrase(),
      );
      if (signedTransaction instanceof FeeBumpTransaction) {
        throw new Error('Fee bump transactions are not valid auth challenges');
      }
      const transactionHash = signedTransaction.hash();
      const hasSignature = (keypair: Keypair): boolean =>
        signedTransaction.signatures.some((signature) =>
          keypair.verify(transactionHash, signature.signature()),
        );

      if (
        originalTransaction.hash().toString('hex') !== transactionHash.toString('hex') ||
        signedTransaction.source !== serverKeypair.publicKey() ||
        signedTransaction.operations.length !== 1 ||
        signedTransaction.operations[0].source !== dto.address ||
        !hasSignature(serverKeypair) ||
        !hasSignature(Keypair.fromPublicKey(dto.address))
      ) {
        throw new Error('Invalid challenge transaction');
      }
    } catch {
      throw new UnauthorizedException('Invalid signature');
    }

    await this.redis.del(`challenge:${dto.address}`);

    const kycStatus = await this.kycService.getStatus(dto.address);

    const payload = { sub: dto.address, kycStatus };
    const accessToken = this.jwtService.sign(payload);

    return { accessToken, tokenType: 'Bearer', expiresIn: '7d' };
  }

  async refreshToken(token: string): Promise<AuthTokenResponse> {
    try {
      const payload = this.jwtService.verify(token) as { sub: string; kycStatus: string };
      const newPayload = { sub: payload.sub, kycStatus: payload.kycStatus };
      const accessToken = this.jwtService.sign(newPayload);
      return { accessToken, tokenType: 'Bearer', expiresIn: '7d' };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async getProfile(userId: string): Promise<UserProfileResponse> {
    const kycStatus = await this.kycService.getStatus(userId);
    return {
      walletAddress: userId,
      kycStatus,
      createdAt: new Date().toISOString(),
    };
  }
}
