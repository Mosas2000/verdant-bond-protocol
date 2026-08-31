import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyService, IdempotencyRecord } from '../services/idempotency.service';
import { ExecutionContext, ConflictException } from '@nestjs/common';
import { of, throwError } from 'rxjs';

function makeContext(method: string, url: string, body: unknown, key?: string): ExecutionContext {
  const request: any = { method, url, originalUrl: url, body, headers: {} as Record<string, string> };
  if (key) request.headers['idempotency-key'] = key;
  const response: any = { statusCode: 200 };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) };

describe('IdempotencyInterceptor', () => {
  let service: IdempotencyService;
  let redis: any;

  beforeEach(() => {
    redis = {
      get: jest.fn().mockResolvedValue(null),
      setNxValue: jest.fn().mockResolvedValue(true),
      setEx: jest.fn().mockResolvedValue(undefined),
    };
    service = new IdempotencyService(redis as any);
  });

  function build(record?: IdempotencyRecord | null) {
    if (record) redis.get.mockResolvedValue(JSON.stringify(record));
    else redis.get.mockResolvedValue(null);
    return new IdempotencyInterceptor(reflector as any, service);
  }

  it('passes through when no idempotency key is supplied', (done) => {
    const interceptor = build();
    const handler = { handle: () => of({ ok: true }) };
    const obs = interceptor.intercept(makeContext('POST', '/x', { a: 1 }), handler as any);
    obs.subscribe((res) => {
      expect(res).toEqual({ ok: true });
      done();
    });
  });

  it('returns the stored result on a duplicate retry (same fingerprint)', (done) => {
    const interceptor = build({ status: 'success', fingerprint: 'f', result: { dup: true }, createdAt: 1 });
    const handler = { handle: jest.fn().mockReturnValue(of({ executed: true })) };
    const obs = interceptor.intercept(makeContext('POST', '/x', { a: 1 }, 'key1'), handler as any);
    obs.subscribe((res) => {
      expect(res).toEqual({ dup: true });
      expect(handler.handle).not.toHaveBeenCalled();
      done();
    });
  });

  it('rejects a conflicting reuse with a different payload', (done) => {
    const interceptor = build({ status: 'success', fingerprint: 'different', result: {}, createdAt: 1 });
    const handler = { handle: jest.fn().mockReturnValue(of({ executed: true })) };
    const obs = interceptor.intercept(makeContext('POST', '/x', { a: 1 }, 'key1'), handler as any);
    obs.subscribe({
      next: () => done.fail('expected conflict'),
      error: (err) => {
        expect(err).toBeInstanceOf(ConflictException);
        done();
      },
    });
  });

  it('rejects a still-pending key as in-progress', (done) => {
    const interceptor = build({ status: 'pending', fingerprint: 'f', createdAt: 1 });
    const handler = { handle: jest.fn().mockReturnValue(of({ executed: true })) };
    const obs = interceptor.intercept(makeContext('POST', '/x', { a: 1 }, 'key1'), handler as any);
    obs.subscribe({
      next: () => done.fail('expected conflict'),
      error: (err) => {
        expect(err).toBeInstanceOf(ConflictException);
        done();
      },
    });
  });

  it('executes and stores the result for a new key', (done) => {
    const interceptor = build();
    const handler = { handle: () => of({ transactionHash: '0x1' }) };
    const obs = interceptor.intercept(makeContext('POST', '/x', { a: 1 }, 'key1'), handler as any);
    obs.subscribe((res) => {
      expect(res).toEqual({ transactionHash: '0x1' });
      // markPending then complete
      expect(redis.setNxValue).toHaveBeenCalled();
      expect(redis.setEx).toHaveBeenCalled();
      done();
    });
  });

  it('stores an error record when the handler fails', (done) => {
    const interceptor = build();
    const handler = { handle: () => throwError(() => new Error('boom')) };
    const obs = interceptor.intercept(makeContext('POST', '/x', { a: 1 }, 'key1'), handler as any);
    obs.subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err.message).toBe('boom');
        const stored = JSON.parse(redis.setEx.mock.calls[0][2]);
        expect(stored.status).toBe('error');
        done();
      },
    });
  });
});
