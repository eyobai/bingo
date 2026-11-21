import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AccountType, DepositStatus, PaymentMethod, TxType, WithdrawalStatus } from '@prisma/client';
import type { Deposit, Withdrawal } from '@prisma/client';
import { AppError, isUniqueViolation, money } from '../common/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { LedgerService } from '../ledger/ledger.service';
import { NotifyService } from '../notify.service';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { parsePaymentSms } from './sms-parser';

const METHOD_LABEL: Record<PaymentMethod, string> = { TELEBIRR: 'Telebirr', CBE_BIRR: 'CBE Birr' };

/** Loose name match: every word of the configured name must appear in the SMS name ("YABIBAL ESHETE"). */
function sameReceiver(configured: string, inSms: string | undefined): boolean {
  if (!configured || !inSms) return true;
  const words = configured.toUpperCase().split(/\s+/).filter(Boolean);
  return words.every((w) => inSms.includes(w));
}

export function depositView(d: Deposit) {
  return {
    id: d.id,
    method: d.method,
    amount: money(d.amountMinor),
    bonus: money(d.bonusMinor),
    txRef: d.txRef,
    status: d.status,
    note: d.note,
    createdAt: d.createdAt,
    reviewedAt: d.reviewedAt,
  };
}

export function withdrawalView(w: Withdrawal) {
  return {
    id: w.id,
    method: w.method,
    accountNumber: w.accountNumber,
    accountName: w.accountName,
    amount: money(w.amountMinor),
    status: w.status,
    payoutRef: w.payoutRef,
    note: w.note,
    createdAt: w.createdAt,
    reviewedAt: w.reviewedAt,
  };
}

