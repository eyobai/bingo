import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumberString, IsOptional, IsString, Length, Min } from 'class-validator';
import { verifyInitData } from './auth/telegram-init-data';
import { GameService } from './bingo/game.service';
import { lineName } from './bingo/cards';
import { AppError, CurrentUser, Public, money, type AuthUser } from './common/common';
import { APP_CONFIG, type AppConfig } from './config/config';
import { PaymentsService, depositView, withdrawalView } from './payments/payments.service';
import { PrismaService } from './prisma.service';
import { PromoService } from './promo/promo.service';
import { UsersService } from './users/users.service';
import { WalletService } from './wallet/wallet.service';

class TelegramLoginDto {
  @IsString() @Length(10, 4096) initData!: string;
}
class DevLoginDto {
  @Type(() => Number) @IsInt() @Min(1) telegramId!: number;
  @IsString() @Length(1, 64) firstName!: string;
  @IsOptional() @IsString() @Length(1, 32) startParam?: string;
}
class PromoDto {
  @IsString() @Length(1, 40) code!: string;
}
class LanguageDto {
  @IsIn(['am', 'en']) language!: 'am' | 'en';
}
class BuyCardsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsInt({ each: true }) cardNos!: number[];
}
class DepositDto {
  @IsIn(Object.values(PaymentMethod)) method!: PaymentMethod;
  @IsString() @Length(20, 2000) smsText!: string;
}
class WithdrawDto {
  @IsIn(Object.values(PaymentMethod)) method!: PaymentMethod;
  @IsString() @Length(9, 20) accountNumber!: string;
  @IsString() @Length(2, 80) accountName!: string;
  /** Whole birr. */
  @IsNumberString({ no_symbols: true }) amountBirr!: string;
}

function userView(u: { id: string; firstName: string; lastName: string | null; username: string | null; language: string; role: string; referralCode: string; createdAt: Date }, botUsername: string) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    language: u.language,
    role: u.role,
    referralCode: u.referralCode,
    inviteLink: botUsername ? `https://t.me/${botUsername}?start=ref_${u.referralCode}` : null,
    memberSince: u.createdAt,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The Mini App sends Telegram's signed `initData`; we answer with our own access token. */
  @Public()
  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  async telegram(@Body() body: TelegramLoginDto) {
    if (!this.config.bot.token) throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'BOT_NOT_CONFIGURED', 'Telegram sign-in is not set up.');
    const r = verifyInitData(body.initData, this.config.bot.token, this.config.bot.initDataMaxAge);
    if (!r.ok) throw new AppError(HttpStatus.UNAUTHORIZED, 'BAD_INIT_DATA', 'Please open the game again from the Telegram bot.', { reason: r.reason });
    const { user } = await this.users.fromTelegram(r.user, r.startParam);
    return this.session(user);
  }

  /** Browser testing without Telegram. Only when DEV_LOGIN=true (refused in production). */
  @Public()
  @Post('dev')
  @HttpCode(HttpStatus.OK)
  async dev(@Body() body: DevLoginDto) {
    if (!this.config.devLogin) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    let { user } = await this.users.fromTelegram({ id: body.telegramId, first_name: body.firstName }, body.startParam);
    // Test accounts have no Telegram to share a number from; give them a made-up one so they can play.
    if (!user.phone) {
      await this.users.registerPhone(user.id, `+2519${String(body.telegramId).padStart(8, '0').slice(-8)}`);
      user = { ...user, phone: 'test' };
    }
    return this.session(user);
  }

  private session(user: Parameters<typeof userView>[0] & { isBlocked: boolean }) {
    if (user.isBlocked) throw new AppError(HttpStatus.FORBIDDEN, 'BLOCKED', 'Your account is blocked. Contact support.');
    const token = this.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: this.config.jwtTtl as any });
    return { token, user: userView(user, this.config.bot.username) };
  }
}

