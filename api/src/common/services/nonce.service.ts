import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

@Injectable()
export class NonceService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Allocate the next valid nonce for an address scoped to a contract.
   *
   * Contracts track a per-address, per-contract nonce starting at 0.
   * INCR is atomic so concurrent requests cannot be handed the same nonce.
   */
  async next(contractAddress: string, address: string): Promise<number> {
    const key = `nonce:${contractAddress}:${address}`;
    const incremented = await this.redis.incrOrThrow(key);
    return incremented - 1;
  }
}
