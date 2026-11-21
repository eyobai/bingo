import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { Matches } from 'class-validator';
import { StaffAuthService } from './auth/staff-auth.service';
import { BotService } from './bot/bot.service';
import { MAX_CARD_POOL } from './bingo/game.service';
import { WalletService } from './wallet/wallet.service';
import { AccountType, DepositStatus, Prisma, TxType, WithdrawalStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { GameService } from './bingo/game.service';
import { AdminOnly, AppError, CurrentUser, Public, money, type AuthUser } from './common/common';
import { LedgerService } from './ledger/ledger.service';
import { PaymentsService, depositView, withdrawalView } from './payments/payments.service';
import { PrismaService } from './prisma.service';

class ApproveDepositDto {
  /** Corrected amount in whole birr, when the SMS amount was wrong. */
  @IsOptional() @IsNumberString({ no_symbols: true }) amountBirr?: string;
}
class NoteDto {
  @IsOptional() @IsString() @Length(0, 255) note?: string;
}
class StaffCodeDto {
  @Matches(/^\d{1,15}$/, { message: 'Telegram id is a number' }) telegramId!: string;
}
class StaffVerifyDto {
  @Matches(/^\d{1,15}$/, { message: 'Telegram id is a number' }) telegramId!: string;
  @Matches(/^\d{6}$/, { message: 'The code has 6 digits' }) code!: string;
}
class BlockDto {
  @IsBoolean() blocked!: boolean;
}
class AdjustDto {
  @IsIn(['main', 'play']) wallet!: 'main' | 'play';
  /** Whole birr. Negative takes money away. */
  @Matches(/^-?\d{1,7}$/, { message: 'Amount is a whole number of birr, e.g. 50 or -50' }) amountBirr!: string;
  @IsString() @Length(3, 200) reason!: string;
}
class BroadcastDto {
  @IsString() @Length(1, 4000) text!: string;
  /** Optional picture as base64 (JPEG or PNG), at most about 5 MB. */
  @IsOptional() @IsString() @Length(0, 7_000_000) imageBase64?: string;
  @IsBoolean() playButton!: boolean;
  /** true = send only to the staff member who asked (a test). */
  @IsBoolean() testOnly!: boolean;
}
class RoomUpdateDto {
  @IsOptional() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) stakeBirr?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(20) @Max(MAX_CARD_POOL) cardPool?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) maxCardsPerPlayer?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) guaranteedPrizeBirr?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5000) houseCutBps?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(300) selectSeconds?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1000) @Max(15000) callIntervalMs?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) minCards?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Staff API. Every route needs an ADMIN account. Changes to a room apply from its next round. */
