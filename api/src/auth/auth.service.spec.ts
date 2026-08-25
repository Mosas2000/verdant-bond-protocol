import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.JWT_EXPIRY = '15m';
    process.env.JWT_REFRESH_EXPIRY = '7d';
    jwtService = new JwtService({ secret: process.env.JWT_SECRET });
    service = new AuthService(
      jwtService,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('refreshes an access token after the access token has expired', async () => {
    const expiredAccessToken = jwtService.sign(
      { sub: 'GUSER', kycStatus: 'verified' },
      { expiresIn: -1 },
    );
    const refreshToken = jwtService.sign(
      { sub: 'GUSER', kycStatus: 'verified', tokenType: 'refresh' },
      { secret: 'refresh-secret', expiresIn: '7d' },
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
      { secret: 'refresh-secret', expiresIn: -1 },
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