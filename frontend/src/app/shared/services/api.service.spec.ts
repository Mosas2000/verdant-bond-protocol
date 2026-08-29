import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from '../../auth/auth.service';
import { WalletService } from '../../auth/wallet.service';
import { CreateBondDto } from '../interfaces/bond.interface';

describe('ApiService', () => {
  let service: ApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { token: signal('test-token') } },
        { provide: WalletService, useValue: { address: signal('GTEST') } },
      ],
    });
    service = TestBed.inject(ApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('posts a typed bond issuance payload', () => {
    const payload: CreateBondDto = {
      projectId: 'project-1',
      faceValue: 1000,
      couponSchedule: [1750000000],
      creditType: 'Carbon',
      maturityDate: 1781536000,
      totalSupply: 100,
    };

    service.issueBond(payload).subscribe();

    const request = httpTesting.expectOne('/api/bonds');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    request.flush({});
  });

  it('serializes all supported order query filters', () => {
    service.getOrders({ bondId: 3, status: 'Open', page: 2, limit: 10 }).subscribe();

    const request = httpTesting.expectOne((req) => req.url === '/api/marketplace/orders');
    expect(request.request.params.get('bondId')).toBe('3');
    expect(request.request.params.get('status')).toBe('Open');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('limit')).toBe('10');
    request.flush({ data: [], meta: { page: 2, limit: 10, total: 0, totalPages: 1 } });
  });
});