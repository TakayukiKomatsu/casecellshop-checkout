import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { CheckoutError } from '../checkout/checkout.errors';
import type { ApiErrorCode } from './api-error.dto';

type ErrorEnvelope = {
  code: ApiErrorCode;
  message: string;
  correlationId: string;
  details?: Record<string, unknown>;
};

type HttpRequest = { id?: unknown };
type HttpResponse = {
  status(statusCode: number): HttpResponse;
  send(body: ErrorEnvelope): unknown;
};

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const correlationId =
      typeof request.id === 'string' && isUUID(request.id)
        ? request.id
        : randomUUID();
    request.id = correlationId;

    if (exception instanceof CheckoutError) {
      response.status(exception.statusCode).send({
        code: exception.code,
        message: exception.message,
        correlationId,
        ...(exception.details ? { details: exception.details } : {}),
      });
      return;
    }

    if (
      exception instanceof BadRequestException ||
      (exception instanceof HttpException && exception.getStatus() === 400)
    ) {
      response.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Dados da solicitação inválidos.',
        correlationId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      response.status(statusCode).send({
        code: statusCode === 503 ? 'SERVICE_UNAVAILABLE' : 'HTTP_ERROR',
        message: exception.message,
        correlationId,
      });
      return;
    }

    response.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor.',
      correlationId,
    });
  }
}
