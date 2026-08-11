import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ERP_PROCESSOR_PORT } from '../src/erp/erp-processor.port';
import {
  createTestDataSource,
  recreateTestSchema,
  seedTestDatabase,
} from './support/database';

describe('GET /api/products', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;
  const erpProcessor = { process: jest.fn() };

  beforeAll(async () => {
    dataSource = createTestDataSource();
    await dataSource.initialize();
    await recreateTestSchema(dataSource);
    await seedTestDatabase(dataSource);
    await dataSource.query(
      'UPDATE products SET stock_reserved = $1 WHERE sku = $2',
      [2, 'CASE-IP15-BLK'],
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [{ provide: ERP_PROCESSOR_PORT, useValue: erpProcessor }],
    })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(ERP_PROCESSOR_PORT)
      .useValue(erpProcessor)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('returns the seeded storefront projection with SQL-computed availability without calling ERP', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/products' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          sku: 'CASE-IP15-BLK',
          name: 'Capinha Impact iPhone 15',
          description: 'Proteção reforçada na cor preta',
          priceCents: 7990,
          availableStock: 6,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          sku: 'CASE-S24-CLR',
          name: 'Capinha Crystal Galaxy S24',
          description: 'Proteção transparente de perfil fino',
          priceCents: 5990,
          availableStock: 3,
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          sku: 'CASE-P9-GRN',
          name: 'Capinha Soft Pixel 9',
          description: 'Silicone macio na cor verde',
          priceCents: 6990,
          availableStock: 0,
        },
      ],
    });
    expect(
      response
        .json<{ items: { priceCents: number; availableStock: number }[] }>()
        .items.every(
          ({ priceCents, availableStock }) =>
            Number.isInteger(priceCents) && Number.isInteger(availableStock),
        ),
    ).toBe(true);
    expect(erpProcessor.process).not.toHaveBeenCalled();
  });
});
