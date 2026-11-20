import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { DepositStatus, WithdrawalStatus, AccountType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumberString, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { GameService } from './bingo/game.service';
import { AdminOnly, CurrentUser, money, type AuthUser } from './common/common';
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
class RoomUpdateDto {
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
    const { guaranteedPrizeBirr, ...rest } = body;
    const r = await this.prisma.room.update({
      where: { id },
      data: { ...rest, ...(guaranteedPrizeBirr !== undefined ? { guaranteedPrizeMinor: BigInt(guaranteedPrizeBirr) * 100n } : {}) },
    });
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

  /** Not used by the game; handy to check the engine is alive. */
  @Get('live')
  live() {
    return this.game.roomIds().map((id) => this.game.publicState(id));
  }
}
