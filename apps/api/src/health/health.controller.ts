import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { ApiErrorDto } from '../observability/api-error.dto';

class HealthResponseDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiResponse({
    status: 503,
    description: 'SERVICE_UNAVAILABLE',
    type: ApiErrorDto,
  })
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException();
    }

    return { status: 'ok' };
  }
}
