import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class Rfc7807ExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = 500;
    let title = 'Internal Server Error';
    let detail = 'An unexpected error occurred';
    let code: string | undefined = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();

      if (typeof exResponse === 'object' && exResponse !== null) {
        const resp = exResponse as Record<string, any>;
        title = resp.message || exception.message;
        detail = resp.detail || (typeof resp.message === 'string' ? resp.message : JSON.stringify(resp.message));
        code = resp.code;
      } else {
        detail = String(exResponse);
      }
    }

    response.status(status).json({
      type: `https://errors.verdant-bond-protocol.org/${code || status}`,
      title,
      status,
      detail,
      code,
      instance: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
