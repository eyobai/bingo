import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AccountType, Role, TxType, type LedgerTransaction } from '@prisma/client';
import { AppError, isUniqueViolation, money } from '../common/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma.service';
import { LedgerService } from './ledger.service';

@Injectable()
export class HouseBankrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async view() {
    const [balance, recent] = await Promise.all([
      this.ledger.systemBalance(AccountType.HOUSE_BANKROLL),
      this.prisma.ledgerTransaction.findMany({
        where: { type: TxType.HOUSE_FUNDING },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, description: true, createdAt: true, metadata: true },
      }),
    ]);
    return { enabled: this.config.houseCashRoomEnabled, balance: money(balance), recent };
  }

  async recordFunding(staffId: string, amountMinor: bigint, bankReference: string) {
    if (!this.config.houseCashRoomEnabled) throw new AppError(HttpStatus.CONFLICT, 'HOUSE_ROOM_DISABLED', 'The house cash room is disabled.');
    if (amountMinor <= 0n) throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_AMOUNT', 'Funding must be positive.');
    const reference = bankReference.toUpperCase();
    const idempotencyKey = `house-funding:${reference}`;
    const verifyAmount = (record: LedgerTransaction) => {
      const meta = record.metadata;
      if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.amountMinor !== amountMinor.toString()) {
        throw new AppError(HttpStatus.CONFLICT, 'FUNDING_REFERENCE_USED', 'This bank reference was already recorded with another amount.');
      }
    };
    try {
      await this.ledger.withTx(async (tx) => {
        const staff = await tx.user.findUnique({ where: { id: staffId }, select: { role: true, isBlocked: true } });
        if (!staff || staff.role !== Role.ADMIN || staff.isBlocked) throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Active staff only.');
        const house = await this.ledger.systemAccount(AccountType.HOUSE_BANKROLL, tx);
        const capital = await this.ledger.systemAccount(AccountType.HOUSE_CAPITAL, tx);
        const record = await this.ledger.post(
          {
            type: TxType.HOUSE_FUNDING,
            description: `Verified operator cash funding: ${reference}`,
            idempotencyKey,
            metadata: { staffId, bankReference: reference, amountMinor: amountMinor.toString() },
            lines: [
              { accountId: capital.id, amountMinor: -amountMinor },
              { accountId: house.id, amountMinor },
            ],
          },
          tx,
        );
        verifyAmount(record);
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const earlier = await this.prisma.ledgerTransaction.findUnique({ where: { idempotencyKey } });
      if (!earlier) throw e;
      verifyAmount(earlier);
    }
    return this.view();
  }
}
