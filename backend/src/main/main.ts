import 'reflect-metadata';
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import fastifyHelmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  // Security headers & cookie support
  await app.register(fastifyHelmet as any, { contentSecurityPolicy: false });
  await app.register(fastifyCookie as any);

  // Global rate limiting (configurable via env) - register FIRST
  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? 1000); // Higher for dev
  const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000);
  await app.register(fastifyRateLimit as any, {
    max: rateLimitMax,
    timeWindow: rateLimitWindowMs,
    keyGenerator: (req: any) => {
      // Use X-Forwarded-For if behind reverse proxy, else IP
      return req.headers['x-forwarded-for'] || req.ip;
    },
    allowList: [],
    skipOnError: true,
    errorMessage: 'Too Many Requests',
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  });

  // Stricter rate limiting for auth endpoints (login, register-first-admin) - register SECOND
  const authRateLimitMax = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 100); // Higher for dev
  const authRateLimitWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 900000); // 15 minutes
  await app.register(fastifyRateLimit as any, {
    max: authRateLimitMax,
    timeWindow: authRateLimitWindowMs,
    keyGenerator: (req: any) => {
      return `auth:${req.headers['x-forwarded-for'] || req.ip}`;
    },
    scope: 'auth',
    allowList: [],
    skipOnError: true,
    errorMessage: 'Too Many Requests - authentication limit exceeded',
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  });

  // Apply auth scope to auth routes via hook
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook('onRequest', async (request: any, reply: any) => {
    const url = request.raw.url || '';
    if (url.includes('/tenants/') && url.includes('/auth/')) {
      request.headers['x-rate-limit-scope'] = 'auth';
    }
  });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS
  const corsOriginEnv = process.env.CORS_ORIGIN;
  const isProd = process.env.NODE_ENV === 'production';
  const corsOrigin = corsOriginEnv
    ? corsOriginEnv.includes(',')
      ? corsOriginEnv.split(',').map((o) => o.trim())
      : corsOriginEnv
    : isProd
      ? false
      : ['http://localhost:5180', 'http://localhost:5173'];

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
  console.log(`FeeCore API running on http://${host}:${port}`);
}

bootstrap();
