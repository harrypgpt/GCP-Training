import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  const config = app.get(AppConfigService);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : false,
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableShutdownHooks();

  await app.listen(config.port);
  logger.log(`API listening on http://localhost:${config.port}/api (${config.nodeEnv})`);
}

void bootstrap();
