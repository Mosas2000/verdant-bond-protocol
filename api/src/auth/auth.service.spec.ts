import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { AuthService } from './auth.service';
import { ConfigService } from '../config/config.service';
import { StellarService } from '../../stellar/stellar.service';
import { VerifySignatureDto } from './dto/verify-signature.dto';

const TEST_ACCESS_SECRET = 'test-access-secret-minimum-32-characters-long';
const TEST_REFRESH_SECRET = 'test-refresh-secret-minimum-32-characters-long';

type FakeRedis = {
  store: Map<string, { value: string; timer?: NodeJS.Timeout }>;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  getDel: jest.Mock;
};

const makeFakeRedis = (): FakeRedis => {
  const store = new Map<string, { value: string; timer?: NodeJS.Timeout }>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key)?.value ?? null),
    set: jest.fn(async (key: string, value: string, opts?: { EX?: number }) => {
      const existing = store.get(key);
      if (existing?.timer) clearTimeout(existing.timer);
      let timer: NodeJS.Timeout | undefined;
      if (opts?.EX) {
        timer = setTimeout(() => store.delete(key), opts.EX * 1000);
        timer.unref?.();
      }
      store.set(key, { value, timer });
    }),
    del: jest.fn(async (key: string) => {
      const existing = store.get(key);
      if (existing?.timer) clearTimeout(existing.timer);
      store.delete(key);
    }),
    getDel: jest.fn(async (key: string) => {
      const existing = store.get(key);
      if (!existing) return null;
      if (existing.timer) clearTimeout(existing.timer);
      store.delete(key);
      return existing.value;
    }),
  };
};

