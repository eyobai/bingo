import { HttpStatus, Injectable } from '@nestjs/common';
import { AccountType, Prisma, TxType } from '@prisma/client';
import type { LedgerAccount } from '@prisma/client';
import { AppError } from '../common/common';
import { PrismaService, TX_OPTIONS, Tx } from '../prisma.service';

export interface PostingLine {
  accountId: string;
  /** Signed: positive adds to the account, negative takes from it. */
  amountMinor: bigint;
}

export interface PostingInput {
  type: TxType;
  description: string;
  lines: PostingLine[];
  metadata?: Prisma.InputJsonValue;
  idempotencyKey?: string;
}

/** System accounts that may go below zero: they record money that came from or left to the outside. */
const ALLOW_NEGATIVE: AccountType[] = [AccountType.PAYMENT_CLEARING, AccountType.PROMOTIONS, AccountType.ADJUSTMENTS];
const USER_TYPES: AccountType[] = [AccountType.USER_MAIN, AccountType.USER_PLAY, AccountType.USER_WITHDRAW_HOLD];

export interface UserAccounts {
  main: LedgerAccount;
  play: LedgerAccount;
  hold: LedgerAccount;
}

/** Checks a posting's shape. A malformed posting is a programming mistake, so it throws a plain Error. */
export function validateLines(lines: PostingLine[]) {
  if (lines.length < 2) throw new Error('A posting needs at least two lines');
  const seen = new Set<string>();
  let sum = 0n;
  for (const l of lines) {
    if (typeof l.amountMinor !== 'bigint') throw new Error('Amounts must be bigint');
    if (l.amountMinor === 0n) throw new Error('Zero-amount line');
    if (seen.has(l.accountId)) throw new Error('Each account may appear once per posting');
    seen.add(l.accountId);
    sum += l.amountMinor;
  }
  if (sum !== 0n) throw new Error(`Unbalanced posting (sum ${sum})`);
}

/**
 * The only code that moves money. Each movement is one transaction whose lines sum to zero; account rows
 * are locked (in a fixed order, to avoid deadlocks) and their balances updated in the same DB transaction.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(fn: (tx: Tx) => Promise<T>, tx?: Tx): Promise<T> {
    return tx ? fn(tx) : this.prisma.$transaction(fn, TX_OPTIONS);
  }

  async post(input: PostingInput, tx: Tx) {
    const lines = input.lines.filter((l) => l.amountMinor !== 0n);
    validateLines(lines);
    if (input.idempotencyKey) {
      const earlier = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (earlier) return earlier;
    }
    const ids = lines.map((l) => l.accountId).sort();
    const locked = await tx.$queryRaw<{ id: string; code: string; type: AccountType; allow_negative: boolean; balance_minor: bigint }[]>`
      SELECT id, code, type, allow_negative, balance_minor FROM ledger_accounts
      WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    const byId = new Map(locked.map((a) => [a.id, a]));

    const created = await tx.ledgerTransaction.create({
      data: {
        type: input.type,
        description: input.description.slice(0, 255),
        metadata: input.metadata,
        idempotencyKey: input.idempotencyKey,
      },
    });
    for (const line of lines) {
      const acc = byId.get(line.accountId);
      if (!acc) throw new Error(`Unknown ledger account ${line.accountId}`);
      const after = acc.balance_minor + line.amountMinor;
      if (after < 0n && !acc.allow_negative) {
        if (acc.type === AccountType.USER_MAIN || acc.type === AccountType.USER_PLAY) {
          throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'INSUFFICIENT_FUNDS', 'Not enough money in your wallet.');
        }
        throw new Error(`Posting would make ${acc.code} negative`);
      }
      acc.balance_minor = after;
      await tx.ledgerAccount.update({ where: { id: acc.id }, data: { balanceMinor: after } });
      await tx.ledgerEntry.create({
        data: { transactionId: created.id, accountId: acc.id, amountMinor: line.amountMinor, balanceAfterMinor: after },
      });
    }
    return created;
  }

  /** The player's three accounts, created on first use. */
  async userAccounts(userId: string, tx: Tx): Promise<UserAccounts> {
    await tx.ledgerAccount.createMany({
      data: USER_TYPES.map((type) => ({ code: `${type}:${userId}`, type, userId })),
      skipDuplicates: true,
    });
    const rows = await tx.ledgerAccount.findMany({ where: { userId } });
    const get = (t: AccountType) => rows.find((r) => r.type === t)!;
    return { main: get(AccountType.USER_MAIN), play: get(AccountType.USER_PLAY), hold: get(AccountType.USER_WITHDRAW_HOLD) };
  }

  async systemAccount(type: AccountType, tx: Tx): Promise<LedgerAccount> {
    if (USER_TYPES.includes(type)) throw new Error(`${type} is a player account`);
    const code = `SYSTEM:${type}`;
    await tx.ledgerAccount.createMany({
      data: [{ code, type, allowNegative: ALLOW_NEGATIVE.includes(type) }],
      skipDuplicates: true,
    });
    return tx.ledgerAccount.findUniqueOrThrow({ where: { code } });
  }

  /** Every account's balance summed: always 0 when the books are right. */
  async trialBalance(): Promise<bigint> {
    const r = await this.prisma.ledgerAccount.aggregate({ _sum: { balanceMinor: true } });
    return r._sum.balanceMinor ?? 0n;
  }

  withTx<T>(fn: (tx: Tx) => Promise<T>) {
    return this.prisma.$transaction(fn, TX_OPTIONS);
  }
}
