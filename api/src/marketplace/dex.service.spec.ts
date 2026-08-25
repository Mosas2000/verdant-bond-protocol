import { Test } from '@nestjs/testing';
import { nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { DexService } from './dex.service';
import { ContractService } from '../stellar/contract.service';
import { StellarService } from '../stellar/stellar.service';
import { NonceService } from '../common/services/nonce.service';
import { RedisService } from '../common/services/redis.service';
import { SigningKeyProvider } from '../common/services/signing-key.provider';
import { OrderStatus } from './interfaces/marketplace.interface';

describe('DexService', () => {
  let service: DexService;
  let contractService: { simulateCall: jest.Mock; invokeContractMethod: jest.Mock };
  let redis: { get: jest.Mock; setEx: jest.Mock; del: jest.Mock };

  const simulateCallMock = jest.fn();
  const invokeContractMethodMock = jest.fn();

  beforeAll(async () => {
    contractService = {
      simulateCall: simulateCallMock,
      invokeContractMethod: invokeContractMethodMock,
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DexService,
        { provide: ContractService, useValue: contractService },
        {
          provide: StellarService,
          useValue: {
            getKeypairFromSecret: jest.fn().mockReturnValue({
              publicKey: () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
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
          useValue: { adminSecret: jest.fn().mockReturnValue('SADMIN') },
        },
      ],
    }).compile();

    service = moduleRef.get(DexService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    redis.get.mockResolvedValue(null);
  });

  describe('listOrders', () => {
    const SELLER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const rawOrder = (id: number, bondId = 3) =>
      xdr.ScVal.scvVec([
        nativeToScVal(BigInt(id), { type: 'u64' }),
        nativeToScVal(SELLER, { type: 'address' }),
        nativeToScVal(BigInt(bondId), { type: 'u64' }),
        nativeToScVal(BigInt(1000), { type: 'i128' }),
        nativeToScVal(BigInt(25), { type: 'i128' }),
        nativeToScVal('USDC', { type: 'symbol' }),
        xdr.ScVal.scvU32(0),
        nativeToScVal(BigInt(1700000000), { type: 'u64' }),
        nativeToScVal(BigInt(1700604800), { type: 'u64' }),
      ]);

    it('does not truncate listings when an intermediate order id is missing', async () => {
      simulateCallMock.mockImplementation(({ method, args }) => {
        if (method === 'order_count') {
          return Promise.resolve(nativeToScVal(BigInt(4), { type: 'u64' }));
        }
        const id = Number(scValToNative(args[0]));
        if (id === 3) {
          return Promise.reject(new Error('OrderNotFound'));
        }
        return Promise.resolve(rawOrder(id));
      });

      const result = await service.listOrders(undefined, undefined, 1, 10);

      expect(result.data.map((order) => order.id)).toEqual([1, 2, 4]);
      expect(result.meta.total).toBe(3);
      expect(simulateCallMock).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'order_count' }),
      );
    });
  });

  describe('decodeOrder', () => {
    const SELLER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('maps the contract Order struct to an OrderResponse', async () => {
      const raw = [
        BigInt(7),
        SELLER,
        BigInt(3),
        BigInt(1000),
        BigInt(25),
        'USDC',
        0,
        BigInt(1700000000),
        BigInt(1700604800),
      ];

      expect((service as any).decodeOrder(raw)).toEqual({
        id: 7,
        seller: SELLER,
        bondId: 3,
        amount: 1000,
        pricePerToken: 25,
        quoteAsset: 'USDC',
        status: OrderStatus.Open,
        createdAt: new Date(1700000000 * 1000).toISOString(),
      });
    });

    it.each([
      [0, OrderStatus.Open],
      [1, OrderStatus.PartiallyFilled],
      [2, OrderStatus.Filled],
      [3, OrderStatus.Cancelled],
      [4, OrderStatus.Expired],
    ])('maps status index %i to %s', async (index, expected) => {
      const raw = [
        BigInt(1),
        SELLER,
        BigInt(1),
        BigInt(1),
        BigInt(1),
        'XLM',
        index,
        BigInt(0),
        BigInt(0),
      ];

      expect((service as any).decodeOrder(raw).status).toBe(expected);
    });
  });

  describe('getQuoteBalance', () => {
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('reads the escrowed balance for the requested asset', async () => {
      simulateCallMock.mockResolvedValue(nativeToScVal(BigInt(25_000), { type: 'i128' }));

      await expect(service.getQuoteBalance(address, 'USDC')).resolves.toEqual({
        address,
        asset: 'USDC',
        balance: 25000,
      });

      expect(simulateCallMock).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'get_quote_balance' }),
      );
    });
  });

  describe('depositQuote', () => {
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('calls deposit_quote and returns a transaction response', async () => {
      invokeContractMethodMock.mockResolvedValue({
        transactionHash: 'abc123',
        successful: true,
      });

      await expect(
        service.depositQuote({ asset: 'USDC', amount: 1000 }, address),
      ).resolves.toEqual({
        address,
        asset: 'USDC',
        amount: 1000,
        transactionHash: 'abc123',
      });

      expect(invokeContractMethodMock).toHaveBeenCalledWith(
        expect.any(String),
        'deposit_quote',
        expect.any(String),
        expect.any(Array),
        0,
      );
    });
  });

  describe('withdrawQuote', () => {
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('calls withdraw_quote and returns a transaction response', async () => {
      invokeContractMethodMock.mockResolvedValue({
        transactionHash: 'def456',
        successful: true,
      });

      await expect(
        service.withdrawQuote({ asset: 'XLM', amount: 500 }, address),
      ).resolves.toEqual({
        address,
        asset: 'XLM',
        amount: 500,
        transactionHash: 'def456',
      });

      expect(invokeContractMethodMock).toHaveBeenCalledWith(
        expect.any(String),
        'withdraw_quote',
        expect.any(String),
        expect.any(Array),
        0,
      );
    });
  });

  describe('cleanExpiredOrders', () => {
    it('invokes clean_expired_orders with start_id and limit and decodes the result', async () => {
      // Prefer array-shaped decode path used by scValToNative for contracttype structs
      invokeContractMethodMock.mockResolvedValue({
        transactionHash: 'clean1',
        successful: true,
        result: xdr.ScVal.scvVec([
          nativeToScVal(3, { type: 'u32' }),
          nativeToScVal(BigInt(51), { type: 'u64' }),
        ]),
      });

      await expect(service.cleanExpiredOrders(1, 50)).resolves.toEqual({
        cleaned: 3,
        nextStartId: 51,
      });

      expect(invokeContractMethodMock).toHaveBeenCalledWith(
        expect.any(String),
        'clean_expired_orders',
        'SADMIN',
        expect.any(Array),
        0,
      );
      const args = invokeContractMethodMock.mock.calls[0][3];
      expect(Number(scValToNative(args[1]))).toBe(1);
      expect(Number(scValToNative(args[2]))).toBe(50);
    });
  });
});
