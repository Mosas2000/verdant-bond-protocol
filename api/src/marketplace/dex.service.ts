import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ContractService } from '../stellar/contract.service';
import { StellarService } from '../stellar/stellar.service';
import { NonceService } from '../common/services/nonce.service';
import { RedisService } from '../common/services/redis.service';
import { SigningKeyProvider } from '../common/services/signing-key.provider';
import { ListBondDto } from './dto/list-bond.dto';
import { BuyBondDto } from './dto/buy-bond.dto';
import { DepositQuoteDto } from './dto/deposit-quote.dto';
import { WithdrawQuoteDto } from './dto/withdraw-quote.dto';
import {
  OrderResponse,
  OrderStatus,
  QuoteAsset,
  QuoteBalanceResponse,
  QuoteTransactionResponse,
} from './interfaces/marketplace.interface';
import { nativeToScVal, scValToNative, Address } from '@stellar/stellar-sdk';
import { PaginatedResponse } from '../common/dto/pagination.dto';
import { toBigIntString } from '../common/utils';

const DEX_ROUTER = () => process.env.DEX_ROUTER_ADDRESS || '';

const DEX_ERROR_CODE = {
  NotInitialized: 1,
  Unauthorized: 2,
  InvalidNonce: 3,
  OrderNotFound: 4,
  OrderAlreadyFilled: 5,
  InsufficientBalance: 6,
  SelfBuyNotAllowed: 7,
  OrderExpired: 8,
  ZeroAmount: 9,
  InsufficientFunds: 10,
  Overflow: 11,
} as const;

@Injectable()
export class DexService {
  constructor(
    private readonly contractService: ContractService,
    private readonly stellarService: StellarService,
    private readonly nonceService: NonceService,
    private readonly redis: RedisService,
    private readonly signingKeys: SigningKeyProvider,
  ) {}

