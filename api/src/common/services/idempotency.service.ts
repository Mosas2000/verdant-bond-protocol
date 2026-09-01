import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';
import * as crypto from 'crypto';

export type IdempotencyStatus = 'pending' | 'success' | 'error';

export interface IdempotencyRecord {
  status: IdempotencyStatus;
  fingerprint: string;
  result?: any;
  transactionHash?: string;
  statusCode?: number;
  createdAt: number;
}

const DEFAULT_TTL_SECONDS = Number(process.env.IDEMPOTENCY_TTL_SECONDS ?? 86_400);

/**
 * Persists the terminal result of a user-submitted mutation keyed by an
 * idempotency key (#114). Replaying the same key returns the original result;
 * reusing a key with a different payload is rejected as a conflict.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly redis: RedisService) {}

  private keyOf(key: string): string {
    return `idem:${key}`;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const raw = await this.redis.get(this.keyOf(key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as IdempotencyRecord;
    } catch {
      return null;
    }
  }

  /** Reserve a pending slot. Returns false if a record already exists. */
  async markPending(key: string, fingerprint: string): Promise<boolean> {
    const record: IdempotencyRecord = {
      status: 'pending',
      fingerprint,
      createdAt: Date.now(),
    };
    return this.redis.setNxValue(this.keyOf(key), JSON.stringify(record), DEFAULT_TTL_SECONDS);
  }

  async complete(
    key: string,
    status: IdempotencyStatus,
    result: any,
    statusCode?: number,
  ): Promise<void> {
    const existing = await this.get(key);
    const transactionHash =
      result?.transactionHash ?? existing?.transactionHash ?? undefined;
    const record: IdempotencyRecord = {
      status,
      fingerprint: existing?.fingerprint ?? '',
      result,
      transactionHash,
      statusCode: statusCode ?? existing?.statusCode ?? 200,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await this.redis.setEx(this.keyOf(key), DEFAULT_TTL_SECONDS, JSON.stringify(record));
  }

  static fingerprintOf(method: string, path: string, body: unknown): string {
    const canonical = JSON.stringify({ method, path, body: body ?? null });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}
