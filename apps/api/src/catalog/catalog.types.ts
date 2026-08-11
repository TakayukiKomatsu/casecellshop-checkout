import { ApiProperty } from '@nestjs/swagger';

export class CatalogProduct {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CASE-IP15-BLK' })
  sku!: string;

  @ApiProperty({ example: 'Capinha Impact iPhone 15' })
  name!: string;

  @ApiProperty({ example: 'Proteção reforçada' })
  description!: string;

  @ApiProperty({ example: 7990, minimum: 0 })
  priceCents!: number;

  @ApiProperty({ example: 5, minimum: 0 })
  availableStock!: number;
}

export class CatalogResponse {
  @ApiProperty({ type: [CatalogProduct] })
  items!: CatalogProduct[];
}
