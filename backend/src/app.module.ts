import { Logger, Module } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AdminController, StaffAuthController } from './admin.controller';
import { StaffAuthService } from './auth/staff-auth.service';
import { AuthController, GameController, MeController, PaymentsController } from './api.controllers';
import { GameGateway } from './bingo/game.gateway';
import { GameService } from './bingo/game.service';
import { BotService } from './bot/bot.service';
import { AuthGuard, ErrorFilter } from './common/common';
import { APP_CONFIG, type AppConfig, buildConfig, envSchema } from './config/config';
import { HealthController } from './health.controller';
import { LedgerService } from './ledger/ledger.service';
import { NotifyModule } from './notify.service';
import { PaymentsService } from './payments/payments.service';
import { PrismaModule } from './prisma.service';
import { UsersService } from './users/users.service';
import { WalletService } from './wallet/wallet.service';

/** A setting written twice in .env silently uses the last one; say so, since it has bitten us before. */
function warnDuplicateSettings(file = join(process.cwd(), '.env')) {
  if (!existsSync(file)) return;
  const seen = new Map<string, number>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (m) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  const twice = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  if (twice.length) {
    new Logger('Settings').warn(`.env sets ${twice.join(', ')} more than once; only the LAST line of each counts. Delete the extra lines.`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const { error, value } = envSchema.validate(env, { allowUnknown: true, abortEarly: false });
  if (error) throw new Error(`Invalid settings: ${error.message}`);
  return buildConfig(value);
}

warnDuplicateSettings();
const config = loadConfig();

@Module({
  imports: [PrismaModule, NotifyModule, JwtModule.register({ secret: config.jwtSecret })],
  controllers: [HealthController, AuthController, MeController, GameController, PaymentsController, AdminController, StaffAuthController],
  providers: [
    { provide: APP_CONFIG, useValue: config },
    AuthGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
    LedgerService,
    WalletService,
    UsersService,
    PaymentsService,
    GameService,
    GameGateway,
    BotService,
    StaffAuthService,
  ],
})
export class AppModule {}