const makeStellarService = (): Partial<StellarService> => ({
  isValidPublicKey: jest.fn((addr: string) => {
    try {
      Keypair.fromPublicKey(addr);
      return true;
    } catch {
      return false;
    }
  }),
});

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let redis: FakeRedis;
  let stellarService: Partial<StellarService>;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.JWT_EXPIRY = '15m';
    process.env.JWT_REFRESH_EXPIRY = '7d';

    jwtService = new JwtService({ secret: TEST_ACCESS_SECRET });
    configService = new ConfigService();
    redis = makeFakeRedis();
    stellarService = makeStellarService();
    service = new AuthService(
      jwtService,
      { getStatus: jest.fn().mockResolvedValue('verified') } as any,
      stellarService as StellarService,
      redis as any,
      configService,
    );
  });

  afterEach(() => {
    for (const entry of redis.store.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.JWT_EXPIRY;
    delete process.env.JWT_REFRESH_EXPIRY;
  });

  describe('refresh token (legacy)', () => {
    it('refreshes an access token after the access token has expired', async () => {
      const expiredAccessToken = jwtService.sign(
        { sub: 'GUSER', kycStatus: 'verified' },
        { expiresIn: -1 },
      );
      const refreshToken = jwtService.sign(
        { sub: 'GUSER', kycStatus: 'verified', tokenType: 'refresh' },
        { secret: TEST_REFRESH_SECRET, expiresIn: '7d' },
      );

      await expect(service.refreshToken(expiredAccessToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshToken(refreshToken)).resolves.toMatchObject({
        tokenType: 'Bearer',
        expiresIn: '15m',
      });
    });

    it('rejects an expired refresh token', async () => {
      const expiredRefreshToken = jwtService.sign(
        { sub: 'GUSER', kycStatus: 'verified', tokenType: 'refresh' },
        { secret: TEST_REFRESH_SECRET, expiresIn: -1 },
      );

      await expect(service.refreshToken(expiredRefreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an access token presented as a refresh token', async () => {
      const accessToken = jwtService.sign({ sub: 'GUSER', kycStatus: 'verified' });

      await expect(service.refreshToken(accessToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('generateChallenge', () => {
    it('rejects an invalid Stellar address', async () => {
      await expect(service.generateChallenge('not-an-address')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('stores a JSON challenge record with metadata under challenge:<address>', async () => {
      const keypair = Keypair.random();
      const result = await service.generateChallenge(keypair.publicKey());

      expect(result.challenge).toContain('Verdant Bond Protocol sign-in');
      expect(result.challenge).toContain(`Address: ${keypair.publicKey()}`);
      expect(result.nonce).toMatch(/^[a-f0-9]{64}$/);

      const key = `challenge:${keypair.publicKey()}`;
      const raw = await redis.get(key);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string);
      expect(parsed).toMatchObject({
        challenge: result.challenge,
        nonce: result.nonce,
        address: keypair.publicKey(),
      });
      expect(typeof parsed.timestamp).toBe('number');
      expect(typeof parsed.audience).toBe('string');
      expect(parsed.timestamp).toBeGreaterThan(Date.now() - 5000);
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(redis.set.mock.calls[0][2]).toMatchObject({ EX: 300 });
    });
  });

  describe('verifySignature — atomic consumption', () => {
    const signDto = async (keypair: Keypair, challenge: string): Promise<VerifySignatureDto> => {
      const signed = keypair.sign(Buffer.from(challenge)).toString('hex');
      return {
        address: keypair.publicKey(),
        originalChallenge: challenge,
        signedChallenge: signed,
      };
    };

    it('succeeds once with a valid signature via GETDEL, then rejects a replay with "already consumed"', async () => {
      const keypair = Keypair.random();
      const { challenge } = await service.generateChallenge(keypair.publicKey());
      const dto = await signDto(keypair, challenge);

      const first = await service.verifySignature(dto);
      expect(first.tokenType).toBe('Bearer');
      expect(first.accessToken).toBeTruthy();
      expect(first.refreshToken).toBeTruthy();

      expect(redis.getDel).toHaveBeenCalledTimes(1);
      expect(await redis.get(`challenge:${keypair.publicKey()}`)).toBeNull();

      await expect(service.verifySignature(dto)).rejects.toThrow(
        /already consumed.*request a fresh challenge/i,
      );
    });

    it('concurrent replays produce exactly one success and deterministic failures', async () => {
      const keypair = Keypair.random();
      const { challenge } = await service.generateChallenge(keypair.publicKey());
      const dto = await signDto(keypair, challenge);

      const results = await Promise.allSettled([
        service.verifySignature(dto),
        service.verifySignature(dto),
        service.verifySignature(dto),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(2);
      for (const r of rejected) {
        expect(r.status).toBe('rejected');
        const reason = (r as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(UnauthorizedException);
        expect(reason.message).toMatch(/already consumed|request a fresh challenge/i);
      }
    });

    it('rejects a challenge submitted under a different address than it was issued for', async () => {
      const issuer = Keypair.random();
      const attacker = Keypair.random();
      const { challenge } = await service.generateChallenge(issuer.publicKey());

      const signedAsAttacker = attacker.sign(Buffer.from(challenge)).toString('hex');
      const dto: VerifySignatureDto = {
        address: attacker.publicKey(),
        originalChallenge: challenge,
        signedChallenge: signedAsAttacker,
      };

      await expect(service.verifySignature(dto)).rejects.toThrow(
        /not found, expired, or already consumed/i,
      );
    });

    it('rejects when submitted challenge content does not match stored', async () => {
      const keypair = Keypair.random();
      await service.generateChallenge(keypair.publicKey());

      const fakeChallenge = `Verdant Bond Protocol sign-in\nAddress: ${keypair.publicKey()}\nNonce: ${'0'.repeat(64)}\nTimestamp: ${Date.now()}`;
      const signed = keypair.sign(Buffer.from(fakeChallenge)).toString('hex');
      const dto: VerifySignatureDto = {
        address: keypair.publicKey(),
        originalChallenge: fakeChallenge,
        signedChallenge: signed,
      };

      await expect(service.verifySignature(dto)).rejects.toThrow(
        /content does not match/i,
      );
    });

    it('rejects when stored timestamp is outside the TTL window', async () => {
      const keypair = Keypair.random();
      const { challenge } = await service.generateChallenge(keypair.publicKey());
      const dto = await signDto(keypair, challenge);

      const key = `challenge:${keypair.publicKey()}`;
      const raw = (await redis.get(key)) as string;
      const stored = JSON.parse(raw);
      stored.timestamp = Date.now() - 301 * 1000;
      await redis.set(key, JSON.stringify(stored), { EX: 300 });

      await expect(service.verifySignature(dto)).rejects.toThrow(
        /has expired.*request a fresh challenge/i,
      );
    });

    it('rejects malformed stored JSON with "Please request a fresh challenge"', async () => {
      const keypair = Keypair.random();
      const { challenge } = await service.generateChallenge(keypair.publicKey());
      const dto = await signDto(keypair, challenge);

      const key = `challenge:${keypair.publicKey()}`;
      await redis.set(key, 'not-json', { EX: 300 });

      await expect(service.verifySignature(dto)).rejects.toThrow(
        /malformed.*request a fresh challenge/i,
      );
    });

    it('rejects invalid signature even when challenge metadata matches', async () => {
      const keypair = Keypair.random();
      const other = Keypair.random();
      const { challenge } = await service.generateChallenge(keypair.publicKey());
      const wrongSignature = other.sign(Buffer.from(challenge)).toString('hex');
      const dto: VerifySignatureDto = {
        address: keypair.publicKey(),
        originalChallenge: challenge,
        signedChallenge: wrongSignature,
      };

      await expect(service.verifySignature(dto)).rejects.toThrow(/Invalid signature/);
    });
  });
});