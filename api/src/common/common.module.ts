import { Global, Module } from '@nestjs/common';
import { NonceService } from './services/nonce.service';
import { RedisService } from './services/redis.service';
import { SigningKeyProvider } from './services/signing-key.provider';
import { RedisHealthController } from './redis-health.controller';

@Global()
@Module({
  controllers: [RedisHealthController],
  providers: [NonceService, RedisService, SigningKeyProvider],
  exports: [NonceService, RedisService, SigningKeyProvider],
})
export class CommonModule {}
