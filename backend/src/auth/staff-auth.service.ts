import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { BotService } from '../bot/bot.service';
import { AppError } from '../common/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma.service';

const CODE_TTL_MS = 5 * 60_000;
const RESEND_AFTER_MS = 30_000;
const MAX_ATTEMPTS = 5;

interface PendingCode {
  hash: Buffer;
  expires: number;
  sentAt: number;
  attempts: number;
}

const hash = (code: string) => createHash('sha256').update(code).digest();

/**
 * Staff sign in to the dashboard with a 6-digit code the bot sends to their own Telegram chat, so the
 * dashboard has no passwords to steal or forget. Codes live 5 minutes, allow 5 tries, and are kept only in
 * memory (as hashes). The answer to "send a code" is the same whether or not the id is staff.
 */
@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger('StaffLogin');
  private readonly codes = new Map<string, PendingCode>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: BotService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async staff(telegramId: string) {
    const user = await this.prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
    const isStaff = user?.role === Role.ADMIN || this.config.adminTelegramIds.has(telegramId);
    return isStaff && user && !user.isBlocked ? user : null;
  }

  async sendCode(telegramId: string): Promise<{ sent: true; via: 'telegram' | 'server-log' }> {
    const now = Date.now();
    const existing = this.codes.get(telegramId);
    if (existing && now - existing.sentAt < RESEND_AFTER_MS) {
      throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'WAIT', 'A code was just sent. Wait 30 seconds before asking again.');
    }
    const user = await this.staff(telegramId);
    if (!user) {
      // Same answer as success, so the form does not reveal who is staff.
      return { sent: true, via: 'telegram' };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.set(telegramId, { hash: hash(code), expires: now + CODE_TTL_MS, sentAt: now, attempts: 0 });
    const delivered = await this.bot.dm(
      telegramId,
      `🔐 Dashboard sign-in code: <code>${code}</code>\n\nIt works for 5 minutes. If you did not ask for it, ignore this message.`,
    );
    if (delivered) return { sent: true, via: 'telegram' };
    if (this.config.env !== 'production') {
      this.logger.warn(`Bot is off, so here is the dashboard code for ${telegramId}: ${code}`);
      return { sent: true, via: 'server-log' };
    }
    throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'BOT_OFF', 'The bot could not send the code. Check that it is running.');
  }

  async verify(telegramId: string, code: string) {
    const pending = this.codes.get(telegramId);
    const wrong = new AppError(HttpStatus.UNAUTHORIZED, 'BAD_CODE', 'That code is wrong or has expired. Ask for a new one.');
    if (!pending || pending.expires < Date.now() || pending.attempts >= MAX_ATTEMPTS) {
      this.codes.delete(telegramId);
      throw wrong;
    }
    pending.attempts++;
    const given = hash(code.trim());
    if (!timingSafeEqual(given, pending.hash)) throw wrong;
    this.codes.delete(telegramId);
    const user = await this.staff(telegramId);
    if (!user) throw wrong;
    if (user.role !== Role.ADMIN) await this.prisma.user.update({ where: { id: user.id }, data: { role: Role.ADMIN } });
    const token = this.jwt.sign({ sub: user.id, role: Role.ADMIN }, { expiresIn: '12h' });
    return { token, staff: { id: user.id, name: user.firstName, username: user.username } };
  }
}
