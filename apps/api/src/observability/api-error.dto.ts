import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'PRODUCT_NOT_FOUND',
  'ORDER_NOT_FOUND',
  'INSUFFICIENT_STOCK',
  'IDEMPOTENCY_KEY_REUSED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'HTTP_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiErrorDto {
  @ApiProperty({ enum: API_ERROR_CODES })
  code!: ApiErrorCode;

  @ApiProperty({ example: 'Dados da solicitação inválidos.' })
  message!: string;

  @ApiProperty({ format: 'uuid' })
  correlationId!: string;

  @ApiPropertyOptional({
    additionalProperties: true,
    example: { availableStock: 1 },
    type: 'object',
  })
  details?: Record<string, unknown>;
}
