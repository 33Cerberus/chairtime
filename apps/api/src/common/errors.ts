import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ValidationError,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/** 409: the request is valid but conflicts with the current state. */
export const conflict = (message: string, code?: string, details?: unknown) =>
  new ConflictException({ message, code, details });

export const badRequest = (message: string, details?: unknown) =>
  new BadRequestException({ message, details });

/** Also used when an `own` permission fails, so the API never reveals that a record exists. */
export const notFound = (what = 'Record') => new NotFoundException(`${what} not found`);

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

export function validationExceptionFactory(errors: ValidationError[]) {
  const details: { field: string; errors: string[] }[] = [];
  const walk = (list: ValidationError[], prefix: string) => {
    for (const e of list) {
      const field = prefix ? `${prefix}.${e.property}` : e.property;
      if (e.constraints) details.push({ field, errors: Object.values(e.constraints) });
      if (e.children?.length) walk(e.children, field);
    }
  };
  walk(errors, '');
  const first = details[0]?.errors[0];
  return new BadRequestException({ message: first ?? 'Validation failed', details });
}

export function isConstraintViolation(e: unknown, constraint: string) {
  return e instanceof Error && e.message.includes(constraint);
}

/** Renders every error as `{ statusCode, message, error, details }` (docs/api.md). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong';
    let code: string | undefined;
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const b = body as Record<string, unknown>;
        message = Array.isArray(b.message) ? b.message.join('; ') : String(b.message ?? exception.message);
        code = b.code as string | undefined;
        details = b.details;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = HttpStatus.CONFLICT;
      message = 'A record with this value already exists';
      details = exception.meta?.target;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      status = HttpStatus.NOT_FOUND;
      message = 'Record not found';
    } else if (isConstraintViolation(exception, 'Booking_no_overlap')) {
      status = HttpStatus.CONFLICT;
      message = 'This time has just been taken. Please pick another slot.';
      code = 'SLOT_TAKEN';
    } else if (isConstraintViolation(exception, 'Product_stock_nonnegative')) {
      status = HttpStatus.CONFLICT;
      message = 'Not enough stock';
      code = 'OUT_OF_STOCK';
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({
      statusCode: status,
      message,
      error: STATUS_TEXT[status] ?? 'Error',
      ...(code ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
    });
  }
}
