import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createClient, RedisClientType } from '@redis/client';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: RedisClientType;
  private healthy = false;

  constructor() {
    this.redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => Math.min(1000 * 2 ** retries, 30_000),
      },
    });
    this.redis.on('ready', () => {
      this.healthy = true;
      this.logger.log('Redis connection ready');
    });
    this.redis.on('end', () => {
      this.healthy = false;
      this.logger.warn('Redis connection closed');
    });
    this.redis.on('error', (error) => {
      this.healthy = false;
      this.logger.error(`Redis error: ${error.message}`);
    });
    this.redis.connect().catch((error) => {
      this.healthy = false;
      this.logger.error(`Redis connection failed: ${error.message}`);
    });
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logDegraded('get', key, error);
      return null;
    }
  }

  async set(key: string, value: string, options?: { EX?: number }): Promise<void> {
    try {
      await this.redis.set(key, value, options);
    } catch (error) {
      this.logDegraded('set', key, error);
    }
  }

  async setEx(key: string, seconds: number, value: string): Promise<void> {
    try {
      await this.redis.setEx(key, seconds, value);
    } catch (error) {
      this.logDegraded('setEx', key, error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logDegraded('del', key, error);
    }
  }

  /**
   * Delete all keys matching a glob pattern.
   *
   * Uses SCAN with MATCH to enumerate matching keys without blocking Redis,
   * then DELs them in a single batched call per cursor page.
   * Never calls KEYS, which blocks the server on large keyspaces.
   */
  async delPattern(pattern: string): Promise<void> {
    try {
      let cursor = 0;
      do {
        const reply = await this.redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = reply.cursor;
        if (reply.keys.length > 0) {
          await this.redis.del(reply.keys);
        }
      } while (cursor !== 0);
    } catch (error) {
      this.logDegraded('delPattern', pattern, error);
    }
  }

  async sAdd(key: string, value: string): Promise<void> {
    try {
      await this.redis.sAdd(key, value);
    } catch (error) {
      this.logDegraded('sAdd', key, error);
    }
  }

  async sMembers(key: string): Promise<string[]> {
    try {
      return await this.redis.sMembers(key);
    } catch (error) {
      this.logDegraded('sMembers', key, error);
      return [];
    }
  }

  async incrOrThrow(key: string): Promise<number> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      this.healthy = false;
      this.logger.error(`Redis incr failed for ${key}: ${this.message(error)}`);
      throw new ServiceUnavailableException('Nonce tracking is unavailable');
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      return await this.redis.expire(key, seconds);
    } catch (error) {
      this.logDegraded('expire', key, error);
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logDegraded('ttl', key, error);
      return -1;
    }
  }

  private logDegraded(operation: string, key: string, error: unknown): void {
    this.healthy = false;
    this.logger.warn(`Redis ${operation} failed for ${key}; continuing without cache: ${this.message(error)}`);
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
