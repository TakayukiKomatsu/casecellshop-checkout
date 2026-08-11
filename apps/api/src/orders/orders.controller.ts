import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OrderSnapshot } from '../checkout/checkout.types';
import { ApiErrorDto } from '../observability/api-error.dto';
import { OrdersService } from './orders.service';

const ORDER_ID_PIPE = new ParseUUIDPipe();

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  @ApiParam({ format: 'uuid', name: 'id' })
  @ApiOkResponse({ type: OrderSnapshot })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: 'ORDER_NOT_FOUND',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 500,
    description: 'INTERNAL_ERROR',
    type: ApiErrorDto,
  })
  findById(
    @Param('id', ORDER_ID_PIPE) orderId: string,
  ): Promise<OrderSnapshot> {
    return this.orders.findById(orderId);
  }
}
