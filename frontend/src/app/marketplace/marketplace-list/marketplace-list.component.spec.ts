import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError, Observable, Subject } from 'rxjs';
import { MarketplaceListComponent, ORDERS_RETRY_BASE_DELAY_MS } from './marketplace-list.component';
import { ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../auth/auth.service';
import { WalletService } from '../../auth/wallet.service';
import { Order, PaginatedResponse } from '../../shared/interfaces/bond.interface';

const ORDER: Order = {
  id: 1,
  seller: 'GBOB',
  bondId: 3,
  amount: 20,
  pricePerToken: 10,
  quoteAsset: 'USDC',
  status: 'Open',
  createdAt: new Date().toISOString(),
};

const META = { page: 1, limit: 20, total: 1, totalPages: 1 };

const FRESH_ORDER: Order = { ...ORDER, status: 'Filled', amount: 5 };

describe('MarketplaceListComponent', () => {
  let component: MarketplaceListComponent;
  let fixture: ComponentFixture<MarketplaceListComponent>;
  let apiService: {
    getBonds: jasmine.Spy;
    getOrders: jasmine.Spy;
    buyBondTokens: jasmine.Spy;
    getQuoteBalance: jasmine.Spy;
  };
  let walletService: {
    isConnected: ReturnType<typeof signal<boolean>>;
    address: ReturnType<typeof signal<string | null>>;
  };

  beforeEach(async () => {
    apiService = {
      getBonds: jasmine.createSpy('getBonds').and.returnValue(of({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 1 } })),
      getOrders: jasmine.createSpy('getOrders').and.returnValue(of({ data: [ORDER], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } })),
      buyBondTokens: jasmine.createSpy('buyBondTokens').and.returnValue(of(undefined)),
      getQuoteBalance: jasmine
        .createSpy('getQuoteBalance')
        .and.callFake((asset: string) =>
          of({ address: 'GALICE', asset, balance: asset === 'USDC' ? 100 : 0 }),
        ),
    };

    walletService = {
      isConnected: signal(true),
      address: signal('GALICE'),
    };

    await TestBed.configureTestingModule({
      imports: [MarketplaceListComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: apiService },
        { provide: AuthService, useValue: { token: signal(null) } },
        { provide: WalletService, useValue: walletService },
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(MarketplaceListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('loads orders and bonds on init', () => {
    expect(apiService.getOrders).toHaveBeenCalled();
    expect(apiService.getBonds).toHaveBeenCalled();
  });

  it('loads the escrowed quote balance when connected', () => {
    expect(apiService.getQuoteBalance).toHaveBeenCalledWith('USDC');
    expect(apiService.getQuoteBalance).toHaveBeenCalledWith('XLM');
  });

  it('surfaces an insufficient escrow message and disables confirm', () => {
    component.openBuy(ORDER);
    component.buyAmount = 20;
    component.buyMaxPrice = 10;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Insufficient escrow');

    const confirm = el.querySelector<HTMLButtonElement>('.buy-actions .btn-primary');
    expect(confirm?.disabled).toBe(true);
  });

  it('allows confirm when the escrowed balance covers the purchase', () => {
    component.openBuy(ORDER);
    component.buyAmount = 5;
    component.buyMaxPrice = 10;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Escrow sufficient');

    const confirm = el.querySelector<HTMLButtonElement>('.buy-actions .btn-primary');
    expect(confirm?.disabled).toBe(false);
  });

  it('submits a buy order', () => {
    component.openBuy(ORDER);
    component.buyAmount = 5;
    component.buyMaxPrice = 10;
    component.onBuy(ORDER);

    expect(apiService.buyBondTokens).toHaveBeenCalledWith({
      orderId: 1,
      amount: 5,
      maxPrice: 10,
    });
  });

  describe('order refresh', () => {
    it('forces a fresh fetch that bypasses client-side caching on refresh', () => {
      apiService.getOrders.calls.reset();
      apiService.getOrders.and.returnValue(of({ data: [ORDER], meta: META }));

      component.refreshOrders();

      expect(apiService.getOrders).toHaveBeenCalledWith(undefined, true);
    });

    it('replaces a stale response with fresh order data on refresh', () => {
      const stale = { ...ORDER, status: 'Open' as Order['status'] };
      apiService.getOrders.calls.reset();
      apiService.getOrders.and.returnValues(
        of({ data: [stale], meta: META }),
        of({ data: [FRESH_ORDER], meta: META }),
      );

      component.refreshOrders();
      expect(component.orders()[0].status).toBe('Open');

      component.refreshOrders();
      expect(component.orders()[0].status).toBe('Filled');
      expect(component.orders()[0].amount).toBe(5);
    });

    it('updates the UI with fresh order data after a refresh', () => {
      apiService.getOrders.calls.reset();
      apiService.getOrders.and.returnValue(of({ data: [FRESH_ORDER], meta: META }));

      component.refreshOrders();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.textContent).toContain('Open Orders (1)');
      expect(el.textContent).toContain('Filled');
    });

    it('refreshes orders with cache bypass after a completed buy', () => {
      apiService.getOrders.calls.reset();
      apiService.getOrders.and.returnValue(of({ data: [ORDER], meta: META }));
      component.openBuy(ORDER);
      component.buyAmount = 5;
      component.buyMaxPrice = 10;

      component.onBuy(ORDER);

      expect(apiService.getOrders).toHaveBeenCalledWith(undefined, true);
    });
  });

  describe('order retry with backoff', () => {
    it('retries a transient failure only after the backoff delay', fakeAsync(() => {
      apiService.getOrders.calls.reset();
      apiService.getOrders.and.returnValues(
        throwError(() => new Error('network down')),
        of({ data: [ORDER], meta: META }),
      );

      component.refreshOrders();
      expect(apiService.getOrders).toHaveBeenCalledTimes(1);

      tick(ORDERS_RETRY_BASE_DELAY_MS - 1);
      expect(apiService.getOrders).toHaveBeenCalledTimes(1);

      tick(1);
      expect(apiService.getOrders).toHaveBeenCalledTimes(2);
      expect(component.orders()[0].id).toBe(ORDER.id);
      expect(component.loading()).toBe(false);
      expect(component.error()).toBe('');
    }));

    it('recovers when a retry eventually succeeds', fakeAsync(() => {
      apiService.getOrders.calls.reset();
      apiService.getOrders.and.returnValues(
        throwError(() => new Error('network down')),
        throwError(() => new Error('network down')),
        of({ data: [ORDER], meta: META }),
      );

      component.refreshOrders();
      tick(ORDERS_RETRY_BASE_DELAY_MS);
      tick(ORDERS_RETRY_BASE_DELAY_MS * 2);
      tick(ORDERS_RETRY_BASE_DELAY_MS * 4);

      expect(apiService.getOrders).toHaveBeenCalledTimes(3);
      expect(component.orders()[0].id).toBe(ORDER.id);
      expect(component.loading()).toBe(false);
      expect(component.error()).toBe('');
    }));

    it('handles persistent failures cleanly after retries are exhausted', fakeAsync(() => {
      apiService.getOrders.calls.reset();
      apiService.getOrders.and.returnValue(throwError(() => new Error('still down')));

      component.refreshOrders();
      expect(component.loading()).toBe(true);

      tick(ORDERS_RETRY_BASE_DELAY_MS);
      tick(ORDERS_RETRY_BASE_DELAY_MS * 2);
      tick(ORDERS_RETRY_BASE_DELAY_MS * 4);

      expect(apiService.getOrders).toHaveBeenCalledTimes(4);
      expect(component.loading()).toBe(false);
      expect(component.error()).toBe('Failed to load orders');
      expect(component.orders()).toEqual([ORDER]); // previously loaded data is preserved
    }));

    it('does not retry client errors (4xx)', fakeAsync(() => {
      apiService.getOrders.calls.reset();
      apiService.getOrders.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 400, statusText: 'Bad Request' })),
      );

      component.refreshOrders();
      tick(10000);

      expect(apiService.getOrders).toHaveBeenCalledTimes(1);
      expect(component.loading()).toBe(false);
      expect(component.error()).toBe('Failed to load orders');
    }));
  });

  describe('refresh concurrency', () => {
    it('does not stack duplicate subscriptions across repeated refreshes', () => {
      let active = 0;
      let maxActive = 0;
      apiService.getOrders.calls.reset();
      apiService.getOrders.and.callFake(() => new Observable(() => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        return () => { active -= 1; };
      }));

      component.refreshOrders();
      component.refreshOrders();
      component.refreshOrders();

      expect(apiService.getOrders).toHaveBeenCalledTimes(3);
      expect(maxActive).toBe(1);
    });

    it('ignores a stale in-flight response superseded by a newer refresh', () => {
      const first = new Subject<PaginatedResponse<Order>>();
      const second = new Subject<PaginatedResponse<Order>>();
      apiService.getOrders.calls.reset();
      apiService.getOrders.and.returnValues(first, second);

      component.refreshOrders();
      component.refreshOrders();

      // The first request was cancelled by the second refresh; its late response must not land.
      first.next({ data: [{ ...ORDER, id: 99 }], meta: META });
      expect(component.orders().map(o => o.id)).toEqual([1]);

      second.next({ data: [FRESH_ORDER], meta: META });
      second.complete(); // a real HTTP response completes; finalize clears the loading state
      expect(component.orders()[0].status).toBe('Filled');
      expect(component.loading()).toBe(false);
    });
  });
});
