import { Routes } from '@angular/router';
import { walletAuthGuard } from '../auth/guards/wallet-auth.guard';

const routes: Routes = [
  { path: '', loadComponent: () => import('./bonds-list/bonds-list.component').then(m => m.BondsListComponent) },
  { path: 'issue', canActivate: [walletAuthGuard], loadComponent: () => import('./issue-bond/issue-bond.component').then(m => m.IssueBondComponent) },
  { path: ':id', loadComponent: () => import('./bond-detail/bond-detail.component').then(m => m.BondDetailComponent) },
];

export default routes;
