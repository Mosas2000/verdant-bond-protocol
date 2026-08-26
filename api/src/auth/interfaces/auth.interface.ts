export interface ChallengeResponse {
  challenge: string;
  nonce: string;
}

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: string;
  refreshExpiresIn?: string;
}

export interface UserProfileResponse {
  walletAddress: string;
  kycStatus: string;
  createdAt: string;
}
