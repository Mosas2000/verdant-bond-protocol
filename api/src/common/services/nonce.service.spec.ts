import { ServiceUnavailableException } from '@nestjs/common';
import { NonceService } from './nonce.service';
import { RedisService } from './redis.service';

describe('NonceService', () => {
  it('allocates contract-scoped nonces atomically through Redis', async () => {
    const redis = {
      incrOrThrow: jest.fn().mockResolvedValue(3),
    } as unknown as RedisService;
    const service = new NonceService(redis);

    await expect(service.next('CDEX', 'GUSER')).resolves.toBe(2);
    expect(redis.incrOrThrow).toHaveBeenCalledWith('nonce:CDEX:GUSER');
  });

  it('fails closed when Redis cannot allocate a nonce', async () => {
    const redis = {
      incrOrThrow: jest.fn().mockRejectedValue(new ServiceUnavailableException()),
    } as unknown as RedisService;
    const service = new NonceService(redis);

    await expect(service.next('CDEX', 'GUSER')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
