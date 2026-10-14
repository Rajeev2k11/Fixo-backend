import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ErrorCode, type ErrorBody } from '@fixo/contracts';
import type { Request, Response } from 'express';

import { AppError } from './app-error.js';

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
};

interface Normalised {
  status: number;
  code: ErrorCode;
  message: string;
  details: unknown;
}

/** The single place where any thrown value becomes `{ error: { code, message, details, requestId } }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const { status, code, message, details } = normalise(exception);

    // 5xx are our bugs: log the real error. The client only ever gets a generic message.
    if (status >= 500) this.logger.error(exception);

    // genReqId (logger.ts) always produces a string UUID.
    const requestId = typeof req.id === 'string' ? req.id : '';
    const body: ErrorBody = { error: { code, message, details, requestId } };
    const res = http.getResponse<Response>();
    // 429s carry the standard Retry-After header as well as the value in details.
    const retryAfter = (details as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
    if (status === 429 && typeof retryAfter === 'number') res.setHeader('Retry-After', retryAfter);
    res.status(status).json(body);
  }
}

function normalise(exception: unknown): Normalised {
  if (exception instanceof AppError) {
    const { status, code, message, details } = exception;
    return { status, code, message, details };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      code:
        CODE_BY_STATUS[status] ?? (status < 500 ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL_ERROR),
      message: status < 500 ? exception.message : 'Internal server error',
      details: null,
    };
  }
  return {
    status: 500,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Internal server error',
    details: null,
  };
}
