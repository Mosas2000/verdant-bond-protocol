import { Injectable, computed, inject, signal } from '@angular/core';
import { StrKey } from '@stellar/stellar-sdk';
import { WalletService } from '../../auth/wallet.service';
import { environment } from '../../../environments/environment';

/**
 * The literal that used to ship in both environment files (issue #167). It is
 * not a valid Stellar account, so every `address === environment.adminAddress`
 * comparison silently evaluated to false. Kept here so the build-time check and
 * the runtime warning can name it explicitly.
 */
export const ADMIN_ADDRESS_PLACEHOLDER = 'G...';

export function isValidAdminAddress(value: string | null | undefined): boolean {
  if (!value || value === ADMIN_ADDRESS_PLACEHOLDER) return false;
  try {
    return StrKey.isValidEd25519PublicKey(value);
  } catch {
    return false;
  }
}

/**
 * Single source of truth for "is the connected wallet the protocol admin?".
 *
 * `environment.adminAddress` is validated once, on construction. A missing or
 * malformed value disables every admin affordance and reports why, instead of
 * comparing wallets against garbage and silently never matching.
 */
@Injectable({ providedIn: 'root' })
export class AdminAccessService {
  private readonly walletService = inject(WalletService);

  /** The configured admin account, or `null` when unset/invalid. */
  readonly adminAddress = signal<string | null>(
    isValidAdminAddress(environment.adminAddress) ? environment.adminAddress : null,
  );

  /** False when this deployment has no usable admin address configured. */
  readonly isConfigured = computed(() => this.adminAddress() !== null);

  readonly isAdmin = computed(() => {
    const admin = this.adminAddress();
    return admin !== null && this.walletService.address() === admin;
  });

  /** Explains to an operator why the admin UI is hidden. */
  readonly misconfigurationReason = computed(() => {
    if (this.isConfigured()) return null;
    if (environment.adminAddress === ADMIN_ADDRESS_PLACEHOLDER) {
      return `environment.adminAddress is still the '${ADMIN_ADDRESS_PLACEHOLDER}' placeholder; admin features are disabled.`;
    }
    if (environment.adminAddress) {
      return 'environment.adminAddress is not a valid Stellar public key; admin features are disabled.';
    }
    return 'environment.adminAddress is not configured for this deployment; admin features are disabled.';
  });

  constructor() {
    const reason = this.misconfigurationReason();
    if (reason) {
      console.warn(`[AdminAccess] ${reason}`);
    }
  }
}
