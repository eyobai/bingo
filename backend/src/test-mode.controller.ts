import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Logger, OnModuleInit, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountType, TxType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';
import { timingSafeEqual } from 'node:crypto';
import { AppError, CurrentUser, Public, money, type AuthUser } from './common/common';
import { APP_CONFIG, type AppConfig } from './config/config';
import { LedgerService } from './ledger/ledger.service';
import { NotifyService } from './notify.service';
import { PrismaService } from './prisma.service';
import { UsersService } from './users/users.service';

import { TEST_ID_MAX, TEST_ID_MIN } from './test-players';
const TEST_FUND_MINOR = 50_000n; // 500 birr

class TestLoginDto {
  @Type(() => Number) @IsInt() @Min(TEST_ID_MIN) @Max(TEST_ID_MAX) telegramId!: number;
  @IsString() @Length(1, 40) firstName!: string;
}

/**
 * Sample players on a live server, for testing before launch (TEST_MODE=true). Safer than the developer
 * sign-in: every call needs the secret TEST_KEY, only test ids (900001-999999) can be used, so nobody can sign
 * in as a real player or as staff, and test money is booked to the ADJUSTMENTS account so it stays visible.
 */
@Controller('test')
export class TestModeController implements OnModuleInit {
  private readonly logger = new Logger('TestMode');

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly ledger: LedgerService,
    private readonly notify: NotifyService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.logger.log('Sample players can join with scripts/sim-players.mjs; the game tells everyone when they are playing.');
  }

  private check(key: string | undefined) {
    const given = Buffer.from(String(key ?? ''));
    const expected = Buffer.from(this.config.testKey);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError(HttpStatus.FORBIDDEN, 'BAD_TEST_KEY', 'Wrong test key.');
    }
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Headers('x-test-key') key: string | undefined, @Body() body: TestLoginDto) {
    this.check(key);
    const { user } = await this.users.fromTelegram({ id: body.telegramId, first_name: body.firstName });
    if (!user.phone) await this.users.registerPhone(user.id, `+2519${String(body.telegramId).slice(-8).padStart(8, '0')}`);
    const token = this.jwt.sign({ sub: user.id, role: 'PLAYER' }, { expiresIn: '12h' });
    return { token };
  }

  /** Gives the calling test player 500 birr of test money (main wallet). */
  @Public()
  @Post('fund')
  @HttpCode(HttpStatus.OK)
  async fund(@Headers('x-test-key') key: string | undefined, @Headers('authorization') authHeader: string | undefined) {
    this.check(key);
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    let userId: string;
    try {
      userId = this.jwt.verify<{ sub: string }>(token).sub;
    } catch {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Sign in first.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const id = Number(user.telegramId);
    if (id < TEST_ID_MIN || id > TEST_ID_MAX) throw new AppError(HttpStatus.FORBIDDEN, 'NOT_TEST_PLAYER', 'Only test players can get test money.');
    await this.ledger.withTx(async (tx) => {
      const { main } = await this.ledger.userAccounts(userId, tx);
      const adjustments = await this.ledger.systemAccount(AccountType.ADJUSTMENTS, tx);
      await this.ledger.post(
        {
          type: TxType.ADJUSTMENT,
          description: 'Test money (TEST MODE)',
          lines: [
            { accountId: main.id, amountMinor: TEST_FUND_MINOR },
            { accountId: adjustments.id, amountMinor: -TEST_FUND_MINOR },
          ],
        },
        tx,
      );
    });
    this.notify.emit('walletChanged', userId);
    return { added: money(TEST_FUND_MINOR) };
  }
}

