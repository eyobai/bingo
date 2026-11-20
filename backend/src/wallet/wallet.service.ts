import { Injectable } from '@nestjs/common';
import { AccountType, TxType } from '@prisma/client';
import { money } from '../common/common';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService, Tx } from '../prisma.service';

const HISTORY_LABELS: Record<TxType, string> = {
  DEPOSIT: 'Deposit',
  BONUS: 'Bonus',
  CARD_PURCHASE: 'Cards bought',
  CARD_REFUND: 'Card refund',
  ROUND_SETTLEMENT: 'Prize',
  WITHDRAWAL_HOLD: 'Withdrawal requested',
  WITHDRAWAL_RELEASE: 'Withdrawal returned',
  WITHDRAWAL_PAYOUT: 'Withdrawal paid',
  ADJUSTMENT: 'Correction',
};

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async balancesMinor(userId: string, tx?: Tx) {
    const accounts = await this.ledger.run((t) => this.ledger.userAccounts(userId, t), tx);
    return { main: accounts.main.balanceMinor, play: accounts.play.balanceMinor, hold: accounts.hold.balanceMinor };
  }

  async balances(userId: string) {
    const b = await this.balancesMinor(userId);
    return {
      main: money(b.main),
      play: money(b.play),
      pendingWithdrawal: money(b.hold),
      total: money(b.main + b.play),
    };
  }

  /** Newest first. One row per money movement on the main or play wallet. */
  async history(userId: string, limit = 30) {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { account: { userId, type: { in: [AccountType.USER_MAIN, AccountType.USER_PLAY] } } },
      include: { transaction: true, account: { select: { type: true } } },
      orderBy: { sequence: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return entries.map((e) => ({
      id: e.id,
      at: e.createdAt,
      type: e.transaction.type,
      label: HISTORY_LABELS[e.transaction.type],
      description: e.transaction.description,
      wallet: e.account.type === AccountType.USER_PLAY ? 'play' : 'main',
      amount: money(e.amountMinor),
      balanceAfter: money(e.balanceAfterMinor),
    }));
  }

  /** Gives bonus money (play wallet) paid from the promotions budget. */
  async grantBonus(userId: string, amountMinor: bigint, description: string, idempotencyKey: string, tx: Tx) {
    if (amountMinor <= 0n) return;
    const { play } = await this.ledger.userAccounts(userId, tx);
    const promo = await this.ledger.systemAccount(AccountType.PROMOTIONS, tx);
    await this.ledger.post(
      {
        type: TxType.BONUS,
        description,
        idempotencyKey,
        lines: [
          { accountId: promo.id, amountMinor: -amountMinor },
          { accountId: play.id, amountMinor },
        ],
      },
      tx,
    );
  }
}