  async listOrders(
    bondId?: number,
    status?: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<OrderResponse>> {
    const cacheKey = `orders:${bondId || 'all'}:${status || 'all'}:${page}:${limit}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const total = await this.getOrderCount();
    const ids = Array.from({ length: total }, (_unused, idx) => idx + 1);
    const matchingOrders = (await Promise.all(ids.map((id) => this.tryGetOrder(id))))
      .filter((order): order is OrderResponse => Boolean(order))
      .filter((order) => !bondId || order.bondId === bondId)
      .filter((order) => !status || order.status === status);
    const start = (page - 1) * limit;
    const paged = matchingOrders.slice(start, start + limit);

    const result = {
      data: paged,
      meta: {
        page,
        limit,
        total: matchingOrders.length,
        totalPages: Math.ceil(matchingOrders.length / limit) || 1,
      },
    };

    await this.redis.setEx(cacheKey, 30, JSON.stringify(result));
    return result;
  }

  async listBondTokens(dto: ListBondDto, sellerAddress: string): Promise<OrderResponse> {
    const adminSecret = this.getAdminSecret();
    const nonce = await this.nonceService.next(DEX_ROUTER(), sellerAddress);

    const { result } = await this.contractService.invokeContractMethod(
      DEX_ROUTER(), 'list_bond_tokens', adminSecret,
      [
        Address.fromString(sellerAddress).toScVal(),
        nativeToScVal(BigInt(dto.bondId), { type: 'u64' }),
        nativeToScVal(BigInt(dto.amount), { type: 'i128' }),
        nativeToScVal(BigInt(dto.pricePerToken), { type: 'i128' }),
        nativeToScVal(dto.quoteAsset, { type: 'symbol' }),
        nativeToScVal(BigInt(dto.expiresAfterSeconds || 604800), { type: 'u64' }),
      ],
      nonce,
    );

    const orderId = Number(scValToNative(result));
    await this.redis.delPattern(`orders:*`);
    await this.redis.del(`order:${orderId}`);
    return this.getOrder(orderId);
  }

  async buyBondTokens(dto: BuyBondDto, buyerAddress: string): Promise<OrderResponse> {
    const order = await this.getOrder(dto.orderId);
    const proceeds = BigInt(order.pricePerToken) * BigInt(dto.amount);

    const escrowed = await this.getQuoteBalance(buyerAddress, order.quoteAsset);
    if (BigInt(escrowed.balance) < proceeds) {
      throw new BadRequestException(
        `Insufficient escrowed ${order.quoteAsset}: required ${proceeds}, escrowed ${escrowed.balance}. ` +
        'Call POST /marketplace/escrow/deposit before purchasing.',
      );
    }

    const adminSecret = this.getAdminSecret();
    const nonce = await this.nonceService.next(DEX_ROUTER(), buyerAddress);

    try {
      await this.contractService.invokeContractMethod(
        DEX_ROUTER(), 'execute_purchase', adminSecret,
        [
          Address.fromString(buyerAddress).toScVal(),
          nativeToScVal(BigInt(dto.orderId), { type: 'u64' }),
          nativeToScVal(BigInt(dto.maxPrice), { type: 'i128' }),
          nativeToScVal(BigInt(dto.amount), { type: 'i128' }),
        ],
        nonce,
      );
    } catch (error) {
      throw this.mapDexError(error);
    }

    await this.redis.delPattern(`orders:*`);
    await this.redis.del(`order:${dto.orderId}`);
    return this.getOrder(dto.orderId);
  }

  async cancelOrder(orderId: number, callerAddress: string): Promise<void> {
    const adminSecret = this.getAdminSecret();
    const nonce = await this.nonceService.next(DEX_ROUTER(), callerAddress);

    await this.contractService.invokeContractMethod(
      DEX_ROUTER(), 'cancel_listing', adminSecret,
      [
        Address.fromString(callerAddress).toScVal(),
        nativeToScVal(BigInt(orderId), { type: 'u64' }),
      ],
      nonce,
    );

    await this.redis.delPattern(`orders:*`);
    await this.redis.del(`order:${orderId}`);
  }

  async getOrder(orderId: number): Promise<OrderResponse> {
    const cacheKey = `order:${orderId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const orderScVal = await this.contractService.simulateCall({
      contractAddress: DEX_ROUTER(),
      method: 'get_order',
      args: [nativeToScVal(BigInt(orderId), { type: 'u64' })],
    });
    const order = this.decodeOrder(scValToNative(orderScVal) as any[]);

    await this.redis.setEx(cacheKey, 60, JSON.stringify(order));
    return order;
  }

  async getQuoteBalance(
    address: string,
    asset: QuoteAsset = 'USDC',
  ): Promise<QuoteBalanceResponse> {
    const balanceScVal = await this.contractService.simulateCall({
      contractAddress: DEX_ROUTER(),
      method: 'get_quote_balance',
      args: [
        Address.fromString(address).toScVal(),
        nativeToScVal(asset, { type: 'symbol' }),
      ],
    });
    const balance = toBigIntString(scValToNative(balanceScVal));
    return { address, asset, balance };
  }

  async depositQuote(
    dto: DepositQuoteDto,
    callerAddress: string,
  ): Promise<QuoteTransactionResponse> {
    const adminSecret = this.getAdminSecret();
    const nonce = await this.nonceService.next(DEX_ROUTER(), callerAddress);

    const { transactionHash } = await this.contractService.invokeContractMethod(
      DEX_ROUTER(), 'deposit_quote', adminSecret,
      [
        Address.fromString(callerAddress).toScVal(),
        nativeToScVal(dto.asset, { type: 'symbol' }),
        nativeToScVal(BigInt(dto.amount), { type: 'i128' }),
      ],
      nonce,
    );

    return { address: callerAddress, asset: dto.asset, amount: dto.amount, transactionHash };
  }

  async withdrawQuote(
    dto: WithdrawQuoteDto,
    callerAddress: string,
  ): Promise<QuoteTransactionResponse> {
    const adminSecret = this.getAdminSecret();
    const nonce = await this.nonceService.next(DEX_ROUTER(), callerAddress);

    const { transactionHash } = await this.contractService.invokeContractMethod(
      DEX_ROUTER(), 'withdraw_quote', adminSecret,
      [
        Address.fromString(callerAddress).toScVal(),
        nativeToScVal(dto.asset, { type: 'symbol' }),
        nativeToScVal(BigInt(dto.amount), { type: 'i128' }),
      ],
      nonce,
    );

    return { address: callerAddress, asset: dto.asset, amount: dto.amount, transactionHash };
  }

  private async invalidateOrdersCache(): Promise<void> {
    const keys: string[] = [];
    for await (const key of this.redis.scanIterator({ MATCH: 'orders:*' })) {
      keys.push(key);
    }
    if (keys.length > 0) {
      await this.redis.del(keys);
    }
  }

  private decodeOrder(data: any[]): OrderResponse {
    return {
      id: Number(data[0]),
      seller: data[1] as string,
      bondId: Number(data[2]),
      amount: toBigIntString(data[3]),
      pricePerToken: toBigIntString(data[4]),
      quoteAsset: data[5] as QuoteAsset,
      status: this.orderStatusFromIndex(Number(data[6])),
      createdAt: new Date(Number(data[7]) * 1000).toISOString(),
    };
  }

  private orderStatusFromIndex(index: number): OrderStatus {
    return (
      [
        OrderStatus.Open,
        OrderStatus.PartiallyFilled,
        OrderStatus.Filled,
        OrderStatus.Cancelled,
        OrderStatus.Expired,
      ][index] ?? OrderStatus.Open
    );
  }

  private getAdminSecret(): string {
    return this.signingKeys.adminSecret();
  }

  /**
   * Invoke one bounded `clean_expired_orders` pass.
   * Pass `startId` from the previous result's `nextStartId` (or `1` / `0` to begin).
   * When `nextStartId` is `0`, the scan has reached `order_count`.
   */
  async cleanExpiredOrders(
    startId = 1,
    limit = 50,
  ): Promise<{ cleaned: number; nextStartId: number }> {
    const adminSecret = this.getAdminSecret();
    const adminAddress = this.stellarService
      .getKeypairFromSecret(adminSecret)
      .publicKey();
    const nonce = await this.nonceService.next(DEX_ROUTER(), adminAddress);

    const { result } = await this.contractService.invokeContractMethod(
      DEX_ROUTER(),
      'clean_expired_orders',
      adminSecret,
      [
        Address.fromString(adminAddress).toScVal(),
        nativeToScVal(BigInt(startId), { type: 'u64' }),
        nativeToScVal(limit, { type: 'u32' }),
      ],
      nonce,
    );

    const decoded = scValToNative(result) as { cleaned?: number; next_start_id?: number } | unknown[];
    if (Array.isArray(decoded)) {
      return {
        cleaned: Number(decoded[0]),
        nextStartId: Number(decoded[1]),
      };
    }
    return {
      cleaned: Number((decoded as any).cleaned ?? 0),
      nextStartId: Number((decoded as any).next_start_id ?? 0),
    };
  }

  private async getOrderCount(): Promise<number> {
    const countScVal = await this.contractService.simulateCall({
      contractAddress: DEX_ROUTER(),
      method: 'order_count',
      args: [],
    });
    return Number(scValToNative(countScVal));
  }

  private async tryGetOrder(id: number): Promise<OrderResponse | null> {
    try {
      const orderScVal = await this.contractService.simulateCall({
        contractAddress: DEX_ROUTER(),
        method: 'get_order',
        args: [nativeToScVal(BigInt(id), { type: 'u64' })],
      });
      return this.decodeOrder(scValToNative(orderScVal) as any[]);
    } catch {
      return null;
    }
  }

  private mapDexError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/#(\d+)/) ?? message.match(/Error\(-(\d+)/);
    const code = match ? Number(match[1]) : undefined;

    if (code === DEX_ERROR_CODE.InsufficientFunds) {
      return new HttpException(
        'Insufficient escrowed funds. Call POST /marketplace/escrow/deposit before purchasing.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    if (error instanceof HttpException) {
      return error;
    }

    return new BadRequestException(message);
  }
}
