import { performance } from 'node:perf_hooks';
import {
  Body,
  Controller,
  Headers,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../observability/api-error.dto';
import {
  OrderEvents,
  type JsonEventLogger,
} from '../observability/order-events';
import { CreateOrderResult } from './checkout.types';
import { CheckoutService } from './checkout.service';
import { CreateOrderDto } from './create-order.dto';

const IDEMPOTENCY_KEY_PIPE = new ParseUUIDPipe();

type HttpResponse = {
  header(name: string, value: string): HttpResponse;
  send(body: CreateOrderResult): unknown;
  status(statusCode: number): HttpResponse;
};

type HttpRequest = {
  id: string | number;
  log: JsonEventLogger;
};

@ApiTags('orders')
@Controller('orders')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly events: OrderEvents,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Reserve stock and create an asynchronous order' })
  @ApiHeader({
    name: 'Idempotency-Key',
    description:
      'Required UUID. Reusing it with the same body replays the order.',
    required: true,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiResponse({
    status: 202,
    description: 'A new PENDING order was created.',
    headers: {
      Location: {
        description: 'Canonical URL of the order.',
        schema: { example: '/api/orders/{id}', type: 'string' },
      },
    },
    type: CreateOrderResult,
  })
  @ApiResponse({
    status: 200,
    description: 'The existing idempotent order was replayed.',
    headers: {
      Location: {
        description: 'Canonical URL of the order.',
        schema: { example: '/api/orders/{id}', type: 'string' },
      },
    },
    type: CreateOrderResult,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'PRODUCT_NOT_FOUND',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'INSUFFICIENT_STOCK or IDEMPOTENCY_KEY_REUSED',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 500,
    description: 'INTERNAL_ERROR',
    type: ApiErrorDto,
  })
  async createOrder(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateOrderDto,
    @Req() request: HttpRequest,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const validatedIdempotencyKey = await IDEMPOTENCY_KEY_PIPE.transform(
      idempotencyKey ?? '',
      { type: 'custom' },
    );
    const startedAt = performance.now();
    const result = await this.checkout.createOrder({
      idempotencyKey: validatedIdempotencyKey,
      productId: body.productId,
      quantity: body.quantity,
    });
    const durationMs = performance.now() - startedAt;
    const correlationId = String(request.id);
    if (result.replayed) {
      this.events.replayed(
        request.log,
        correlationId,
        result.order.id,
        result.order.status,
        durationMs,
      );
    } else {
      this.events.created(
        request.log,
        correlationId,
        result.order.id,
        durationMs,
      );
    }

    response
      .status(result.replayed ? 200 : 202)
      .header('Location', `/api/orders/${result.order.id}`)
      .send(result);
  }
}
