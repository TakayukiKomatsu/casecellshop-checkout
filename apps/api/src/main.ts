import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import {
  createApiFastifyAdapter,
  registerRequestCompletionLogging,
} from './observability/fastify-observability';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createApiFastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix('api');
  app.enableCors();
  registerRequestCompletionLogging(app);
  if (process.env.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('CaseCellShop Checkout API')
        .setDescription('Local catalog and asynchronous order checkout API.')
        .setVersion('1.0')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs-json',
      useGlobalPrefix: true,
    });
  }
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}

void bootstrap();
