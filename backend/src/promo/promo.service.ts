import { HttpStatus, Injectable } from '@nestjs/common';
import { DepositStatus } from '@prisma/client';
import type { PromoCode } from '@prisma/client';
import { AppError, isUniqueViolation, money } from '../common/common';
import { NotifyService } from '../notify.service';
import { PrismaService, TX_OPTIONS } from '../prisma.service';
import { WalletService } from '../wallet/wallet.service';

/** Codes are letters and digits, 3-32 long; what players type is compared upper-case without spaces. */
export const normalizeCode = (raw: string) => raw.replace(/\s+/g, '').toUpperCase();
export const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

export function promoView(p: PromoCode) {
  return {
    id: p.id,
    code: p.code,
    amount: money(p.amountMinor),
    maxUses: p.maxUses,
    usedCount: p.usedCount,
    expiresAt: p.expiresAt,
    requiresDeposit: p.requiresDeposit,
    isActive: p.isActive,
    note: p.note,
    createdAt: p.createdAt,
    state: !p.isActive ? 'OFF' : p.expiresAt && p.expiresAt < new Date() ? 'EXPIRED' : p.maxUses !== null && p.usedCount >= p.maxUses ? 'USED_UP' : 'ACTIVE',
  };
}

/**
 * Promo codes give a bonus to the play wallet, paid from the promotions budget. Each player can use a code
 * once; the code row is locked while redeeming, so the use limit holds even when many players redeem at once.
 */
@Injectable()
export class PromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly notify: NotifyService,
  ) {}

  async redeem(userId: string, rawCode: string): Promise<{ code: string; amountMinor: bigint }> {
    const code = normalizeCode(rawCode);
    const notFound = new AppError(HttpStatus.NOT_FOUND, 'PROMO_NOT_FOUND', 'That promo code does not exist. Check the spelling.');
    if (!CODE_PATTERN.test(code)) throw notFound;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM promo_codes WHERE code = ${code} FOR UPDATE`;
        if (!rows.length) throw notFound;
        const promo = await tx.promoCode.findUniqueOrThrow({ where: { id: rows[0].id } });
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (user.isBlocked) throw new AppError(HttpStatus.FORBIDDEN, 'BLOCKED', 'Your account is blocked. Contact support.');
        if (!user.phone) {
          throw new AppError(HttpStatus.FORBIDDEN, 'PHONE_REQUIRED', 'Register first: open the bot, press Start and share your phone number.');
        }
        if (!promo.isActive) throw new AppError(HttpStatus.GONE, 'PROMO_OFF', 'This promo code is no longer active.');
        if (promo.expiresAt && promo.expiresAt < new Date()) throw new AppError(HttpStatus.GONE, 'PROMO_EXPIRED', 'This promo code has expired.');
        if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
          throw new AppError(HttpStatus.GONE, 'PROMO_USED_UP', 'This promo code has been used by the maximum number of players.');
        }
        const already = await tx.promoRedemption.findUnique({ where: { promoId_userId: { promoId: promo.id, userId } } });
        if (already) throw new AppError(HttpStatus.CONFLICT, 'PROMO_ALREADY_USED', 'You have already used this promo code.');
        if (promo.requiresDeposit) {
          const deposits = await tx.deposit.count({ where: { userId, status: DepositStatus.APPROVED } });
          if (!deposits) {
            throw new AppError(HttpStatus.FORBIDDEN, 'PROMO_NEEDS_DEPOSIT', 'This promo code is for players who have made a deposit. Deposit first, then try again.');
          }
        }
        await tx.promoRedemption.create({ data: { promoId: promo.id, userId, amountMinor: promo.amountMinor } });
        await tx.promoCode.update({ where: { id: promo.id }, data: { usedCount: { increment: 1 } } });
        await this.wallet.grantBonus(userId, promo.amountMinor, `Promo code ${promo.code}`, `promo:${promo.id}:${userId}`, tx);
        return { code: promo.code, amountMinor: promo.amountMinor };
      }, TX_OPTIONS);
      this.notify.emit('walletChanged', userId);
      return result;
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError(HttpStatus.CONFLICT, 'PROMO_ALREADY_USED', 'You have already used this promo code.');
      throw e;
    }
  }
}
