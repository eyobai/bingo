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
    const language = tg.language_code === 'en' ? 'en' : 'am';
    for (let attempt = 0; ; attempt++) {
      try {
        const user = await this.ledger.withTx(async (tx) => {
          const u = await tx.user.create({
            data: { telegramId, ...names, language, role: role ?? Role.PLAYER, referralCode: newCode(), referredById: referrer?.id },
          });
          const { play } = await this.ledger.userAccounts(u.id, tx);
          const welcome = this.config.money.welcomeBonusMinor;
          if (welcome > 0n) {
            const promo = await this.ledger.systemAccount(AccountType.PROMOTIONS, tx);
            await this.ledger.post(
              {
                type: TxType.BONUS,
                description: 'Welcome bonus',
                idempotencyKey: `welcome:${u.id}`,
                lines: [
                  { accountId: promo.id, amountMinor: -welcome },
                  { accountId: play.id, amountMinor: welcome },
                ],
              },
              tx,
            );
          }
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

  setLanguage(userId: string, language: 'am' | 'en') {
    return this.prisma.user.update({ where: { id: userId }, data: { language } });
  }
}
