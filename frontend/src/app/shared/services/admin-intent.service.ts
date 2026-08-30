import { Injectable } from '@angular/core';
import { Keypair } from '@stellar/stellar-sdk';
import { environment } from '../../environments/environment';

export interface AdminIntentPayload {
  action: string;
  target: string;
  chain: string;
  expiry: number;
  nonce: string;
}

export interface SignedAdminIntent extends AdminIntentPayload {
  signature: string;
}

/**
 * Frontend/admin-tooling support for signed step-up intents (#115).
 *
 * High-risk admin actions must be accompanied by a fresh signed intent. The
 * admin signs a canonical message (`action|target|chain|expiry|nonce`) with
 * their Stellar ed25519 secret key. In a browser context this secret is
 * supplied by the admin console (never the end-user Freighter wallet).
 */
@Injectable({ providedIn: 'root' })
export class AdminIntentService {
  private secret: string | null = null;

  setAdminSecret(secret: string | null): void {
    this.secret = secret;
  }

  get hasSecret(): boolean {
    return !!this.secret;
  }

  build(action: string, target: string, chain: string = environment.networkPassphrase): AdminIntentPayload {
    return {
      action,
      target: String(target),
      chain,
      expiry: Date.now() + 5 * 60 * 1000,
      nonce: crypto.randomUUID(),
    };
  }

  sign(payload: AdminIntentPayload, secret: string | null = this.secret): SignedAdminIntent {
    if (!secret) {
      throw new Error('Admin signing secret is not configured; cannot produce a signed intent.');
    }
    const keypair = Keypair.fromSecret(secret);
    const message = `${payload.action}|${payload.target}|${payload.chain}|${payload.expiry}|${payload.nonce}`;
    const bytes = keypair.sign(new TextEncoder().encode(message));
    return { ...payload, signature: toBase64(bytes) };
  }

  /** Build and sign in one step. */
  create(action: string, target: string, chain?: string): SignedAdminIntent {
    return this.sign(this.build(action, target, chain));
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
