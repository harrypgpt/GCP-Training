import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Request, type Response } from 'express';

import { type ProblemDetails } from '@gcp/shared';

import { AppException } from '../exceptions/app-exception';

/** Lowest HTTP status code considered a server-side error. */
const SERVER_ERROR_MIN_STATUS = 500;

/**
 * Converts every unhandled error into an RFC 7807 `application/problem+json`
 * response. Internal error details are logged but never leaked to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const status: number =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const title = exception instanceof HttpException ? exception.message : 'Internal Server Error';

    const detail = this.extractDetail(exception, status);

    if (status >= SERVER_ERROR_MIN_STATUS) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status}: ${title}`);
    }

    const body: ProblemDetails = {
      type: 'about:blank',
      title,
      status,
      ...(detail ? { detail } : {}),
      instance: request.url,
      ...(request.id ? { requestId: request.id } : {}),
      ...(exception instanceof AppException ? { code: exception.code } : {}),
    };

    response.status(status).type('application/problem+json').json(body);
  }

  private extractDetail(exception: unknown, status: number): string | undefined {
    if (status >= SERVER_ERROR_MIN_STATUS) {
      return undefined;
    }
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return payload;
      }
      if (payload && typeof payload === 'object' && 'message' in payload) {
        const message = (payload as { message: unknown }).message;
        return Array.isArray(message) ? message.join('; ') : String(message);
      }
    }
    return undefined;
  }
}
