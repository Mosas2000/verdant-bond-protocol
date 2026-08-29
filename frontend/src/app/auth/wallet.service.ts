import { Injectable, signal } from '@angular/core';
import { isConnected, getAddress, signTransaction } from '@stellar/freighter-api';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WalletService {
  readonly address = signal<string | null>(null);
  readonly isConnected = signal(false);
  readonly isConnecting = signal(false);
  readonly status = signal<WalletStatus>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly networkPassphrase = signal<string | null>(null);
  private readonly expectedNetworkPassphrase = environment.networkPassphrase;
  private accountPollId: ReturnType<typeof setInterval> | null = null;

  async connect(): Promise<void> {
    this.isConnecting.set(true);
    this.status.set('connecting');
    this.errorMessage.set(null);
    try {
      const connected = await isConnected();
      if (!connected.isConnected) {
        this.status.set('missing');
        this.errorMessage.set('Freighter is not installed or is unavailable.');
        throw new Error('Freighter not detected');
      }
      const { address } = await getAddress();
      if (!address) {
        this.status.set('locked');
        this.errorMessage.set('Unlock Freighter and try again.');
        throw new Error('Freighter wallet is locked');
      }
      await this.verifyNetwork();
      this.address.set(address);
      this.isConnected.set(true);
      this.status.set('connected');
      this.startAccountWatcher();
    } catch (error) {
      if (this.status() === 'connecting') {
        const message = error instanceof Error ? error.message : String(error);
        this.status.set(/reject|cancel/i.test(message) ? 'rejected' : 'error');
        this.errorMessage.set(message);
      }
      throw error;
    } finally {
      this.isConnecting.set(false);
    }
  }

  async signChallenge(challenge: string): Promise<string> {
    await this.verifyNetwork();
    const { signedTxXdr } = await signTransaction(challenge, {
      networkPassphrase: environment.networkPassphrase,
    });
    return signedTxXdr;
  }

  disconnect(): void {
    this.stopAccountWatcher();
    this.address.set(null);
    this.isConnected.set(false);
    this.status.set('idle');
    this.errorMessage.set(null);
    this.networkPassphrase.set(null);
  }

  async refreshAccountState(): Promise<void> {
    if (!this.isConnected()) return;
    try {
      const { address } = await getAddress();
      if (address && address !== this.address()) {
        this.address.set(address);
        this.status.set('account_changed');
        this.errorMessage.set('Wallet account changed. Review the active session before continuing.');
      }
      await this.verifyNetwork();
    } catch {
      this.status.set('locked');
      this.errorMessage.set('Freighter is locked or unavailable.');
      this.isConnected.set(false);
    }
  }

  private async verifyNetwork(): Promise<void> {
    const network = await getNetwork();
    const passphrase = typeof network === 'string' ? network : network.networkPassphrase;
    this.networkPassphrase.set(passphrase);
    if (passphrase !== this.expectedNetworkPassphrase) {
      this.status.set('network_mismatch');
      this.errorMessage.set('Switch Freighter to the configured Stellar network before continuing.');
      throw new Error('Freighter network mismatch');
    }
  }

  private startAccountWatcher(): void {
    this.stopAccountWatcher();
    this.accountPollId = setInterval(() => {
      void this.refreshAccountState();
    }, 5_000);
  }

  private stopAccountWatcher(): void {
    if (this.accountPollId) {
      clearInterval(this.accountPollId);
      this.accountPollId = null;
    }
  }
}
