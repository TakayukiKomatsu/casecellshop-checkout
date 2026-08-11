import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../observability/api-error.dto';
import { CatalogService } from './catalog.service';
import { CatalogResponse } from './catalog.types';

@ApiTags('products')
@Controller('products')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @ApiOkResponse({ type: CatalogResponse })
  @ApiResponse({
    status: 500,
    description: 'INTERNAL_ERROR',
    type: ApiErrorDto,
  })
  list(): Promise<CatalogResponse> {
    return this.catalogService.list();
  }
}
