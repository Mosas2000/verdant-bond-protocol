import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { WalletService } from './wallet.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly walletService = inject(WalletService);

  readonly token = signal<string | null>(localStorage.getItem('nbs_access_token'));
  readonly isAuthenticated = computed(() => this.token() !== null);

  /** True once both the wallet plugin is connected AND a JWT session exists.
   *  Single source of truth for gating protected routes/actions (see
   *  auth/guards/wallet-auth.guard.ts). */
  readonly sessionReady = computed(() => this.isAuthenticated() && this.walletService.isConnected());

  async login(): Promise<void> {
    const address = this.walletService.address();
    if (!address) throw new Error('Wallet not connected');

    const { challenge } = await firstValueFrom(
      this.http.post<{ challenge: string }>('/api/auth/challenge', { address }),
    );

    const signedChallenge = await this.walletService.signChallenge(challenge);

    const { accessToken, refreshToken } = await firstValueFrom(
      this.http.post<{ accessToken: string; refreshToken: string }>('/api/auth/verify', {
        address,
        signedChallenge,
        originalChallenge: challenge,
      }),
    );

    localStorage.setItem('nbs_access_token', accessToken);
    localStorage.setItem('nbs_refresh_token', refreshToken);
    this.token.set(accessToken);
  }

  async refresh(): Promise<void> {
    const refreshToken = localStorage.getItem('nbs_refresh_token');
    if (!refreshToken) throw new Error('No refresh token available');

    const { accessToken } = await firstValueFrom(
      this.http.post<{ accessToken: string }>('/api/auth/refresh', { refreshToken }),
    );
    localStorage.setItem('nbs_access_token', accessToken);
    this.token.set(accessToken);
  }

  logout(): void {
    localStorage.removeItem('nbs_access_token');
    localStorage.removeItem('nbs_refresh_token');
    this.token.set(null);
    this.walletService.disconnect();
  }
}
