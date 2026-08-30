import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, Observable, throwError } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { WalletService } from '../../auth/wallet.service';
import { AdminIntentService, SignedAdminIntent } from './admin-intent.service';
import {
  Bond, HeldBond, Project, Order, PaginatedResponse,
  SubscriptionResponse, CreateProjectDto, CreateBondDto, OrderQueryParams, ListBondDto, BuyBondDto,
  ClaimCreditsResponse, TransferResponse,
  UndistributedTotalResponse, SweepUndistributedResponse,
  QuoteBalanceResponse, QuoteTransactionResponse,
  QuoteAsset, DepositQuoteDto, WithdrawQuoteDto, HolderResponse,
} from '../interfaces/bond.interface';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  instance?: string;
  correlationId?: string;
  errors?: Array<{ field: string; message: string }>;
  contract?: { address?: string; method?: string; rawErrorCode?: number };
}

export class ApiProblemError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail || problem.title);
  }
}

/** Lifecycle status of an oracle report (see docs/oracle-challenge-lifecycle.md). */
export type OracleReportStatus = 'Pending' | 'Verified' | 'Challenged' | 'Rejected';

export interface ChallengeRecord {
  reportId: number;
  challengerAddress: string;
  counterEvidenceHash: string;
  submittedAt: string;
  resolved: boolean;
  resolution: OracleReportStatus | null;
}

export interface ChallengeStateResponse {
  reportId: number;
  status: OracleReportStatus;
  challenged: boolean;
  challenges: ChallengeRecord[];
}

export interface ChallengedReportSummary {
  report: {
    id: number;
    projectId: string;
    status: OracleReportStatus;
    providerAddress: string;
    createdAt: string;
  };
  challenge: ChallengeRecord | null;
}

export interface CouponEligibility {
  projectId: string;
  eligible: boolean;
  reasons: string[];
  blockedByReportIds: number[];
}

/**
 * Consolidated, atomically-fetched bond detail (issue #4). A single call returns
 * the bond summary, holders, coupon undistributed total, and maturity status so
 * the frontend can refresh every panel together and never render a mix of
 * pre- and post-mutation data. `loadedAt` is the server timestamp used by the
 * client refresh model to detect staleness.
 */
export interface BondDetailResponse {
  bond: Bond;
  holders: HolderResponse[];
  coupon: { undistributedTotal: string };
  maturity: { reached: boolean; date: number; secondsUntil: number };
  loadedAt: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly walletService = inject(WalletService);
  private readonly adminIntent = inject(AdminIntentService);

