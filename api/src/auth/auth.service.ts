import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Keypair } from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import { RedisService } from '../common/services/redis.service';
import { StellarService } from '../stellar/stellar.service';
import { KycService } from './kyc.service';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { ChallengeResponse, AuthTokenResponse, UserProfileResponse } from './interfaces/auth.interface';

@Injectable()
export class AuthService {
  private readonly accessTokenExpiry = process.env.JWT_EXPIRY || '15m';
  private readonly refreshTokenExpiry = process.env.JWT_REFRESH_EXPIRY || '7d';
  private readonly refreshTokenSecret =
    process.env.JWT_REFRESH_SECRET || `${process.env.JWT_SECRET || 'dev-secret-change-in-production'}:refresh`;

  constructor(
    private readonly jwtService: JwtService,
    private readonly kycService: KycService,
    private readonly stellarService: StellarService,
    private readonly redis: RedisService,
  ) {}

  async generateChallenge(address: string): Promise<ChallengeResponse> {
    if (!this.stellarService.isValidPublicKey(address)) {
      throw new BadRequestException('Invalid Stellar address');
    }

    const nonce = crypto.randomBytes(32).toString('hex');
    const challenge = `Verdant Bond Protocol sign-in\nAddress: ${address}\nNonce: ${nonce}\nTimestamp: ${Date.now()}`;

    await this.redis.set(`challenge:${address}`, challenge, { EX: 300 });

    return { challenge, nonce };
  }

  async verifySignature(dto: VerifySignatureDto): Promise<AuthTokenResponse> {
    const storedChallenge = await this.redis.get(`challenge:${dto.address}`);
    if (!storedChallenge || storedChallenge !== dto.originalChallenge) {
      throw new UnauthorizedException('Challenge not found or expired');
    }

    const keypair = Keypair.fromPublicKey(dto.address);
    const isValid = keypair.verify(
      Buffer.from(dto.originalChallenge),
      Buffer.from(dto.signedChallenge, 'hex'),
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    await this.redis.del(`challenge:${dto.address}`);

    const kycStatus = await this.kycService.getStatus(dto.address);

    const payload = { sub: dto.address, kycStatus };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(
      { ...payload, tokenType: 'refresh' },
      { secret: this.refreshTokenSecret, expiresIn: this.refreshTokenExpiry },
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTokenExpiry,
      refreshExpiresIn: this.refreshTokenExpiry,
    };
  }

  async refreshToken(token: string): Promise<AuthTokenResponse> {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.refreshTokenSecret,
      }) as { sub: string; kycStatus: string; tokenType: string };
      if (payload.tokenType !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newPayload = { sub: payload.sub, kycStatus: payload.kycStatus };
      const accessToken = this.jwtService.sign(newPayload);
      return { accessToken, tokenType: 'Bearer', expiresIn: this.accessTokenExpiry };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async getProfile(userId: string): Promise<UserProfileResponse> {
    const kycStatus = await this.kycService.getStatus(userId);
    return {
      walletAddress: userId,
      kycStatus,
      createdAt: new Date().toISOString(),
    };
  }
}