/**
 * Deposits: the player sends money by Telebirr/CBE Birr to the platform's number, then pastes the SMS.
 * The SMS is parsed and stored as PENDING; staff confirm the money arrived and approve (one tap in the bot).
 * The transaction number is unique, so the same SMS can never be credited twice.
 *
 * Withdrawals: the amount moves from the main wallet to a hold account at once; staff pay it out and mark
 * it paid, or reject it and the money goes back.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly notify: NotifyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  options() {
    const methods = (Object.keys(METHOD_LABEL) as PaymentMethod[])
      .filter((m) => this.config.paymentAccounts[m].account)
      .map((m) => ({
        method: m,
        label: METHOD_LABEL[m],
        accountNumber: this.config.paymentAccounts[m].account,
        accountName: this.config.paymentAccounts[m].name,
      }));
    return {
      methods,
      depositMin: money(this.config.money.depositMinMinor),
      withdrawMin: money(this.config.money.withdrawMinMinor),
      firstDepositBonusPercent: this.config.money.firstDepositBonusPercent,
    };
  }

  async submitDeposit(userId: string, method: PaymentMethod, smsText: string): Promise<Deposit> {
    const account = this.config.paymentAccounts[method];
    if (!account?.account) throw new AppError(HttpStatus.BAD_REQUEST, 'METHOD_OFF', 'This payment method is not available.');
    const parsed = parsePaymentSms(smsText);
    if (!parsed.ok) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'SMS_UNREADABLE',
        'We could not read that SMS. Paste the whole confirmation message you received after sending money.',
        { reason: parsed.reason },
      );
    }
    const { amountMinor, txRef, receiverName } = parsed.value;
    if (amountMinor < this.config.money.depositMinMinor) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'DEPOSIT_TOO_SMALL',
        `The minimum deposit is ${money(this.config.money.depositMinMinor).birr} birr.`,
      );
    }
    if (!sameReceiver(account.name, receiverName)) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'WRONG_RECEIVER',
        `This SMS shows money sent to ${receiverName}. Send to ${account.name} (${account.account}) and paste that SMS.`,
      );
    }
    try {
      const deposit = await this.prisma.deposit.create({
        data: { userId, method, amountMinor, txRef, smsText: smsText.slice(0, 2000) },
      });
      this.notify.emit('depositSubmitted', deposit);
      return deposit;
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new AppError(HttpStatus.CONFLICT, 'TX_ALREADY_USED', 'This transaction number has already been submitted.');
      }
      throw e;
    }
  }

  /** Credits the deposit (optionally a corrected amount) plus first-deposit and referral bonuses. */
  async approveDeposit(depositId: string, staffId: string | null, amountMinor?: bigint): Promise<Deposit> {
    const deposit = await this.ledger.withTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM deposits WHERE id = ${depositId}::uuid FOR UPDATE`;
      const d = await tx.deposit.findUnique({ where: { id: depositId }, include: { user: true } });
      if (!d) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Deposit not found.');
      if (d.status !== DepositStatus.PENDING) {
        throw new AppError(HttpStatus.CONFLICT, 'ALREADY_REVIEWED', `This deposit is already ${d.status.toLowerCase()}.`);
      }
      const amount = amountMinor ?? d.amountMinor;
      if (amount <= 0n) throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_AMOUNT', 'Amount must be positive.');

      const { main } = await this.ledger.userAccounts(d.userId, tx);
      const clearing = await this.ledger.systemAccount(AccountType.PAYMENT_CLEARING, tx);
      await this.ledger.post(
        {
          type: TxType.DEPOSIT,
          description: `Deposit via ${METHOD_LABEL[d.method]} (${d.txRef})`,
          idempotencyKey: `deposit:${d.id}`,
          metadata: { depositId: d.id, txRef: d.txRef },
          lines: [
            { accountId: clearing.id, amountMinor: -amount },
            { accountId: main.id, amountMinor: amount },
          ],
        },
        tx,
      );

      let bonus = 0n;
      const earlier = await tx.deposit.count({ where: { userId: d.userId, status: DepositStatus.APPROVED } });
      if (earlier === 0) {
        const m = this.config.money;
        bonus = (amount * BigInt(m.firstDepositBonusPercent)) / 100n;
        if (bonus > m.firstDepositBonusMaxMinor) bonus = m.firstDepositBonusMaxMinor;
        await this.wallet.grantBonus(d.userId, bonus, `First-deposit bonus (${m.firstDepositBonusPercent}%)`, `first-deposit:${d.userId}`, tx);
        const rewarded = d.user.referredById
          ? await tx.user.count({ where: { referredById: d.user.referredById, referralPaid: true } })
          : 0;
        const underLimit = m.referralMaxFriends === 0 || rewarded < m.referralMaxFriends;
        if (d.user.referredById && !d.user.referralPaid && m.referralBonusMinor > 0n && underLimit) {
          await this.wallet.grantBonus(
            d.user.referredById,
            m.referralBonusMinor,
            `Invite reward: ${d.user.firstName} made a first deposit`,
            `referral:${d.userId}`,
            tx,
          );
          await tx.user.update({ where: { id: d.userId }, data: { referralPaid: true } });
        }
      }
      return tx.deposit.update({
        where: { id: d.id },
        data: { status: DepositStatus.APPROVED, amountMinor: amount, bonusMinor: bonus, reviewedById: staffId, reviewedAt: new Date() },
      });
    });
    this.notify.emit('depositReviewed', deposit);
    this.notify.emit('walletChanged', deposit.userId);
    return deposit;
  }

  async rejectDeposit(depositId: string, staffId: string | null, note: string): Promise<Deposit> {
    const res = await this.prisma.deposit.updateMany({
      where: { id: depositId, status: DepositStatus.PENDING },
      data: { status: DepositStatus.REJECTED, reviewedById: staffId, reviewedAt: new Date(), note: note.slice(0, 255) },
    });
    if (res.count === 0) throw new AppError(HttpStatus.CONFLICT, 'ALREADY_REVIEWED', 'This deposit is not pending.');
    const deposit = await this.prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    this.notify.emit('depositReviewed', deposit);
    return deposit;
  }

  async requestWithdrawal(
    userId: string,
    input: { method: PaymentMethod; accountNumber: string; accountName: string; amountMinor: bigint },
  ): Promise<Withdrawal> {
    if (input.amountMinor < this.config.money.withdrawMinMinor) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'WITHDRAWAL_TOO_SMALL',
        `The minimum withdrawal is ${money(this.config.money.withdrawMinMinor).birr} birr.`,
      );
    }
    const w = await this.ledger.withTx(async (tx) => {
      const owner = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (owner.isBlocked) throw new AppError(HttpStatus.FORBIDDEN, 'BLOCKED', 'Your account is blocked. Contact support.');
      const { main, hold } = await this.ledger.userAccounts(userId, tx);
      // Locks the main account first so two requests at once cannot both pass the "one pending" check.
      await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${main.id}::uuid FOR UPDATE`;
      const pending = await tx.withdrawal.count({ where: { userId, status: WithdrawalStatus.PENDING } });
      if (pending) {
        throw new AppError(HttpStatus.CONFLICT, 'WITHDRAWAL_PENDING', 'You already have a withdrawal waiting to be paid.');
      }
      const created = await tx.withdrawal.create({
        data: {
          userId,
          method: input.method,
          accountNumber: input.accountNumber.trim(),
          accountName: input.accountName.trim(),
          amountMinor: input.amountMinor,
        },
      });
      await this.ledger.post(
        {
          type: TxType.WITHDRAWAL_HOLD,
          description: `Withdrawal to ${METHOD_LABEL[input.method]} ${input.accountNumber}`,
          idempotencyKey: `withdraw-hold:${created.id}`,
          lines: [
            { accountId: main.id, amountMinor: -input.amountMinor },
            { accountId: hold.id, amountMinor: input.amountMinor },
          ],
        },
        tx,
      );
      return created;
    });
    this.notify.emit('withdrawalRequested', w);
    this.notify.emit('walletChanged', userId);
    return w;
  }

  /** `paid=true`: staff sent the money. `paid=false`: rejected, money returns to the main wallet. */
  async reviewWithdrawal(id: string, staffId: string | null, paid: boolean, text = ''): Promise<Withdrawal> {
    const w = await this.ledger.withTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM withdrawals WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.withdrawal.findUnique({ where: { id } });
      if (!row) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Withdrawal not found.');
      if (row.status !== WithdrawalStatus.PENDING) {
        throw new AppError(HttpStatus.CONFLICT, 'ALREADY_REVIEWED', `This withdrawal is already ${row.status.toLowerCase()}.`);
      }
      const { main, hold } = await this.ledger.userAccounts(row.userId, tx);
      const target = paid ? (await this.ledger.systemAccount(AccountType.PAYMENT_CLEARING, tx)).id : main.id;
      await this.ledger.post(
        {
          type: paid ? TxType.WITHDRAWAL_PAYOUT : TxType.WITHDRAWAL_RELEASE,
          description: paid ? `Withdrawal paid${text ? ` (${text})` : ''}` : `Withdrawal rejected${text ? `: ${text}` : ''}`,
          idempotencyKey: `withdraw-${paid ? 'paid' : 'release'}:${row.id}`,
          lines: [
            { accountId: hold.id, amountMinor: -row.amountMinor },
            { accountId: target, amountMinor: row.amountMinor },
          ],
        },
        tx,
      );
      return tx.withdrawal.update({
        where: { id },
        data: {
          status: paid ? WithdrawalStatus.PAID : WithdrawalStatus.REJECTED,
          reviewedById: staffId,
          reviewedAt: new Date(),
          ...(paid ? { payoutRef: text.slice(0, 60) || null } : { note: text.slice(0, 255) || null }),
        },
      });
    });
    this.notify.emit('withdrawalReviewed', w);
    this.notify.emit('walletChanged', w.userId);
    return w;
  }

  myDeposits(userId: string) {
    return this.prisma.deposit.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
  }

  myWithdrawals(userId: string) {
    return this.prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
  }
}
