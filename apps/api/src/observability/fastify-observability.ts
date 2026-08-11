import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import type { JsonEventLogger } from './order-events';

type LoggedRequest = {
  method?: string;
  url?: string;
};

type LoggedResponse = {
  statusCode?: number;
};

type RequestWithLogger = {
  id: string | number;
  log: JsonEventLogger;
  method: string;
  routeOptions?: { url?: string };
};

type ResponseWithTiming = {
  elapsedTime: number;
  statusCode: number;
};

type FastifyInstance = {
  addHook(
    name: 'onResponse',
    hook: (
      request: RequestWithLogger,
      response: ResponseWithTiming,
      done: () => void,
    ) => void,
  ): void;
};

export function createApiFastifyAdapter(stream?: Writable): FastifyAdapter {
  const logger = {
    level: process.env.LOG_LEVEL ?? 'info',
    serializers: {
      req: (request: LoggedRequest) => ({
        method: request.method,
        path: request.url?.split('?')[0],
      }),
      res: (response: LoggedResponse) => ({
        statusCode: response.statusCode,
      }),
    },
    ...(stream ? { stream } : {}),
  };

  return new FastifyAdapter({
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    logger,
  });
}

export function registerRequestCompletionLogging(
  app: NestFastifyApplication,
): void {
  const server = app.getHttpAdapter().getInstance() as FastifyInstance;
  server.addHook('onResponse', (request, response, done) => {
    request.log.info(
      {
        event: 'http.request.completed',
        correlationId: String(request.id),
        method: request.method,
        path: request.routeOptions?.url ?? '<unmatched>',
        statusCode: response.statusCode,
        durationMs: response.elapsedTime,
      },
      'http.request.completed',
    );
    done();
  });
}