  private headers(extra?: Record<string, string>): HttpHeaders {
    const token = this.authService.token();
    const walletAddress = this.walletService.address();
    let headers = new HttpHeaders(
      token ? { Authorization: `Bearer ${token}` } : {},
    );
    if (walletAddress) {
      headers = headers.set('x-wallet-address', walletAddress);
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        headers = headers.set(k, v);
      }
    }
    return headers;
  }

  /** Produce an `x-admin-intent` header for a high-risk admin action (#115). */
  private adminIntentHeader(action: string, target: string): Record<string, string> | undefined {
    if (!this.adminIntent.hasSecret) return undefined;
    try {
      const intent: SignedAdminIntent = this.adminIntent.create(action, target);
      return { 'x-admin-intent': JSON.stringify(intent) };
    } catch {
      return undefined;
    }
  }

  /** Generate a stable idempotency key for a user action (#114). */
  generateIdempotencyKey(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  private withProblemDetails<T>(source: Observable<T>): Observable<T> {
    return source.pipe(
      catchError((error: HttpErrorResponse) => {
        const body = error.error;
        if (body && typeof body === 'object' && 'type' in body && 'status' in body && 'code' in body) {
          return throwError(() => new ApiProblemError(body as ProblemDetails));
        }
        return throwError(() => error);
      }),
    );
  }

  getBonds(page = 1, limit = 20): Observable<PaginatedResponse<Bond>> {
    return this.withProblemDetails(this.http.get<PaginatedResponse<Bond>>('/api/bonds', {
      params: { page, limit },
      headers: this.headers(),
    }));
  }

  getBond(id: number): Observable<Bond> {
    return this.withProblemDetails(this.http.get<Bond>(`/api/bonds/${id}`, { headers: this.headers() }));
  }

  getHeldBonds(address: string): Observable<HeldBond[]> {
    return this.withProblemDetails(this.http.get<HeldBond[]>(`/api/bonds/held/${address}`, {
      headers: this.headers(),
    }));
  }

  issueBond(data: CreateBondDto): Observable<Bond> {
    const headers = this.headers(this.adminIntentHeader('issue_bond', 'global'));
    return this.withProblemDetails(this.http.post<Bond>('/api/bonds', data, { headers }));
  }

  subscribeToBond(id: number, amount: number, idempotencyKey?: string): Observable<SubscriptionResponse> {
    const investorAddress = this.walletService.address();
    const headers = this.headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
    return this.withProblemDetails(this.http.post<SubscriptionResponse>(
      `/api/bonds/${id}/subscribe`,
      { amount, investorAddress },
      { headers },
    ));
  }

  claimCredits(id: number, idempotencyKey?: string): Observable<ClaimCreditsResponse> {
    const investorAddress = this.walletService.address();
    const headers = this.headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
    return this.withProblemDetails(this.http.post<ClaimCreditsResponse>(
      `/api/bonds/${id}/claim`,
      { investorAddress },
      { headers },
    ));
  }

  transferBond(id: number, toAddress: string, amount: number, idempotencyKey?: string): Observable<TransferResponse> {
    const fromAddress = this.walletService.address();
    const headers = this.headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
    return this.withProblemDetails(this.http.post<TransferResponse>(
      `/api/bonds/${id}/transfer`,
      { fromAddress, toAddress, amount },
      { headers },
    ));
  }

  getUndistributedTotal(id: number): Observable<UndistributedTotalResponse> {
    return this.withProblemDetails(this.http.get<UndistributedTotalResponse>(
      `/api/bonds/${id}/undistributed`,
      { headers: this.headers() },
    ));
  }

  sweepUndistributed(id: number): Observable<SweepUndistributedResponse> {
    const headers = this.headers(this.adminIntentHeader('sweep_undistributed', String(id)));
    return this.withProblemDetails(this.http.post<SweepUndistributedResponse>(
      `/api/bonds/${id}/sweep-undistributed`,
      {},
      { headers },
    ));
  }

  getProjects(page = 1, limit = 20): Observable<PaginatedResponse<Project>> {
    return this.withProblemDetails(this.http.get<PaginatedResponse<Project>>('/api/projects', {
      params: { page, limit },
    }));
  }

  getProject(id: number): Observable<Project> {
    return this.withProblemDetails(this.http.get<Project>(`/api/projects/${id}`));
  }

  registerProject(data: CreateProjectDto): Observable<Project> {
    return this.withProblemDetails(this.http.post<Project>('/api/projects', data, { headers: this.headers() }));
  }

  getOrders(params: OrderQueryParams = {}, refresh = false): Observable<PaginatedResponse<Order>> {
    let queryParams = new HttpParams();
    if (params.bondId !== undefined) queryParams = queryParams.set('bondId', params.bondId);
    if (params.status !== undefined) queryParams = queryParams.set('status', params.status);
    if (params.page !== undefined) queryParams = queryParams.set('page', params.page);
    if (params.limit !== undefined) queryParams = queryParams.set('limit', params.limit);
    // Bypass any client-side/proxy HTTP caching so a refresh always hits the server.
    if (refresh) queryParams = queryParams.set('_t', Date.now());
    return this.withProblemDetails(this.http.get<PaginatedResponse<Order>>('/api/marketplace/orders', {
      params: queryParams, headers: this.headers(),
    }));
  }

  listBondTokens(data: ListBondDto, idempotencyKey?: string): Observable<Order> {
    const headers = this.headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
    return this.withProblemDetails(this.http.post<Order>('/api/marketplace/list', data, { headers }));
  }

  buyBondTokens(data: BuyBondDto, idempotencyKey?: string): Observable<void> {
    const headers = this.headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
    return this.withProblemDetails(this.http.post<void>('/api/marketplace/buy', data, { headers }));
  }

  cancelOrder(orderId: number): Observable<void> {
    return this.http.delete<void>(`/api/marketplace/orders/${orderId}`, { headers: this.headers() });
  }

  getQuoteBalance(asset: QuoteAsset = 'USDC'): Observable<QuoteBalanceResponse> {
    return this.withProblemDetails(this.http.get<QuoteBalanceResponse>('/api/marketplace/quote-balance', {
      params: { asset },
      headers: this.headers(),
    }));
  }

  getWalletBalance(asset: QuoteAsset = 'USDC'): Observable<QuoteBalanceResponse> {
    return this.withProblemDetails(this.http.get<QuoteBalanceResponse>('/api/marketplace/wallet-balance', {
      params: { asset },
      headers: this.headers(),
    }));
  }

  depositQuote(data: DepositQuoteDto, idempotencyKey?: string): Observable<QuoteTransactionResponse> {
    const headers = this.headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
    return this.withProblemDetails(this.http.post<QuoteTransactionResponse>('/api/marketplace/deposit', data, { headers }));
  }

  withdrawQuote(data: WithdrawQuoteDto, idempotencyKey?: string): Observable<QuoteTransactionResponse> {
    const headers = this.headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
    return this.withProblemDetails(this.http.post<QuoteTransactionResponse>('/api/marketplace/withdraw', data, { headers }));
  }

  getPortfolio(address?: string, force = false): Observable<any> {
    let params = new HttpParams();
    if (address) params = params.set('address', address);
    if (force) params = params.set('force', 'true');
    return this.withProblemDetails(this.http.get<any>('/api/portfolio', {
      params,
      headers: this.headers(),
    }));
  }

  /** Challenge review (#oracle-challenge): challenged reports for a project. */
  getProjectChallengedReports(projectId: string): Observable<ChallengedReportSummary[]> {
    return this.withProblemDetails(
      this.http.get<ChallengedReportSummary[]>(`/api/oracle/reports/${projectId}/challenges`),
    );
  }

  /** Challenge review (#oracle-challenge): full challenge state + history for a report. */
  getReportChallengeState(reportId: number): Observable<ChallengeStateResponse> {
    return this.withProblemDetails(
      this.http.get<ChallengeStateResponse>(`/api/oracle/challenges/${reportId}`),
    );
  }

  /** Coupon-distribution eligibility for a project, gated by challenge state. */
  getCouponEligibility(projectId: string): Observable<CouponEligibility> {
    return this.withProblemDetails(
      this.http.get<CouponEligibility>(`/api/oracle/projects/${projectId}/coupon-eligibility`),
    );
  }

  /**
   * Atomically refresh every panel of a bond's detail (issue #4). `_t` busts any
   * HTTP cache so the client sees fresh post-mutation data; the response carries
   * a server `loadedAt` timestamp the client uses for staleness detection.
   */
  getBondDetail(id: number, opts?: { bustCache?: boolean }): Observable<BondDetailResponse> {
    const params = opts?.bustCache === false ? undefined : new HttpParams().set('_t', Date.now().toString());
    return this.withProblemDetails(
      this.http.get<BondDetailResponse>(`/api/bonds/${id}/detail`, { params }),
    );
  }
}
