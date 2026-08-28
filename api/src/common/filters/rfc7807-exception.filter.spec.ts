import { BadRequestException } from '@nestjs/common';
import { Rfc7807ExceptionFilter } from './rfc7807-exception.filter';
import { ContractException, StableErrorCode } from '../../stellar/contract-errors';

function makeHost(exceptionPath = '/api/test') {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const response = { status, setHeader: jest.fn() };
  const request = { url: exceptionPath, correlationId: 'corr-123' };
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  };
  return { host, status, json };
}

describe('Rfc7807ExceptionFilter', () => {
  it('normalizes validation errors with field details and correlation id', () => {
    const { host, status, json } = makeHost();
    const filter = new Rfc7807ExceptionFilter();

    filter.catch(new BadRequestException(['address must be a Stellar public key']), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'https://errors.verdant-bond-protocol.org/VALIDATION_ERROR',
        status: 400,
        code: 'VALIDATION_ERROR',
        correlationId: 'corr-123',
        errors: [{ field: 'address', message: 'address must be a Stellar public key' }],
      }),
    );
  });

  it('includes safe contract context for mapped contract exceptions', () => {
    const { host, status, json } = makeHost('/api/marketplace/buy');
    const filter = new Rfc7807ExceptionFilter();

    filter.catch(
      new ContractException(
        StableErrorCode.DEX_ORDER_ALREADY_FILLED,
        'Marketplace order is already filled',
        'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        'buy_order',
        5,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Contract Error',
        code: StableErrorCode.DEX_ORDER_ALREADY_FILLED,
        detail: 'Marketplace order is already filled',
        contract: {
          address: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
          method: 'buy_order',
          rawErrorCode: 5,
        },
      }),
    );
  });
});
