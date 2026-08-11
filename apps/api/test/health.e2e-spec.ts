import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTestDataSource, recreateTestSchema } from './support/database';

describe('GET /api/health', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource();
    await dataSource.initialize();
    await recreateTestSchema(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
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

  it('returns 200 when the database readiness query succeeds', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database readiness query fails', async () => {
    const query = jest
      .spyOn(dataSource, 'query')
      .mockRejectedValueOnce(new Error('database unavailable'));

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(response.statusCode).toBe(503);
    query.mockRestore();
  });
});
