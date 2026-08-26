import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MarketplaceSellComponent } from './marketplace-sell.component';
import { ApiService } from '../../shared/services/api.service';
import { WalletService } from '../../auth/wallet.service';
import { PendingTransactionsService } from '../../shared/services/pending-transactions.service';

describe('MarketplaceSellComponent', () => {
  let component: MarketplaceSellComponent;
  let fixture: ComponentFixture<MarketplaceSellComponent>;

  beforeEach(async () => {
    const apiService = {
      getHeldBonds: jasmine.createSpy('getHeldBonds').and.returnValue(of([
        { id: 1, creditType: 'Carbon', balance: 25 },
        { id: 2, creditType: 'BlueCarbon', balance: 10 },
      ])),
      listBondTokens: jasmine.createSpy('listBondTokens').and.returnValue(of({ id: 1, transactionHash: 'tx-list' })),
    };

    await TestBed.configureTestingModule({
      imports: [MarketplaceSellComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: apiService },
        { provide: WalletService, useValue: { isConnected: signal(true), address: signal('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF') } },
        { provide: PendingTransactionsService, useValue: jasmine.createSpyObj('PendingTransactionsService', ['register']) },
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(MarketplaceSellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('loads only bonds held by the connected wallet', () => {
    expect(component.bonds().map((bond) => bond.id)).toEqual([1, 2]);
    expect(fixture.nativeElement.querySelectorAll('#bondId option').length).toBe(3);
  });

  it('rejects an amount above the selected bond balance', () => {
    component.form.patchValue({ bondId: 1, amount: 26 });
    expect(component.form.get('amount')?.hasError('exceedsBalance')).toBeTrue();
  });

  it('has a valid default listing form', () => {
    expect(component.form.get('quoteAsset')?.value).toBe('USDC');
    expect(component.form.valid).toBe(false);
  });
});
