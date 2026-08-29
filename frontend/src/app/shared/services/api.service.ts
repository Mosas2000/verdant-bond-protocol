import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, Observable, throwError } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { WalletService } from '../../auth/wallet.service';
import {
  Bond, HeldBond, Project, Order, PaginatedResponse,
  SubscriptionResponse, CreateProjectDto, CreateBondDto, OrderQueryParams, ListBondDto, BuyBondDto,
  ClaimCreditsResponse, TransferResponse,
  UndistributedTotalResponse, SweepUndistributedResponse,
  QuoteBalanceResponse, QuoteTransactionResponse,
  QuoteAsset, DepositQuoteDto, WithdrawQuoteDto,
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

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly walletService = inject(WalletService);

  private headers(): HttpHeaders {
    const token = this.authService.token();
    const walletAddress = this.walletService.address();
    let headers = new HttpHeaders(
      token ? { Authorization: `Bearer ${token}` } : {},
    );
    if (walletAddress) {
      headers = headers.set('x-wallet-address', walletAddress);
    }
    return headers;
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
    return this.withProblemDetails(this.http.post<Bond>('/api/bonds', data, { headers: this.headers() }));
  }

  subscribeToBond(id: number, amount: number): Observable<SubscriptionResponse> {
    const investorAddress = this.walletService.address();
    return this.withProblemDetails(this.http.post<SubscriptionResponse>(
      `/api/bonds/${id}/subscribe`,
      { amount, investorAddress },
      { headers: this.headers() },
    ));
  }

  claimCredits(id: number): Observable<ClaimCreditsResponse> {
    const investorAddress = this.walletService.address();
    return this.withProblemDetails(this.http.post<ClaimCreditsResponse>(
      `/api/bonds/${id}/claim`,
      { investorAddress },
      { headers: this.headers() },
    ));
  }

  transferBond(id: number, toAddress: string, amount: number): Observable<TransferResponse> {
    const fromAddress = this.walletService.address();
    return this.withProblemDetails(this.http.post<TransferResponse>(
      `/api/bonds/${id}/transfer`,
      { fromAddress, toAddress, amount },
      { headers: this.headers() },
    ));
  }

  getUndistributedTotal(id: number): Observable<UndistributedTotalResponse> {
    return this.withProblemDetails(this.http.get<UndistributedTotalResponse>(
      `/api/bonds/${id}/undistributed`,
      { headers: this.headers() },
    ));
  }

  sweepUndistributed(id: number): Observable<SweepUndistributedResponse> {
    return this.withProblemDetails(this.http.post<SweepUndistributedResponse>(
      `/api/bonds/${id}/sweep-undistributed`,
      {},
      { headers: this.headers() },
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

  listBondTokens(data: ListBondDto): Observable<Order> {
    return this.withProblemDetails(this.http.post<Order>('/api/marketplace/list', data, { headers: this.headers() }));
  }

  buyBondTokens(data: BuyBondDto): Observable<void> {
    return this.withProblemDetails(this.http.post<void>('/api/marketplace/buy', data, { headers: this.headers() }));
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

  depositQuote(data: DepositQuoteDto): Observable<QuoteTransactionResponse> {
    return this.withProblemDetails(this.http.post<QuoteTransactionResponse>('/api/marketplace/deposit', data, { headers: this.headers() }));
  }

  withdrawQuote(data: WithdrawQuoteDto): Observable<QuoteTransactionResponse> {
    return this.withProblemDetails(this.http.post<QuoteTransactionResponse>('/api/marketplace/withdraw', data, { headers: this.headers() }));
  }
}
