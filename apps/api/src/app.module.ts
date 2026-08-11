import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogRepository } from './catalog/catalog.repository';
import { CatalogService } from './catalog/catalog.service';
import { CheckoutController } from './checkout/checkout.controller';
import {
  CHECKOUT_PRE_COMMIT_HOOK,
  CheckoutService,
} from './checkout/checkout.service';
import { ROOT_ENV_FILE, validateEnv, type AppEnv } from './config/env.schema';
import { createTypeOrmOptions } from './database/typeorm.config';
import { ERP_PROCESSOR_PORT } from './erp/erp-processor.port';
import { ErpSimulatorAdapter } from './erp/erp-simulator.adapter';
import { HealthController } from './health/health.controller';
import { InventoryService } from './inventory/inventory.service';
import { HttpErrorFilter } from './observability/http-error.filter';
import { OrderEvents } from './observability/order-events';
import { OrdersRepository } from './orders/orders.repository';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { OrderProcessingWorker } from './worker/order-processing.worker';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ROOT_ENV_FILE,
      isGlobal: true,
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) =>
        createTypeOrmOptions(config.getOrThrow<string>('DATABASE_URL')),
    }),
  ],
  controllers: [
    CatalogController,
    CheckoutController,
    HealthController,
    OrdersController,
  ],
  providers: [
    CatalogRepository,
    CatalogService,
    CheckoutService,
    InventoryService,
    OrdersRepository,
    OrderEvents,
    OrdersService,
    ErpSimulatorAdapter,
    OrderProcessingWorker,
    {
      provide: ERP_PROCESSOR_PORT,
      useExisting: ErpSimulatorAdapter,
    },
    {
      provide: CHECKOUT_PRE_COMMIT_HOOK,
      useValue: () => undefined,
    },
    {
      provide: APP_FILTER,
      useClass: HttpErrorFilter,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    },
  ],
})
export class AppModule {}
