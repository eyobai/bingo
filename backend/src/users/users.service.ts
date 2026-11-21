import { Inject, Injectable } from '@nestjs/common';
import { Role, TxType, AccountType } from '@prisma/client';
import type { User } from '@prisma/client';
import { randomInt } from 'node:crypto';
import type { TelegramUser } from '../auth/telegram-init-data';
import { isUniqueViolation } from '../common/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma.service';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** "ref_ABCD2345", "ABCD2345" -> "ABCD2345" */
export function referralCodeFrom(startParam?: string | null): string | undefined {
  if (!startParam) return undefined;
  const code = startParam.replace(/^ref_?/i, '').toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(code) ? code : undefined;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Finds or creates the player for a Telegram account. Names are refreshed on every sign-in. A new player who
   * came through someone's invite link is linked to that person (the reward is paid on their first deposit).
   */
  async fromTelegram(tg: TelegramUser, startParam?: string): Promise<{ user: User; created: boolean }> {
    const telegramId = BigInt(tg.id);
    const role = this.config.adminTelegramIds.has(String(tg.id)) ? Role.ADMIN : undefined;
    const names = {
      firstName: (tg.first_name || 'Player').slice(0, 128),
      lastName: tg.last_name?.slice(0, 128) ?? null,
      username: tg.username?.slice(0, 64) ?? null,
    };
    const existing = await this.prisma.user.findUnique({ where: { telegramId } });
    if (existing) {
      const user = await this.prisma.user.update({ where: { id: existing.id }, data: { ...names, ...(role ? { role } : {}) } });
      return { user, created: false };
    }

    const code = referralCodeFrom(startParam);
    const referrer = code ? await this.prisma.user.findUnique({ where: { referralCode: code } }) : null;
    // Everyone starts in Amharic (most phones are set to English, so the phone's language is not used).
    // Players can switch to Afaan Oromoo or English in the bot or the game.
    const language = 'am';
    for (let attempt = 0; ; attempt++) {
      try {
        const user = await this.ledger.withTx(async (tx) => {
          const u = await tx.user.create({
            data: { telegramId, ...names, language, role: role ?? Role.PLAYER, referralCode: newCode(), referredById: referrer?.id },
          });
          await this.ledger.userAccounts(u.id, tx);
          return u;
        });
        return { user, created: true };
      } catch (e) {
        if (!isUniqueViolation(e) || attempt > 3) throw e;
        // Either the referral code collided (retry with a new one) or the same person signed in twice at once.
        const raced = await this.prisma.user.findUnique({ where: { telegramId } });
        if (raced) return { user: raced, created: false };
      }
    }
  }

  /**
   * Saves the phone number the player shared from Telegram and, the first time, gives the welcome gift
   * (WELCOME_BONUS_BIRR, play wallet). Returns the gift amount (0 when none was due).
   */
  async registerPhone(userId: string, phoneE164: string): Promise<bigint> {
    return this.ledger.withTx(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await tx.user.update({ where: { id: userId }, data: { phone: phoneE164 } });
      const gift = this.config.money.welcomeBonusMinor;
      if (before.phone || gift <= 0n) return 0n;
      const { play } = await this.ledger.userAccounts(userId, tx);
      const promo = await this.ledger.systemAccount(AccountType.PROMOTIONS, tx);
      const posted = await this.ledger.post(
        {
          type: TxType.BONUS,
          description: 'Welcome gift for registering',
          idempotencyKey: `welcome:${userId}`,
          lines: [
            { accountId: promo.id, amountMinor: -gift },
            { accountId: play.id, amountMinor: gift },
          ],
        },
        tx,
      );
      // An existing idempotency key means the gift was already given (e.g. the number was changed later).
      return posted.createdAt.getTime() > Date.now() - 60_000 ? gift : 0n;
    });
  }

  /** Invite numbers for /invite: rewarded friends, friends still to deposit, and bonus earned so far. */
  async referralStats(userId: string) {
    const [deposited, invited, earned] = await Promise.all([
      this.prisma.user.count({ where: { referredById: userId, deposits: { some: { status: 'APPROVED' } } } }),
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.ledgerEntry.aggregate({
        where: { account: { userId, type: AccountType.USER_PLAY }, transaction: { idempotencyKey: { startsWith: 'referral:' } } },
        _sum: { amountMinor: true },
      }),
    ]);
    return { deposited, waiting: invited - deposited, earnedMinor: earned._sum.amountMinor ?? 0n };
  }

  setLanguage(userId: string, language: 'am' | 'en' | 'om') {
    return this.prisma.user.update({ where: { id: userId }, data: { language } });
  }
}
