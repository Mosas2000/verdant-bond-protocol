import { Routes } from '@angular/router';
import { walletAuthGuard } from '../auth/guards/wallet-auth.guard';

const routes: Routes = [
  { path: '', loadComponent: () => import('./marketplace-list/marketplace-list.component').then(m => m.MarketplaceListComponent) },
  { path: 'sell', canActivate: [walletAuthGuard], loadComponent: () => import('./marketplace-sell/marketplace-sell.component').then(m => m.MarketplaceSellComponent) },
];

export default routes;
