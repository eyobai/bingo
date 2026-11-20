import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule, loadConfig } from './app.module';

/** Shared by main() and the integration tests. */
export function setupApp(app: INestApplication) {
  const config = loadConfig();
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins.length ? config.corsOrigins : true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return config;
}

async function main() {
  const app = await NestFactory.create(AppModule);
  const config = setupApp(app);
  await app.listen(config.port);
}

if (require.main === module) void main();