@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly users: UsersService,
    private readonly promo: PromoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Redeems a promo code: the bonus goes to the play wallet. */
  @Post('promo')
  @HttpCode(HttpStatus.OK)
  async redeem(@CurrentUser() auth: AuthUser, @Body() body: PromoDto) {
    const r = await this.promo.redeem(auth.id, body.code);
    return { code: r.code, amount: money(r.amountMinor), wallet: await this.wallet.balances(auth.id) };
  }

  @Get()
  async me(@CurrentUser() auth: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
    const invited = await this.prisma.user.count({ where: { referredById: auth.id } });
    return { user: userView(user, this.config.bot.username), wallet: await this.wallet.balances(auth.id), invited };
  }

  @Post('language')
  @HttpCode(HttpStatus.OK)
  async language(@CurrentUser() auth: AuthUser, @Body() body: LanguageDto) {
    await this.users.setLanguage(auth.id, body.language);
    return { language: body.language };
  }

  @Get('wallet')
  async walletPage(@CurrentUser() auth: AuthUser) {
    return { balances: await this.wallet.balances(auth.id), history: await this.wallet.history(auth.id) };
  }

  /** My recent rounds: cards played, cost, prize. */
  @Get('games')
  async games(@CurrentUser() auth: AuthUser) {
    const cards = await this.prisma.card.findMany({
      where: { userId: auth.id },
      orderBy: { createdAt: 'desc' },
      take: 120,
      include: { round: { select: { id: true, number: true, roomId: true, status: true, createdAt: true } } },
    });
    const roundIds = [...new Set(cards.map((c) => c.roundId))].slice(0, 30);
    const wins = await this.prisma.winner.findMany({ where: { userId: auth.id, roundId: { in: roundIds } } });
    return roundIds.map((id) => {
      const mine = cards.filter((c) => c.roundId === id);
      const r = mine[0].round;
      const won = wins.filter((w) => w.roundId === id);
      return {
        roundNumber: r.number,
        roomId: r.roomId,
        status: r.status,
        at: r.createdAt,
        cards: mine.map((c) => c.cardNo).sort((a, b) => a - b),
        cost: money(mine.reduce((s, c) => s + c.paidMainMinor + c.paidPlayMinor, 0n)),
        prize: money(won.reduce((s, w) => s + w.prizeMinor, 0n)),
        winningCards: won.map((w) => ({ cardNo: w.cardNo, line: lineName(w.lineIndex) })),
      };
    });
  }
}

@Controller()
export class GameController {
  constructor(
    private readonly game: GameService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('rooms')
  rooms() {
    return this.game.roomIds().map((id) => {
      const s = this.game.publicState(id)!;
      return { ...s.room, round: { number: s.round.number, status: s.round.status, players: s.round.players, prize: s.round.prize, selectEndsAt: s.round.selectEndsAt } };
    });
  }

  /** Card layouts 1..pool. They never change, so the app downloads them once. */
  @Public()
  @Get('cards')
  cards(@Query('pool', ParseIntPipe) pool: number) {
    return { cards: this.game.cards(Math.min(Math.max(pool, 1), 2000)) };
  }

  @Public()
  @Get('rooms/:roomId/state')
  state(@Param('roomId') roomId: string) {
    const s = this.game.publicState(roomId);
    if (!s) throw new AppError(HttpStatus.NOT_FOUND, 'ROOM_NOT_FOUND', 'This game room is closed.');
    return s;
  }

  @Get('rooms/:roomId/my-cards')
  myCards(@CurrentUser() auth: AuthUser, @Param('roomId') roomId: string) {
    return { roundId: this.game.publicState(roomId)?.round.id ?? null, cards: this.game.myCards(roomId, auth.id) };
  }

  @Post('rooms/:roomId/cards')
  @HttpCode(HttpStatus.OK)
  async buy(@CurrentUser() auth: AuthUser, @Param('roomId') roomId: string, @Body() body: BuyCardsDto) {
    return { cards: await this.game.buyCards(auth.id, roomId, body.cardNos) };
  }

  @Delete('rooms/:roomId/cards/:cardNo')
  async giveBack(@CurrentUser() auth: AuthUser, @Param('roomId') roomId: string, @Param('cardNo', ParseIntPipe) cardNo: number) {
    return { cards: await this.game.returnCard(auth.id, roomId, cardNo) };
  }

  /** Proof for a finished round: the secret, its hash shown before the round, and the balls called. */
  @Public()
  @Get('rounds/:number/fairness')
  async fairness(@Param('number', ParseIntPipe) number: number) {
    const r = await this.prisma.round.findUnique({ where: { number } });
    if (!r) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Round not found.');
    const over = r.status === 'FINISHED' || r.status === 'CANCELLED';
    return {
      roundNumber: r.number,
      status: r.status,
      seedHash: r.seedHash,
      serverSeed: over ? r.serverSeed : null,
      calls: r.calls,
      howToCheck:
        'sha256(serverSeed) must equal seedHash. The ball order is a Fisher-Yates shuffle of 1..75 where each step ' +
        'uses HMAC-SHA256(serverSeed, "<roundNumber>:<counter>"), first 4 bytes, with rejection sampling.',
    };
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('options')
  options() {
    return this.payments.options();
  }

  @Post('deposits')
  async deposit(@CurrentUser() auth: AuthUser, @Body() body: DepositDto) {
    return depositView(await this.payments.submitDeposit(auth.id, body.method, body.smsText));
  }

  @Get('deposits')
  async deposits(@CurrentUser() auth: AuthUser) {
    return (await this.payments.myDeposits(auth.id)).map(depositView);
  }

  @Post('withdrawals')
  async withdraw(@CurrentUser() auth: AuthUser, @Body() body: WithdrawDto) {
    const amountMinor = BigInt(body.amountBirr) * 100n;
    return withdrawalView(await this.payments.requestWithdrawal(auth.id, { ...body, amountMinor }));
  }

  @Get('withdrawals')
  async withdrawals(@CurrentUser() auth: AuthUser) {
    return (await this.payments.myWithdrawals(auth.id)).map(withdrawalView);
  }
}

