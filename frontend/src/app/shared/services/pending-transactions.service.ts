import { Injectable, inject, signal, computed } from '@angular/core';
import { Subscription, timer, switchMap, takeWhile } from 'rxjs';
import { ApiService } from './api.service';
import { TransactionStatus } from '../interfaces/bond.interface';

export interface PendingTx {
  hash: string;
  operation: string;
  status: TransactionStatus;
  submittedAt: number;
}

const STORAGE_KEY = 'nbs_pending_txs';
const POLL_INTERVAL_MS = 4000;

function loadFromStorage(): PendingTx[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Tracks submitted Soroban transactions across pending/confirmed/failed
 * states, persisted to localStorage (mirrors AuthService.token's
 * seed-from-localStorage pattern) so a page refresh doesn't lose visibility
 * into a still-pending transaction. Polls api/src/stellar's
 * GET /stellar/transactions/:hash via ApiService.getTransactionStatus.
 */
@Injectable({ providedIn: 'root' })
export class PendingTransactionsService {
  private readonly apiService = inject(ApiService);

  readonly entries = signal<PendingTx[]>(loadFromStorage());
  readonly pendingCount = computed(() => this.entries().filter((e) => e.status === 'pending').length);

  private readonly polls = new Map<string, Subscription>();

  constructor() {
    // Resume polling for anything still pending from a previous session/refresh.
    for (const entry of this.entries()) {
      if (entry.status === 'pending') this.poll(entry.hash);
    }
  }

  register(hash: string | undefined, operation: string): void {
    if (!hash) return;
    const entry: PendingTx = { hash, operation, status: 'pending', submittedAt: Date.now() };
    this.entries.update((entries) => [entry, ...entries.filter((e) => e.hash !== hash)]);
    this.persist();
    this.poll(hash);
  }

  private poll(hash: string): void {
    this.polls.get(hash)?.unsubscribe();
    const sub = timer(0, POLL_INTERVAL_MS)
      .pipe(
        switchMap(() => this.apiService.getTransactionStatus(hash)),
        takeWhile((res) => res.status === 'pending', true),
      )
      .subscribe({
        next: (res) => this.updateStatus(hash, res.status),
        error: () => this.updateStatus(hash, 'failed'),
      });
    this.polls.set(hash, sub);
  }

  private updateStatus(hash: string, status: TransactionStatus): void {
    this.entries.update((entries) => entries.map((e) => (e.hash === hash ? { ...e, status } : e)));
    this.persist();
    if (status !== 'pending') this.polls.get(hash)?.unsubscribe();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries()));
    } catch {
      // localStorage may be unavailable (private browsing, quota) — visibility
      // just won't survive a refresh in that case.
    }
  }
}
