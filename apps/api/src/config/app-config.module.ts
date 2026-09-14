import { config as loadDotenv } from 'dotenv';

import { Global, Module } from '@nestjs/common';

import { AppConfigService } from './app-config.service';
import { parseEnv } from './env.schema';

// Load `.env` (relative to CWD) into `process.env` for every entry point that
// pulls in this module — `main.ts`, e2e tests, and any future CLI/worker
// process. Never overrides variables the shell/CI already set. Must run
// before `parseEnv` reads `process.env` below.
loadDotenv();

/**
 * Global configuration module.
 *
 * Environment parsing happens exactly once, here, at module construction time.
 * If validation fails the error propagates out of `NestFactory.create` and the
 * process exits before it ever binds a port.
 */
@Global()
@Module({
  providers: [
    {
      provide: AppConfigService,
      useFactory: (): AppConfigService => new AppConfigService(parseEnv(process.env)),
    },
  ],
  exports: [AppConfigService],
})
export class AppConfigModule {}
