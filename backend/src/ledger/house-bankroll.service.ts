import { HttpStatus, Injectable } from '@nestjs/common';
import { AccountType, Role, TxType } from '@prisma/client';
import { AuditService } from '../audit.service';
import { AppError, money } from '../common/common';
import { PrismaService } from '../prisma.service';
import { LedgerService } from './ledger.service';

/**
 * The house bankroll: operator cash set aside to pay automated players' card stakes. Separate from player money
 * and from house revenue. Staff record real bank transfers into and out of it; recording does not move money.
 * Each bank reference can be used once, so a transfer is never counted twice.
 */
@Injectable()
export class HouseBankrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async view() {
    const [balance, recent] = await Promise.all([
      this.ledger.systemBalance(AccountType.HOUSE_BANKROLL),
      this.prisma.ledgerTransaction.findMany({
        where: { type: { in: [TxType.HOUSE_FUNDING, TxType.HOUSE_WITHDRAWAL] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, type: true, description: true, createdAt: true, metadata: true },
      }),
    ]);
    return { balance: money(balance), recent };
  }

  /** Operator cash paid into the bankroll (verified bank transfer). */
  fund(staffId: string, amountMinor: bigint, bankReference: string) {
    return this.move('in', staffId, amountMinor, bankReference);
  }

  /** Operator cash taken out of the bankroll. Cannot take more than it holds. */
  withdraw(staffId: string, amountMinor: bigint, bankReference: string) {
    return this.move('out', staffId, amountMinor, bankReference);
  }

  private async move(direction: 'in' | 'out', staffId: string, amountMinor: bigint, bankReference: string) {
    if (amountMinor <= 0n) throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_AMOUNT', 'The amount must be positive.');
    const reference = bankReference.trim().toUpperCase();
    const idempotencyKey = `house-bankroll:${reference}`;
    const type = direction === 'in' ? TxType.HOUSE_FUNDING : TxType.HOUSE_WITHDRAWAL;
    await this.ledger.withTx(async (tx) => {
      const staff = await tx.user.findUnique({ where: { id: staffId }, select: { role: true, isBlocked: true } });
      if (!staff || staff.role !== Role.ADMIN || staff.isBlocked) throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Active staff only.');
      const house = await this.ledger.systemAccount(AccountType.HOUSE_BANKROLL, tx);
      const capital = await this.ledger.systemAccount(AccountType.HOUSE_CAPITAL, tx);
      const balance = (await this.ledger.lockAccounts(tx, [house.id, capital.id])).get(house.id)!.balance_minor;
      // Check after locking so concurrent replays cannot record the same transfer twice.
      const transfers = await tx.ledgerTransaction.findMany({
        where: { idempotencyKey: { in: [idempotencyKey, `house-funding:${reference}`, `house-withdrawal:${reference}`] } },
        select: { type: true, metadata: true },
      });
      for (const earlier of transfers) {
        const meta = earlier.metadata;
        if (earlier.type !== type || !meta || typeof meta !== 'object' || Array.isArray(meta) || meta.amountMinor !== amountMinor.toString()) {
          throw new AppError(HttpStatus.CONFLICT, 'REFERENCE_USED', 'This bank reference was already recorded with a different amount or direction.');
        }
      }
      if (transfers.length) return;
      if (direction === 'out' && balance < amountMinor) {
        throw new AppError(HttpStatus.CONFLICT, 'BANKROLL_TOO_LOW', `The bankroll holds only ${money(balance).birr} birr.`);
      }
      const signed = direction === 'in' ? amountMinor : -amountMinor;
      const record = await this.ledger.post(
        {
          type,
          description: `${direction === 'in' ? 'Operator cash into' : 'Operator cash out of'} the house bankroll: ${reference}`,
          idempotencyKey,
          metadata: { staffId, bankReference: reference, amountMinor: amountMinor.toString() },
          lines: [
            { accountId: capital.id, amountMinor: -signed },
            { accountId: house.id, amountMinor: signed },
          ],
        },
        tx,
      );
      await this.audit.record(
        {
          staffId,
          action: direction === 'in' ? 'BANKROLL_FUND' : 'BANKROLL_WITHDRAW',
          targetType: 'bankroll',
          targetId: 'HOUSE_BANKROLL',
          after: { amountMinor, bankReference: reference, ledgerTransactionId: record.id },
        },
        tx,
      );
    });
    return this.view();
  }
}
