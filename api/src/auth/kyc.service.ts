import { Injectable } from '@nestjs/common';
import { RedisService } from '../common/services/redis.service';
import { KycStatus } from '../common/interfaces/authenticated-request.interface';

@Injectable()
export class KycService {
  constructor(private readonly redis: RedisService) {}

  async getStatus(address: string): Promise<KycStatus> {
    const cached = await this.redis.get(`kyc:${address}`);
    if (cached) return cached as KycStatus;
    return KycStatus.PENDING;
  }

  async updateStatus(address: string, status: KycStatus): Promise<void> {
    await this.redis.set(`kyc:${address}`, status);
  }

  async isEligible(address: string, requiredStatus: KycStatus): Promise<boolean> {
    const actual = await this.getStatus(address);
    return this.compareStatus(actual, requiredStatus);
  }

  private compareStatus(actual: KycStatus, required: KycStatus): boolean {
    const order = [KycStatus.NONE, KycStatus.PENDING, KycStatus.VERIFIED, KycStatus.ACCREDITED];
    return order.indexOf(actual) >= order.indexOf(required);
  }
}
