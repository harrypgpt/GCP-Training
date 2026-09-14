import { HttpException, type HttpStatus } from '@nestjs/common';

/**
 * Base exception for any error the API wants to expose with a stable,
 * machine-readable `code` (see `ProblemDetails.code` in `@gcp/shared`), on
 * top of the standard HTTP status and human-readable message. Client code
 * should branch on `code`, never on the message text.
 */
export class AppException extends HttpException {
  readonly code: string;

  constructor(status: HttpStatus, code: string, message: string) {
    super(message, status);
    this.code = code;
  }
}
