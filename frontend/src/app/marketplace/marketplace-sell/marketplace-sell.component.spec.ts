import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { MarketplaceSellComponent } from './marketplace-sell.component';
import { ApiService } from '../../shared/services/api.service';
import { WalletService } from '../../auth/wallet.service';
import { PendingTransactionsService } from '../../shared/services/pending-transactions.service';

describe('MarketplaceSellComponent', () => {
  let component: MarketplaceSellComponent;
  let fixture: ComponentFixture<MarketplaceSellComponent>;
  let apiService: { getHeldBonds: jasmine.Spy; listBondTokens: jasmine.Spy; getQuoteBalance: jasmine.Spy; getWalletBalance: jasmine.Spy };

  beforeEach(async () => {
    apiService = {
      getHeldBonds: jasmine.createSpy('getHeldBonds').and.returnValue(of([
        { id: 1, creditType: 'Carbon', balance: '25' },
        { id: 2, creditType: 'BlueCarbon', balance: '10' },
      ])),
      listBondTokens: jasmine.createSpy('listBondTokens').and.returnValue(of({ id: 1 })),
      getQuoteBalance: jasmine
        .createSpy('getQuoteBalance')
        .and.callFake((asset: string) =>
          of({ address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', asset, balance: '50' }),
        ),
      getWalletBalance: jasmine
        .createSpy('getWalletBalance')
        .and.callFake((asset: string) =>
          of({ address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', asset, balance: '50' }),
        ),
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

  it('prevents a duplicate listing submission while one is already pending (#91)', () => {
    const pending = new Subject<{ id: number }>();
    apiService.listBondTokens.and.returnValue(pending);
    component.form.patchValue({ bondId: 1, amount: 10, pricePerToken: 5 });

    component.onSubmit();
    expect(apiService.listBondTokens).toHaveBeenCalledTimes(1);
    expect(component.submitting()).toBe(true);

    // A second submit attempt (e.g. a repeated Enter keypress) while the
    // first is still in flight must be a no-op, not a second request.
    component.onSubmit();
    expect(apiService.listBondTokens).toHaveBeenCalledTimes(1);
  });
});
