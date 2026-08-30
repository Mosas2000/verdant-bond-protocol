import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { KycGuard } from '../common/guards/kyc.guard';
import { ProviderGuard } from '../common/guards/provider.guard';
import { AuthController } from '../auth/auth.controller';
import { BondsController } from '../bonds/bonds.controller';
import { OracleController } from '../oracle/oracle.controller';
import { ProjectsController } from '../projects/projects.controller';
import { MarketplaceController } from '../marketplace/marketplace.controller';

/**
 * Single source of truth for the API route authorization matrix (issue #X part 1).
 *
 * Every controller route handler MUST be represented here. The companion spec
 * (`route-authorization.matrix.spec.ts`) walks the controllers at runtime, reads
 * the real `@UseGuards` metadata, and fails the build when:
 *   - a handler is missing from this matrix (new route added without review), or
 *   - the declared guards diverge from what is actually wired on the controller
 *     (a guard was removed from a sensitive route).
 *
 * Role taxonomy:
 *   - public        : no authentication required (read or write).
 *   - wallet-header : caller identity is taken from `x-wallet-address` only; no
 *                     JWT/KYC enforced at the API boundary (marketplace flow).
 *   - authenticated : a valid JWT session is required (JwtAuthGuard).
 *   - admin         : JWT session AND the configured admin key (AdminGuard).
 *
 * NOTE: No controller route currently requires ProviderGuard or KycGuard directly.
 * Those guards are unit-tested in `guard-roles.spec.ts` and will be enforced here
 * the moment they are attached to a route.
 */

export type GuardRef =
  | typeof JwtAuthGuard
  | typeof AdminGuard
  | typeof KycGuard
  | typeof ProviderGuard;

export type RouteRole = 'public' | 'wallet-header' | 'authenticated' | 'admin';

export interface RouteAuthEntry {
  controller: any;
  method: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  guards: GuardRef[];
  role: RouteRole;
  mutation: boolean;
}

