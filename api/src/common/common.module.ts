import { Global, Module } from '@nestjs/common';
import { NonceService } from './services/nonce.service';
import { RedisService } from './services/redis.service';
import { SigningKeyProvider } from './services/signing-key.provider';
import { KycStoreService } from './services/kyc-store.service';
import { RedisHealthController } from './redis-health.controller';
import { ConfigService } from '../config/config.service';

@Global()
@Module({
  controllers: [RedisHealthController],
  providers: [NonceService, RedisService, SigningKeyProvider, ConfigService, KycStoreService],
  exports: [NonceService, RedisService, SigningKeyProvider, ConfigService, KycStoreService],
})
export class CommonModule {}
