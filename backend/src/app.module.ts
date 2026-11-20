import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AdminController } from './admin.controller';
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const { error, value } = envSchema.validate(env, { allowUnknown: true, abortEarly: false });
  if (error) throw new Error(`Invalid settings: ${error.message}`);
  return buildConfig(value);
}

const config = loadConfig();

@Module({
  imports: [PrismaModule, NotifyModule, JwtModule.register({ secret: config.jwtSecret })],
  controllers: [HealthController, AuthController, MeController, GameController, PaymentsController, AdminController],
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
  ],
})
export class AppModule {}
