import { Controller, Get } from '@nestjs/common';
import { RedisService } from './services/redis.service';

@Controller('health')
export class RedisHealthController {
  constructor(private readonly redis: RedisService) {}

  @Get('redis')
  redisHealth() {
    return {
      redis: this.redis.isHealthy() ? 'up' : 'degraded',
    };
  }
}