@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    private readonly game: GameService,
    private readonly wallet: WalletService,
    private readonly bot: BotService,
  ) {}

  @Get('summary')
  async summary(@Query('days') daysRaw?: string) {
    const days = Math.min(Math.max(Number(daysRaw) || 1, 1), 90);
    const since = new Date(Date.now() - days * 86_400_000);
    const [rounds, players, newPlayers, pendingDeposits, pendingWithdrawals, deposits, withdrawals] = await Promise.all([
      this.prisma.round.aggregate({
        where: { status: 'FINISHED', finishedAt: { gte: since } },
        _count: true,
        _sum: { stakeTotalMinor: true, prizeMinor: true, houseCutMinor: true, topUpMinor: true, cardsSold: true },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.deposit.count({ where: { status: DepositStatus.PENDING } }),
      this.prisma.withdrawal.count({ where: { status: WithdrawalStatus.PENDING } }),
      this.prisma.deposit.aggregate({ where: { status: DepositStatus.APPROVED, reviewedAt: { gte: since } }, _sum: { amountMinor: true, bonusMinor: true } }),
      this.prisma.withdrawal.aggregate({ where: { status: WithdrawalStatus.PAID, reviewedAt: { gte: since } }, _sum: { amountMinor: true } }),
    ]);
    const owed = await this.prisma.ledgerAccount.aggregate({
      where: { type: { in: [AccountType.USER_MAIN, AccountType.USER_PLAY, AccountType.USER_WITHDRAW_HOLD] } },
      _sum: { balanceMinor: true },
    });
    const s = rounds._sum;
    return {
      periodDays: days,
      rounds: rounds._count,
      cardsSold: s.cardsSold ?? 0,
      stakes: money(s.stakeTotalMinor ?? 0n),
      prizesPaid: money(s.prizeMinor ?? 0n),
      houseRevenue: money(s.houseCutMinor ?? 0n),
      guaranteeTopUps: money(s.topUpMinor ?? 0n),
      depositsApproved: money(deposits._sum.amountMinor ?? 0n),
      depositBonuses: money(deposits._sum.bonusMinor ?? 0n),
      withdrawalsPaid: money(withdrawals._sum.amountMinor ?? 0n),
      players,
      newPlayers,
      pendingDeposits,
      pendingWithdrawals,
      /** Everything players could ask for right now. Keep at least this much in your payment accounts. */
      owedToPlayers: money(owed._sum.balanceMinor ?? 0n),
      /** Must be 0. Anything else means the books are broken: stop and investigate. */
      ledgerCheck: money(await this.ledger.trialBalance()),
    };
  }

  @Get('deposits')
  async deposits(@Query('status') status?: string) {
    const where = status && status in DepositStatus ? { status: status as DepositStatus } : {};
    const rows = await this.prisma.deposit.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { user: true } });
    return rows.map((d) => ({ ...depositView(d), smsText: d.smsText, player: { id: d.user.id, name: d.user.firstName, username: d.user.username } }));
  }

  @Post('deposits/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@CurrentUser() staff: AuthUser, @Param('id') id: string, @Body() body: ApproveDepositDto) {
    const amount = body.amountBirr ? BigInt(body.amountBirr) * 100n : undefined;
    return depositView(await this.payments.approveDeposit(id, staff.id, amount));
  }

  @Post('deposits/:id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(@CurrentUser() staff: AuthUser, @Param('id') id: string, @Body() body: NoteDto) {
    return depositView(await this.payments.rejectDeposit(id, staff.id, body.note ?? 'Payment not found'));
  }

  @Get('withdrawals')
  async withdrawals(@Query('status') status?: string) {
    const where = status && status in WithdrawalStatus ? { status: status as WithdrawalStatus } : {};
    const rows = await this.prisma.withdrawal.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { user: true } });
    return rows.map((w) => ({ ...withdrawalView(w), player: { id: w.user.id, name: w.user.firstName, username: w.user.username } }));
  }

  @Post('withdrawals/:id/paid')
  @HttpCode(HttpStatus.OK)
  async paid(@CurrentUser() staff: AuthUser, @Param('id') id: string, @Body() body: NoteDto) {
    return withdrawalView(await this.payments.reviewWithdrawal(id, staff.id, true, body.note ?? ''));
  }

  @Post('withdrawals/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectWithdrawal(@CurrentUser() staff: AuthUser, @Param('id') id: string, @Body() body: NoteDto) {
    return withdrawalView(await this.payments.reviewWithdrawal(id, staff.id, false, body.note ?? ''));
  }

  @Get('rooms')
  rooms() {
    return this.prisma.room.findMany({ orderBy: { sortOrder: 'asc' } }).then((rows) =>
      rows.map((r) => ({ ...r, stakeMinor: money(r.stakeMinor), guaranteedPrizeMinor: money(r.guaranteedPrizeMinor) })),
    );
  }

  @Patch('rooms/:id')
  async updateRoom(@Param('id') id: string, @Body() body: RoomUpdateDto) {
    const { guaranteedPrizeBirr, stakeBirr, ...rest } = body;
    const r = await this.prisma.room.update({
      where: { id },
      data: {
        ...rest,
        ...(guaranteedPrizeBirr !== undefined ? { guaranteedPrizeMinor: BigInt(guaranteedPrizeBirr) * 100n } : {}),
        ...(stakeBirr !== undefined ? { stakeMinor: BigInt(stakeBirr) * 100n } : {}),
      },
    });
    if (r.isActive) await this.game.ensureRoom(r.id);
    return { ...r, stakeMinor: money(r.stakeMinor), guaranteedPrizeMinor: money(r.guaranteedPrizeMinor), note: 'Applies from the next round.' };
  }

  @Get('rounds')
  async rounds() {
    const rows = await this.prisma.round.findMany({ orderBy: { number: 'desc' }, take: 50, include: { winners: true } });
    return rows.map((r) => ({
      number: r.number,
      roomId: r.roomId,
      status: r.status,
      cardsSold: r.cardsSold,
      stakes: money(r.stakeTotalMinor),
      prize: money(r.prizeMinor),
      houseCut: money(r.houseCutMinor),
      topUp: money(r.topUpMinor),
      calls: r.calls.length,
      winners: r.winners.map((w) => w.cardNo),
      at: r.createdAt,
    }));
  }

  @Get('players')
  async players(@Query('q') q = '', @Query('filter') filter = '') {
    const term = q.trim();
    const where: Prisma.UserWhereInput = {
      ...(filter === 'blocked' ? { isBlocked: true } : filter === 'staff' ? { role: 'ADMIN' } : {}),
      ...(term
        ? {
            OR: [
              { firstName: { contains: term, mode: 'insensitive' } },
              { username: { contains: term.replace(/^@/, ''), mode: 'insensitive' } },
              ...(/^\d{1,15}$/.test(term) ? [{ telegramId: BigInt(term) }] : []),
            ],
          }
        : {}),
    };
    const users = await this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { accounts: true } });
    return users.map((u) => {
      const bal = (t: AccountType) => u.accounts.find((a) => a.type === t)?.balanceMinor ?? 0n;
      return {
        id: u.id,
        telegramId: u.telegramId.toString(),
        name: [u.firstName, u.lastName].filter(Boolean).join(' '),
        username: u.username,
        role: u.role,
        isBlocked: u.isBlocked,
        joinedAt: u.createdAt,
        main: money(bal(AccountType.USER_MAIN)),
        play: money(bal(AccountType.USER_PLAY)),
      };
    });
  }

  @Get('players/:id')
  async player(@Param('id') id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { referredBy: { select: { firstName: true } } } });
    if (!u) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Player not found.');
    const [balances, history, deposits, withdrawals, cards, wins, invited] = await Promise.all([
      this.wallet.balances(id),
      this.wallet.history(id, 50),
      this.prisma.deposit.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.withdrawal.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.card.aggregate({ where: { userId: id }, _count: true, _sum: { paidMainMinor: true, paidPlayMinor: true } }),
      this.prisma.winner.aggregate({ where: { userId: id }, _count: true, _sum: { prizeMinor: true } }),
      this.prisma.user.count({ where: { referredById: id } }),
    ]);
    const deposited = deposits.filter((d) => d.status === 'APPROVED').reduce((s, d) => s + d.amountMinor, 0n);
    const withdrawn = withdrawals.filter((w) => w.status === 'PAID').reduce((s, w) => s + w.amountMinor, 0n);
    return {
      id: u.id,
      telegramId: u.telegramId.toString(),
      name: [u.firstName, u.lastName].filter(Boolean).join(' '),
      username: u.username,
      role: u.role,
      isBlocked: u.isBlocked,
      joinedAt: u.createdAt,
      language: u.language,
      invitedBy: u.referredBy?.firstName ?? null,
      invited,
      balances,
      stats: {
        cardsBought: cards._count,
        spentOnCards: money((cards._sum.paidMainMinor ?? 0n) + (cards._sum.paidPlayMinor ?? 0n)),
        wins: wins._count,
        prizesWon: money(wins._sum.prizeMinor ?? 0n),
        deposited: money(deposited),
        withdrawn: money(withdrawn),
      },
      history,
      deposits: deposits.map(depositView),
      withdrawals: withdrawals.map(withdrawalView),
    };
  }

  @Post('players/:id/block')
  @HttpCode(HttpStatus.OK)
  async block(@CurrentUser() staff: AuthUser, @Param('id') id: string, @Body() body: BlockDto) {
    if (id === staff.id) throw new AppError(HttpStatus.BAD_REQUEST, 'SELF', 'You cannot block yourself.');
    const u = await this.prisma.user.update({ where: { id }, data: { isBlocked: body.blocked } });
    return { id: u.id, isBlocked: u.isBlocked };
  }

  /**
   * Manual correction with a reason, e.g. a deposit credited twice by mistake or a goodwill gesture.
   * Money comes from or goes to the ADJUSTMENTS account, so the books still balance and the change is traceable.
   */
  @Post('players/:id/adjust')
  @HttpCode(HttpStatus.OK)
  async adjust(@CurrentUser() staff: AuthUser, @Param('id') id: string, @Body() body: AdjustDto) {
    const amount = BigInt(body.amountBirr) * 100n;
    if (amount === 0n) throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_AMOUNT', 'Amount cannot be 0.');
    await this.ledger.withTx(async (tx) => {
      const accounts = await this.ledger.userAccounts(id, tx);
      const target = body.wallet === 'main' ? accounts.main : accounts.play;
      const adjustments = await this.ledger.systemAccount(AccountType.ADJUSTMENTS, tx);
      await this.ledger.post(
        {
          type: TxType.ADJUSTMENT,
          description: `Correction by staff: ${body.reason}`,
          metadata: { staffId: staff.id, reason: body.reason },
          lines: [
            { accountId: target.id, amountMinor: amount },
            { accountId: adjustments.id, amountMinor: -amount },
          ],
        },
        tx,
      );
    });
    return this.wallet.balances(id);
  }

  @Get('broadcast')
  async broadcastInfo() {
    const audience = await this.prisma.user.count({ where: { isBlocked: false } });
    return { audience, last: this.bot.broadcastStatus() };
  }

  /** Sends a message to all players (or only to you, as a test). Pictures are sent with the text as caption. */
  @Post('broadcast')
  @HttpCode(HttpStatus.OK)
  async broadcast(@CurrentUser() staff: AuthUser, @Body() body: BroadcastDto) {
    const photo = body.imageBase64 ? Buffer.from(body.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64') : undefined;
    if (photo && photo.length > 5 * 1024 * 1024) throw new AppError(HttpStatus.BAD_REQUEST, 'IMAGE_TOO_BIG', 'The picture must be under 5 MB.');
    if (photo && body.text.length > 1024) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'TEXT_TOO_LONG', 'With a picture, Telegram allows at most 1024 characters of text.');
    }
    let onlyTo: string | undefined;
    if (body.testOnly) {
      const me = await this.prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
      onlyTo = me.telegramId.toString();
    }
    return this.bot.broadcast({ text: body.text, photo, playButton: body.playButton, onlyTo });
  }

  /** Not used by the game; handy to check the engine is alive. */
  @Get('live')
  live() {
    return this.game.roomIds().map((id) => this.game.publicState(id));
  }
}

/** Dashboard sign-in for staff: a one-time code sent by the bot. */
@Controller('auth/staff')
export class StaffAuthController {
  constructor(private readonly staff: StaffAuthService) {}

  @Public()
  @Post('code')
  @HttpCode(HttpStatus.OK)
  code(@Body() body: StaffCodeDto) {
    return this.staff.sendCode(body.telegramId);
  }

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body() body: StaffVerifyDto) {
    return this.staff.verify(body.telegramId, body.code);
  }
}
