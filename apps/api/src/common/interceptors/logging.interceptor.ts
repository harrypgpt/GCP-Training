import { randomUUID } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { type Observable, tap } from 'rxjs';

/**
 * Assigns a request id (honouring an inbound `x-request-id`), echoes it on the
 * response, and logs one structured line per completed request.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();

    const inbound = request.headers['x-request-id'];
    const requestId = (Array.isArray(inbound) ? inbound[0] : inbound) ?? randomUUID();
    request.id = requestId;
    response.setHeader('x-request-id', requestId);

    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, response, startedAt),
        error: () => this.log(request, response, startedAt),
      }),
    );
  }

  private log(request: Request & { id?: string }, response: Response, startedAt: bigint): void {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.logger.log(
      `${request.method} ${request.originalUrl} ${response.statusCode} ${durationMs.toFixed(1)}ms rid=${request.id ?? '-'}`,
    );
  }
}
