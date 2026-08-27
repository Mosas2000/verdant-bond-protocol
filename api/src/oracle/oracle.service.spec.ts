import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return { ...actual, scValToNative: jest.fn() };
});

import { xdr, scValToNative, Keypair } from '@stellar/stellar-sdk';
import { OracleService } from './oracle.service';
import { ContractService } from '../stellar/contract.service';
import { IpfsService } from '../projects/ipfs.service';
import { StellarService } from '../stellar/stellar.service';
import { NonceService } from '../common/services/nonce.service';
import { RedisService } from '../common/services/redis.service';
import { SigningKeyProvider } from '../common/services/signing-key.provider';
import { ConfigService } from '../config/config.service';
import { ReportStatus } from './interfaces/oracle.interface';

describe('OracleService', () => {
  let service: OracleService;
  let contractService: { simulateCall: jest.Mock; invokeContractMethod: jest.Mock };
  let redis: { del: jest.Mock };
  const adminKeypair = Keypair.random();

  beforeEach(async () => {
    contractService = {
      simulateCall: jest.fn(),
      invokeContractMethod: jest.fn().mockResolvedValue({ result: 0 }),
    };
    redis = { del: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OracleService,
        { provide: ContractService, useValue: contractService },
        { provide: IpfsService, useValue: {} },
        {
          provide: StellarService,
          useValue: {
            getKeypairFromSecret: jest.fn().mockReturnValue({
              publicKey: () => adminKeypair.publicKey(),
            }),
          },
        },
        {
          provide: NonceService,
          useValue: { next: jest.fn().mockResolvedValue(0) },
        },
        { provide: RedisService, useValue: redis },
        {
          provide: SigningKeyProvider,
          useValue: { adminSecret: jest.fn().mockReturnValue('SADMINSECRET') },
        },
        {
          provide: ConfigService,
          useValue: { getOracleConsumerAddress: jest.fn().mockReturnValue('CORACLE') },
        },
      ],
    }).compile();

    service = moduleRef.get(OracleService);
  });

  describe('decodeReport', () => {
    it('maps the contract Report struct to a ReportResponse', () => {
      const raw = [
        BigInt(4),
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        Buffer.from('a1b2'.padEnd(64, '0'), 'hex'),
        BigInt(1700000000),
        BigInt(1700086400),
        BigInt(1200),
        'VM0003',
        Buffer.from('c3d4'.padEnd(64, '0'), 'hex'),
        1,
        BigInt(1700001000),
        BigInt(0),
      ];

      expect((service as any).decodeReport(raw)).toEqual({
        id: 4,
        providerAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        projectId: 'a1b2'.padEnd(64, '0'),
        periodStart: 1700000000,
        periodEnd: 1700086400,
        carbonSequestered: '1200',
        methodology: 'VM0003',
        ipfsHash: 'c3d4'.padEnd(64, '0'),
        status: ReportStatus.Verified,
        createdAt: new Date(1700001000 * 1000).toISOString(),
        verifiedAt: undefined,
      });
    });

    it.each([
      [0, ReportStatus.Pending],
      [1, ReportStatus.Verified],
      [2, ReportStatus.Challenged],
      [3, ReportStatus.Rejected],
    ])('maps status index %i to %s', (index, expected) => {
      const raw = [
        BigInt(1),
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        Buffer.alloc(32),
        BigInt(0),
        BigInt(0),
        BigInt(0),
        'VM0003',
        Buffer.alloc(32),
        index,
        BigInt(0),
        BigInt(0),
      ];

      expect((service as any).decodeReport(raw).status).toBe(expected);
    });
  });

  describe('toBytes32', () => {
    it('keeps a 64-char hex string as-is', () => {
      const hex = 'ab'.repeat(32);
      const scVal = (service as any).toBytes32(hex) as xdr.ScVal;
      expect(scVal.bytes().length).toBe(32);
    });

    it('digests a CID into 32 bytes via sha256', () => {
      const scVal = (service as any).toBytes32(
        'QmYwAPJzv5CZsnAzt8auVZRnTb7F8Pz6ePzE9LbYp8Xy7F',
      ) as xdr.ScVal;
      expect(scVal.bytes().length).toBe(32);
    });
  });

  describe('decodeSlashRecord', () => {
    it('maps a SlashRecord struct to a SlashRecord response', () => {
      const raw = {
        report_id: BigInt(7),
        penalty: BigInt(10_000),
        remaining_stake: BigInt(90_000),
        timestamp: BigInt(1700000000),
        active_after: true,
      };

      expect((service as any).decodeSlashRecord(raw)).toEqual({
        reportId: 7,
        penalty: '10000',
        remainingStake: '90000',
        timestamp: new Date(1700000000 * 1000).toISOString(),
        activeAfter: true,
      });
    });

    it('handles array-encoded structs', () => {
      const raw = [
        BigInt(7),
        BigInt(10_000),
        BigInt(90_000),
        BigInt(1700000000),
        true,
      ];

      expect((service as any).decodeSlashRecord(raw)).toEqual({
        reportId: 7,
        penalty: '10000',
        remainingStake: '90000',
        timestamp: new Date(1700000000 * 1000).toISOString(),
        activeAfter: true,
      });
    });
  });

  describe('decodeChallengeRecord', () => {
    it('maps a Challenge struct to a ChallengeRecord response', () => {
      const raw = {
        report_id: BigInt(7),
        challenger: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        counter_evidence_hash: Buffer.from('a1b2'.padEnd(64, '0'), 'hex'),
        submitted_at: BigInt(1699990000),
        resolved: true,
        resolution: 3,
      };

      expect((service as any).decodeChallengeRecord(raw)).toEqual({
        reportId: 7,
        challengerAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        counterEvidenceHash: 'a1b2'.padEnd(64, '0'),
        submittedAt: new Date(1699990000 * 1000).toISOString(),
        resolved: true,
        resolution: ReportStatus.Rejected,
      });
    });

    it('returns null resolution for unresolved challenges', () => {
      const raw = {
        report_id: BigInt(7),
        challenger: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        counter_evidence_hash: Buffer.alloc(32),
        submitted_at: BigInt(1699990000),
        resolved: false,
        resolution: 0,
      };

      expect((service as any).decodeChallengeRecord(raw).resolution).toBeNull();
    });
  });

  describe('toRecord / field', () => {
    it('prefers object keys over array indices', () => {
      expect((service as any).field({ slashes: 4 }, 'slashes', 2)).toBe(4);
      expect((service as any).field([1, 2, 4], 'slashes', 2)).toBe(4);
    });
  });

  describe('registerProvider', () => {
    const providerAddress = Keypair.random().publicKey();

    beforeEach(() => {
      (scValToNative as jest.Mock).mockReset();
    });

    it('rejects an unsupported methodology before calling the contract', async () => {
      await expect(
        service.registerProvider({ providerAddress, methodology: 'MADE-UP-METHOD' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(contractService.invokeContractMethod).not.toHaveBeenCalled();
    });

    it('normalizes methodology casing against the supported list', async () => {
      contractService.simulateCall.mockRejectedValueOnce(new Error('not found'));

      const result = await service.registerProvider({
        providerAddress,
        methodology: 'verra-vcs',
      } as any);

      expect(result.methodology).toBe('VERRA-VCS');
      expect(contractService.invokeContractMethod).toHaveBeenCalled();
    });

    it('returns a conflict when the provider is already actively registered', async () => {
      contractService.simulateCall.mockResolvedValueOnce({});
      (scValToNative as jest.Mock).mockReturnValueOnce([providerAddress, 'VERRA-VCS', 0, true, 0]);

      await expect(
        service.registerProvider({ providerAddress, methodology: 'VERRA-VCS' } as any),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(contractService.invokeContractMethod).not.toHaveBeenCalled();
    });

    it('returns a distinct conflict for a previously removed (inactive) provider', async () => {
      contractService.simulateCall.mockResolvedValueOnce({});
      (scValToNative as jest.Mock).mockReturnValueOnce([providerAddress, 'VERRA-VCS', 0, false, 0]);

      await expect(
        service.registerProvider({ providerAddress, methodology: 'VERRA-VCS' } as any),
      ).rejects.toThrow(/does not support reactivating/);

      expect(contractService.invokeContractMethod).not.toHaveBeenCalled();
    });

    it('registers successfully and invalidates the provider list cache', async () => {
      contractService.simulateCall.mockRejectedValueOnce(new Error('not found'));

      const result = await service.registerProvider({
        providerAddress,
        methodology: 'BLUE-CARBON',
      } as any);

      expect(result.providerAddress).toBe(providerAddress);
      expect(result.active).toBe(true);
      expect(contractService.invokeContractMethod).toHaveBeenCalledWith(
        'CORACLE',
        'register_provider',
        'SADMINSECRET',
        expect.any(Array),
        0,
      );
      expect(redis.del).toHaveBeenCalledWith('oracle:providers');
    });
  });
});
