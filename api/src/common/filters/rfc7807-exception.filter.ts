import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ContractException } from '../../stellar/contract-errors';

type ProblemDetail = {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  instance: string;
  correlationId?: string;
  timestamp: string;
  errors?: Array<{ field: string; message: string }>;
  contract?: {
    address?: string;
    method?: string;
    rawErrorCode?: number;
  };
};

function validationErrors(message: unknown): Array<{ field: string; message: string }> | undefined {
  if (!Array.isArray(message)) return undefined;
  return message.map((item) => {
    if (typeof item === 'string') {
      const field = item.split(' ')[0] || 'request';
      return { field, message: item };
    }
    return { field: 'request', message: String(item) };
  });
}

function defaultCode(status: number): string {
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 401) return 'AUTHENTICATION_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  return status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`;
}

@Catch()
export class Rfc7807ExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = 500;
    let title = 'Internal Server Error';
    let detail = 'An unexpected error occurred';
    let code = 'INTERNAL_ERROR';
    let errors: ProblemDetail['errors'];
    let contract: ProblemDetail['contract'];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();

      if (typeof exResponse === 'object' && exResponse !== null) {
        const resp = exResponse as Record<string, any>;
        errors = validationErrors(resp.message);
        title = resp.error || (exception instanceof BadRequestException ? 'Bad Request' : exception.message);
        detail = resp.detail || (typeof resp.message === 'string' ? resp.message : JSON.stringify(resp.message));
        code = resp.code || defaultCode(status);
      } else {
        title = exception.message;
        detail = String(exResponse);
        code = defaultCode(status);
      }
      if (exception instanceof ContractException) {
        title = 'Contract Error';
        code = exception.code;
        detail = exception.detail;
        contract = {
          address: exception.contractAddress,
          method: exception.method,
          rawErrorCode: exception.rawErrorCode,
        };
      }
    }

    const problem: ProblemDetail = {
      type: `https://errors.verdant-bond-protocol.org/${code}`,
      title,
      status,
      detail,
      code,
      instance: request.url,
      correlationId: (request as any).correlationId || (request as any).requestId,
      timestamp: new Date().toISOString(),
    };
    if (errors) problem.errors = errors;
    if (contract) problem.contract = contract;

    if (problem.correlationId) {
      response.setHeader('x-correlation-id', problem.correlationId);
    }
    response.status(status).json(problem);
  }
}