export const ROUTE_AUTHORIZATION_MATRIX: RouteAuthEntry[] = [
  // ---- Auth ----
  { controller: AuthController, method: 'challenge', httpMethod: 'POST', path: 'auth/challenge', guards: [], role: 'public', mutation: true },
  { controller: AuthController, method: 'verify', httpMethod: 'POST', path: 'auth/verify', guards: [], role: 'public', mutation: true },
  { controller: AuthController, method: 'refresh', httpMethod: 'POST', path: 'auth/refresh', guards: [], role: 'public', mutation: true },
  { controller: AuthController, method: 'profile', httpMethod: 'GET', path: 'auth/profile', guards: [JwtAuthGuard], role: 'authenticated', mutation: false },
  { controller: AuthController, method: 'getKyc', httpMethod: 'GET', path: 'auth/kyc/:address', guards: [JwtAuthGuard], role: 'authenticated', mutation: false },
  { controller: AuthController, method: 'updateKyc', httpMethod: 'POST', path: 'auth/kyc/:address', guards: [JwtAuthGuard], role: 'authenticated', mutation: true },

  // ---- Bonds ----
  { controller: BondsController, method: 'create', httpMethod: 'POST', path: 'bonds', guards: [], role: 'public', mutation: true },
  { controller: BondsController, method: 'findAll', httpMethod: 'GET', path: 'bonds', guards: [], role: 'public', mutation: false },
  { controller: BondsController, method: 'findHeldByAddress', httpMethod: 'GET', path: 'bonds/held/:address', guards: [], role: 'public', mutation: false },
  { controller: BondsController, method: 'findOne', httpMethod: 'GET', path: 'bonds/:id', guards: [], role: 'public', mutation: false },
  { controller: BondsController, method: 'getBondDetail', httpMethod: 'GET', path: 'bonds/:id/detail', guards: [], role: 'public', mutation: false },
  { controller: BondsController, method: 'subscribe', httpMethod: 'POST', path: 'bonds/:id/subscribe', guards: [], role: 'public', mutation: true },
  { controller: BondsController, method: 'getHolders', httpMethod: 'GET', path: 'bonds/:id/holders', guards: [], role: 'public', mutation: false },
  { controller: BondsController, method: 'distributeCoupon', httpMethod: 'POST', path: 'bonds/:id/coupon', guards: [], role: 'public', mutation: true },
  { controller: BondsController, method: 'claimCredits', httpMethod: 'POST', path: 'bonds/:id/claim', guards: [], role: 'public', mutation: true },
  { controller: BondsController, method: 'getUndistributedTotal', httpMethod: 'GET', path: 'bonds/:id/undistributed', guards: [], role: 'public', mutation: false },
  { controller: BondsController, method: 'sweepUndistributed', httpMethod: 'POST', path: 'bonds/:id/sweep-undistributed', guards: [JwtAuthGuard, AdminGuard], role: 'admin', mutation: true },
  { controller: BondsController, method: 'transfer', httpMethod: 'POST', path: 'bonds/:id/transfer', guards: [], role: 'public', mutation: true },
  { controller: BondsController, method: 'mature', httpMethod: 'POST', path: 'bonds/:id/mature', guards: [], role: 'public', mutation: true },
  { controller: BondsController, method: 'exportBond', httpMethod: 'GET', path: 'bonds/:id/export', guards: [JwtAuthGuard], role: 'authenticated', mutation: false },

  // ---- Oracle ----
  { controller: OracleController, method: 'submitReport', httpMethod: 'POST', path: 'oracle/reports', guards: [], role: 'wallet-header', mutation: true },
  { controller: OracleController, method: 'getProjectReports', httpMethod: 'GET', path: 'oracle/reports/:projectId', guards: [], role: 'public', mutation: false },
  { controller: OracleController, method: 'getProjectChallengedReports', httpMethod: 'GET', path: 'oracle/reports/:projectId/challenges', guards: [], role: 'public', mutation: false },
  { controller: OracleController, method: 'getReportChallengeState', httpMethod: 'GET', path: 'oracle/challenges/:reportId', guards: [], role: 'public', mutation: false },
  { controller: OracleController, method: 'getCouponEligibility', httpMethod: 'GET', path: 'oracle/projects/:projectId/coupon-eligibility', guards: [], role: 'public', mutation: false },
  { controller: OracleController, method: 'challengeReport', httpMethod: 'POST', path: 'oracle/challenge/:reportId', guards: [], role: 'wallet-header', mutation: true },
  { controller: OracleController, method: 'registerProvider', httpMethod: 'POST', path: 'oracle/providers', guards: [], role: 'public', mutation: true },
  { controller: OracleController, method: 'listProviders', httpMethod: 'GET', path: 'oracle/providers', guards: [], role: 'public', mutation: false },
  { controller: OracleController, method: 'getProviderStats', httpMethod: 'GET', path: 'oracle/stats/:providerAddress', guards: [], role: 'public', mutation: false },
  { controller: OracleController, method: 'staleness', httpMethod: 'GET', path: 'oracle/monitoring/staleness', guards: [], role: 'public', mutation: false },
  { controller: OracleController, method: 'listIncidents', httpMethod: 'GET', path: 'oracle/incidents', guards: [JwtAuthGuard, AdminGuard], role: 'admin', mutation: false },
  { controller: OracleController, method: 'acknowledgeIncident', httpMethod: 'POST', path: 'oracle/incidents/:id/acknowledge', guards: [JwtAuthGuard, AdminGuard], role: 'admin', mutation: true },
  { controller: OracleController, method: 'resolveIncident', httpMethod: 'POST', path: 'oracle/incidents/:id/resolve', guards: [JwtAuthGuard, AdminGuard], role: 'admin', mutation: true },

  // ---- Projects ----
  { controller: ProjectsController, method: 'register', httpMethod: 'POST', path: 'projects', guards: [], role: 'public', mutation: true },
  { controller: ProjectsController, method: 'findAll', httpMethod: 'GET', path: 'projects', guards: [], role: 'public', mutation: false },
  { controller: ProjectsController, method: 'findOne', httpMethod: 'GET', path: 'projects/:id', guards: [], role: 'public', mutation: false },
  { controller: ProjectsController, method: 'approve', httpMethod: 'POST', path: 'projects/:id/approve', guards: [], role: 'public', mutation: true },
  { controller: ProjectsController, method: 'reject', httpMethod: 'POST', path: 'projects/:id/reject', guards: [], role: 'public', mutation: true },
  { controller: ProjectsController, method: 'uploadDocuments', httpMethod: 'POST', path: 'projects/:id/documents', guards: [], role: 'public', mutation: true },
  { controller: ProjectsController, method: 'exportProject', httpMethod: 'GET', path: 'projects/:id/export', guards: [JwtAuthGuard], role: 'authenticated', mutation: false },

  // ---- Marketplace ----
  { controller: MarketplaceController, method: 'listQuoteAssets', httpMethod: 'GET', path: 'marketplace/quote-assets', guards: [], role: 'public', mutation: false },
  { controller: MarketplaceController, method: 'listOrders', httpMethod: 'GET', path: 'marketplace/orders', guards: [], role: 'public', mutation: false },
  { controller: MarketplaceController, method: 'listBondTokens', httpMethod: 'POST', path: 'marketplace/list', guards: [], role: 'wallet-header', mutation: true },
  { controller: MarketplaceController, method: 'buyBondTokens', httpMethod: 'POST', path: 'marketplace/buy', guards: [], role: 'wallet-header', mutation: true },
  { controller: MarketplaceController, method: 'getQuoteBalance', httpMethod: 'GET', path: 'marketplace/quote-balance', guards: [], role: 'wallet-header', mutation: false },
  { controller: MarketplaceController, method: 'getWalletBalance', httpMethod: 'GET', path: 'marketplace/wallet-balance', guards: [], role: 'wallet-header', mutation: false },
  { controller: MarketplaceController, method: 'depositQuote', httpMethod: 'POST', path: 'marketplace/deposit', guards: [], role: 'wallet-header', mutation: true },
  { controller: MarketplaceController, method: 'withdrawQuote', httpMethod: 'POST', path: 'marketplace/withdraw', guards: [], role: 'wallet-header', mutation: true },
  { controller: MarketplaceController, method: 'cancelOrder', httpMethod: 'DELETE', path: 'marketplace/orders/:id', guards: [], role: 'wallet-header', mutation: true },
  { controller: MarketplaceController, method: 'getOrder', httpMethod: 'GET', path: 'marketplace/orders/:id', guards: [], role: 'public', mutation: false },
  { controller: MarketplaceController, method: 'getPriceFeed', httpMethod: 'GET', path: 'marketplace/prices', guards: [], role: 'public', mutation: false },
  { controller: MarketplaceController, method: 'getBestPrice', httpMethod: 'GET', path: 'marketplace/prices/:bondId/best', guards: [], role: 'public', mutation: false },
  { controller: MarketplaceController, method: 'calculateSlippage', httpMethod: 'GET', path: 'marketplace/prices/:bondId/slippage', guards: [], role: 'public', mutation: false },
  { controller: MarketplaceController, method: 'runReconciliation', httpMethod: 'POST', path: 'marketplace/reconciliation/run', guards: [], role: 'wallet-header', mutation: true },
  { controller: MarketplaceController, method: 'listReconciliationMismatches', httpMethod: 'GET', path: 'marketplace/reconciliation/mismatches', guards: [], role: 'wallet-header', mutation: false },
  { controller: MarketplaceController, method: 'repairReconciliation', httpMethod: 'POST', path: 'marketplace/reconciliation/repair', guards: [], role: 'wallet-header', mutation: true },
];
