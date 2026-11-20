import { Global, Injectable, Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Deposit, Withdrawal } from '@prisma/client';

export interface NotifyEvents {
  depositSubmitted: [Deposit];
  depositReviewed: [Deposit];
  withdrawalRequested: [Withdrawal];
  withdrawalReviewed: [Withdrawal];
  /** A player's balances changed (purchase, prize, deposit...). The game socket pushes fresh balances. */
  walletChanged: [string];
}

/**
 * In-process event bus. Payments and the game publish here; the Telegram bot and the socket gateway listen.
 * Keeps those modules from depending on each other.
 */
@Injectable()
export class NotifyService extends EventEmitter<NotifyEvents> {}

@Global()
@Module({ providers: [NotifyService], exports: [NotifyService] })
export class NotifyModule {}
