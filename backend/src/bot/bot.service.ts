import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PaymentMethod, Role } from '@prisma/client';
import type { Deposit, Withdrawal } from '@prisma/client';
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { AppError, money } from '../common/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { NotifyService } from '../notify.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';

const METHOD_LABEL: Record<PaymentMethod, string> = { TELEBIRR: 'Telebirr', CBE_BIRR: 'CBE Birr' };
const SMS_WAIT_MS = 30 * 60_000;

const RULES = [
  '🎱 <b>How to play / እንዴት ይጫወታሉ</b>',
  '',
  '1. Open the game and pick up to 4 card numbers before the countdown ends. Each card costs the room stake.',
  '2. Balls from 1 to 75 are called one by one. B = 1–15, I = 16–30, N = 31–45, G = 46–60, O = 61–75.',
  '3. Numbers on your cards are marked automatically. The ★ in the middle is free.',
  '4. The first card to complete a full row, column or diagonal wins the prize. Cards that finish on the same ball share it.',
  '',
  'The prize is the total of all cards minus the house share. Every round can be checked: the ball order is fixed before any card is sold.',
].join('\n');

/**
 * Telegram bot: entry point for players (/start, the Play button, deposits by SMS) and a simple back office
 * for staff (approve/reject buttons on every deposit and withdrawal). Disabled when BOT_TOKEN is empty.
 */
@Injectable()
export class BotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Bot');
  private bot?: Bot;
  /** chatId -> payment method the player is sending an SMS for. */
  private readonly awaitingSms = new Map<number, { method: PaymentMethod; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly wallet: WalletService,
    private readonly payments: PaymentsService,
    private readonly notify: NotifyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.bot.token || this.config.env === 'test') {
      this.logger.warn('BOT_TOKEN is empty: the Telegram bot is OFF. Set it in backend/.env and restart.');
      return;
    }
    const bot = new Bot(this.config.bot.token);
    this.bot = bot;
    this.register(bot);
    this.notify.on('depositSubmitted', (d) => void this.tellStaffDeposit(d));
    this.notify.on('depositReviewed', (d) => void this.tellPlayerDeposit(d));
    this.notify.on('withdrawalRequested', (w) => void this.tellStaffWithdrawal(w));
    this.notify.on('withdrawalReviewed', (w) => void this.tellPlayerWithdrawal(w));

    bot.catch((e) => this.logger.error(`Update failed: ${e.message}`));
    // Never blocks or crashes the game server: if Telegram is unreachable or the token is wrong, it logs
    // the reason and tries again.
    this.logger.log('Connecting the bot to Telegram…');
    void this.connect(bot);
  }

  private async connect(bot: Bot, attempt = 1): Promise<void> {
    try {
      await bot.api.setMyCommands([
        { command: 'play', description: 'Play bingo / ቢንጎ ይጫወቱ' },
        { command: 'deposit', description: 'Add money / ገንዘብ ያስገቡ' },
        { command: 'balance', description: 'My balance / ቀሪ ሂሳብ' },
        { command: 'withdraw', description: 'Withdraw / ገንዘብ ያውጡ' },
        { command: 'invite', description: 'Invite friends / ጓደኛ ይጋብዙ' },
        { command: 'rules', description: 'How to play / ህጎች' },
      ]);
      if (this.config.bot.miniAppUrl.startsWith('https://')) {
        await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Play', web_app: { url: this.config.bot.miniAppUrl } } });
      } else {
        this.logger.warn('MINIAPP_URL is not an https address: the Play button is hidden until it is set.');
      }
      // Long polling: no public URL needed. Not awaited: it runs until the app stops.
      void bot
        .start({ drop_pending_updates: false, onStart: (me) => this.logger.log(`Bot @${me.username} is running`) })
        .catch((e: Error) => {
          this.logger.error(`Bot stopped: ${e.message}. Restarting in 30 s.`);
          setTimeout(() => void this.connect(bot, 1), 30_000);
        });
    } catch (e) {
      const wait = Math.min(300, 15 * attempt);
      this.logger.error(`Cannot reach Telegram (${(e as Error).message}). Check BOT_TOKEN. Retrying in ${wait} s.`);
      setTimeout(() => void this.connect(bot, attempt + 1), wait * 1000);
    }
  }

  async onModuleDestroy() {
    await this.bot?.stop();
  }

  private playKeyboard(label = '🎮 Play now / አሁን ይጫወቱ') {
    const url = this.config.bot.miniAppUrl;
    return url.startsWith('https://') ? new InlineKeyboard().webApp(label, url) : undefined;
  }

  private async userFor(ctx: Context, startParam?: string) {
    if (!ctx.from) throw new Error('No sender');
    return (await this.users.fromTelegram(ctx.from, startParam)).user;
  }

  private register(bot: Bot) {
    bot.command('start', async (ctx) => {
      const user = await this.userFor(ctx, ctx.match || undefined);
      const b = await this.wallet.balances(user.id);
      await ctx.reply(
        [
          `👋 Welcome, <b>${escape(user.firstName)}</b>! / እንኳን ደህና መጡ!`,
          '',
          `Wallet: <b>${b.main.birr} birr</b> · Bonus: <b>${b.play.birr} birr</b>`,
          '',
          'Tap <b>Play now</b> to join the next round. Use /deposit to add money and /rules to learn the game.',
        ].join('\n'),
        { parse_mode: 'HTML', reply_markup: this.playKeyboard() },
      );
    });

    bot.command('play', async (ctx) => {
      await this.userFor(ctx);
      await ctx.reply('Open the game to play bingo: / ቢንጎ ለመጫወት ይክፈቱ፦', { reply_markup: this.playKeyboard() });
    });

    // Shows the sender's Telegram id: put it in ADMIN_TELEGRAM_IDS to become staff.
    bot.command('myid', (ctx) =>
      ctx.reply(`Your Telegram id: <code>${ctx.from?.id ?? '?'}</code>\nStaff: put it in ADMIN_TELEGRAM_IDS in backend/.env and restart the server.`, {
        parse_mode: 'HTML',
      }),
    );

    bot.command('admin', async (ctx) => {
      const staff = await this.prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from!.id) } });
      const isStaff = staff?.role === Role.ADMIN || this.config.adminTelegramIds.has(String(ctx.from!.id));
      if (!isStaff) return ctx.reply('Use /play to open the game.');
      const url = this.config.adminUrl;
      await ctx.reply(
        url
          ? `🛠 Staff dashboard:\n${url}\n\nSign in with your Telegram id <code>${ctx.from!.id}</code>; the code arrives here.`
          : 'Set MINIAPP_URL so the dashboard address is known.',
        { parse_mode: 'HTML' },
      );
    });

    bot.command(['rules', 'help', 'instructions'], (ctx) => ctx.reply(RULES, { parse_mode: 'HTML', reply_markup: this.playKeyboard() }));

    bot.command('balance', async (ctx) => {
      const user = await this.userFor(ctx);
      const b = await this.wallet.balances(user.id);
      await ctx.reply(
        `💰 Main wallet: <b>${b.main.birr} birr</b>\n🎁 Play (bonus) wallet: <b>${b.play.birr} birr</b>` +
          (b.pendingWithdrawal.minor !== '0' ? `\n⏳ Withdrawal being paid: <b>${b.pendingWithdrawal.birr} birr</b>` : ''),
        { parse_mode: 'HTML' },
      );
    });

    bot.command('invite', async (ctx) => {
      const user = await this.userFor(ctx);
      const link = `https://t.me/${this.config.bot.username || ctx.me.username}?start=ref_${user.referralCode}`;
      const reward = money(this.config.money.referralBonusMinor).birr;
      await ctx.reply(`Invite friends and get <b>${reward} birr</b> bonus when each one makes a first deposit.\n\nYour link:\n${link}`, {
        parse_mode: 'HTML',
      });
    });

    bot.command('withdraw', (ctx) =>
      ctx.reply('Open the game, go to <b>Wallet</b> and tap <b>Withdraw</b>. Winnings are sent to your Telebirr or CBE Birr.', {
        parse_mode: 'HTML',
        reply_markup: this.playKeyboard('💰 Open wallet'),
      }),
    );

    bot.command('deposit', async (ctx) => {
      await this.userFor(ctx);
      const { methods, depositMin } = this.payments.options();
      if (!methods.length) return ctx.reply('Deposits are not open yet. Please try again later.');
      const kb = new InlineKeyboard();
      methods.forEach((m) => kb.text(m.label, `dep:${m.method}`).row());
      await ctx.reply(`Choose how you will pay (minimum ${depositMin.birr} birr): / የክፍያ መንገድ ይምረጡ፦`, { reply_markup: kb });
    });

    bot.callbackQuery(/^dep:(TELEBIRR|CBE_BIRR)$/, async (ctx) => {
      const method = ctx.match[1] as PaymentMethod;
      const acc = this.config.paymentAccounts[method];
      const { depositMin, firstDepositBonusPercent } = this.payments.options();
      this.awaitingSms.set(ctx.chat!.id, { method, until: Date.now() + SMS_WAIT_MS });
      await ctx.answerCallbackQuery();
      await ctx.reply(
        [
          `📱 <b>${METHOD_LABEL[method]} deposit</b>`,
          '',
          `Account: <code>${escape(acc.account)}</code>`,
          `Name: <b>${escape(acc.name)}</b>`,
          `Minimum: ${depositMin.birr} birr`,
          firstDepositBonusPercent ? `🎁 First deposit bonus: ${firstDepositBonusPercent}%` : '',
          '',
          '1. Send money to the account above.',
          '2. You will receive a confirmation SMS.',
          '3. Copy the <b>whole SMS</b> and paste it here.',
          '',
          '1. ገንዘቡን ወደ ላይኛው አካውንት ይላኩ።',
          '2. የማረጋገጫ መልዕክት (SMS) ይደርስዎታል።',
          '3. ሙሉውን መልዕክት ኮፒ አድርገው እዚህ ይለጥፉ።',
        ]
          .filter((l) => l !== null)
          .join('\n'),
        { parse_mode: 'HTML' },
      );
    });

    bot.callbackQuery(/^(dok|dno|wok|wno):([0-9a-f-]{36})$/, async (ctx) => {
      const staff = await this.prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
      if (staff?.role !== Role.ADMIN) return ctx.answerCallbackQuery({ text: 'Staff only.' });
      const [, action, id] = ctx.match;
      try {
        let summary = '';
        if (action === 'dok') {
          const d = await this.payments.approveDeposit(id, staff.id);
          summary = `✅ Approved: ${money(d.amountMinor).birr} birr`;
        }
        if (action === 'dno') {
          await this.payments.rejectDeposit(id, staff.id, 'Payment not found');
          summary = '❌ Rejected';
        }
        if (action === 'wok') {
          await this.payments.reviewWithdrawal(id, staff.id, true);
          summary = '✅ Marked as paid';
        }
        if (action === 'wno') {
          await this.payments.reviewWithdrawal(id, staff.id, false, 'Rejected by staff');
          summary = '↩️ Rejected, money returned to the player';
        }
        await ctx.answerCallbackQuery({ text: 'Done' });
        await ctx.editMessageText(`${ctx.callbackQuery.message?.text ?? ''}\n\n${summary} by ${staff.firstName}`);
      } catch (e) {
        await ctx.answerCallbackQuery({ text: e instanceof AppError ? e.message : 'Failed. Try again.', show_alert: true });
      }
    });

    bot.on('message:text', async (ctx) => {
      const waiting = this.awaitingSms.get(ctx.chat.id);
      if (!waiting || waiting.until < Date.now()) {
        this.awaitingSms.delete(ctx.chat.id);
        return ctx.reply('Use /play to open the game or /deposit to add money.', { reply_markup: this.playKeyboard() });
      }
      const user = await this.userFor(ctx);
      try {
        const d = await this.payments.submitDeposit(user.id, waiting.method, ctx.message.text);
        this.awaitingSms.delete(ctx.chat.id);
        await ctx.reply(
          `✅ Received. Deposit of <b>${money(d.amountMinor).birr} birr</b> (ref ${escape(d.txRef)}) is being checked. You will get a message when it is added to your wallet.\n\nደርሶናል፤ እየተረጋገጠ ነው።`,
          { parse_mode: 'HTML' },
        );
      } catch (e) {
        await ctx.reply(e instanceof AppError ? `⚠️ ${e.message}` : '⚠️ Something went wrong. Please try again.');
      }
    });
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  private async staffChatIds(): Promise<string[]> {
    const admins = await this.prisma.user.findMany({ where: { role: Role.ADMIN }, select: { telegramId: true } });
    return [...new Set([...admins.map((a) => a.telegramId.toString()), ...this.config.adminTelegramIds])];
  }

  private async send(chatId: string | bigint, text: string, extra: Parameters<Bot['api']['sendMessage']>[2] = {}) {
    try {
      await this.bot?.api.sendMessage(chatId.toString(), text, extra);
    } catch (e) {
      this.sendFailed(chatId.toString(), e as Error);
    }
  }

  private readonly unreachable = new Set<string>();
  /**
   * A bot can only message people who have pressed Start in it. Test accounts (staff id 1, sample players
   * 900001…) are not real Telegram users, so this always fails for them; say so once per account.
   */
  private sendFailed(chatId: string, e: Error) {
    if (/chat not found|bot was blocked|user is deactivated/i.test(e.message)) {
      if (this.unreachable.has(chatId)) return;
      this.unreachable.add(chatId);
      this.logger.log(
        `Cannot message Telegram id ${chatId}: that account has not opened the bot (or blocked it). Normal for test accounts; not repeated.`,
      );
      return;
    }
    this.logger.warn(`Message to ${chatId} failed: ${e.message}`);
  }

  /** Sends an HTML message to one person. False when the bot is off or Telegram refused it. */
  async dm(chatId: string, html: string): Promise<boolean> {
    if (!this.bot) return false;
    try {
      await this.bot.api.sendMessage(chatId, html, { parse_mode: 'HTML' });
      return true;
    } catch (e) {
      this.sendFailed(chatId, e as Error);
      return false;
    }
  }

  private async tellStaffDeposit(d: Deposit) {
    const u = await this.prisma.user.findUnique({ where: { id: d.userId } });
    const text = [
      `💵 New deposit — ${METHOD_LABEL[d.method]}`,
      `Player: ${u?.firstName ?? '?'}${u?.username ? ' @' + u.username : ''}`,
      `Amount: ${money(d.amountMinor).birr} birr`,
      `Ref: ${d.txRef}`,
      '',
      'Check the money arrived in the account before approving.',
      '',
      d.smsText.slice(0, 600),
    ].join('\n');
    const kb = new InlineKeyboard().text('✅ Approve', `dok:${d.id}`).text('❌ Reject', `dno:${d.id}`);
    for (const id of await this.staffChatIds()) await this.send(id, text, { reply_markup: kb });
  }

  private async tellStaffWithdrawal(w: Withdrawal) {
    const u = await this.prisma.user.findUnique({ where: { id: w.userId } });
    const text = [
      `🏧 Withdrawal request — ${METHOD_LABEL[w.method]}`,
      `Player: ${u?.firstName ?? '?'}${u?.username ? ' @' + u.username : ''}`,
      `Amount: ${money(w.amountMinor).birr} birr`,
      `To: ${w.accountNumber} (${w.accountName})`,
      '',
      'Send the money first, then tap "Paid".',
    ].join('\n');
    const kb = new InlineKeyboard().text('✅ Paid', `wok:${w.id}`).text('↩️ Reject', `wno:${w.id}`);
    for (const id of await this.staffChatIds()) await this.send(id, text, { reply_markup: kb });
  }

  private async tellPlayerDeposit(d: Deposit) {
    const u = await this.prisma.user.findUnique({ where: { id: d.userId } });
    if (!u) return;
    const text =
      d.status === 'APPROVED'
        ? `✅ Deposit approved: <b>+${money(d.amountMinor).birr} birr</b>` +
          (d.bonusMinor > 0n ? `\n🎁 First-deposit bonus: <b>+${money(d.bonusMinor).birr} birr</b> (play wallet)` : '') +
          '\n\nGood luck! / መልካም ዕድል!'
        : `❌ Your deposit (ref ${escape(d.txRef)}) was not approved${d.note ? `: ${escape(d.note)}` : ''}. Contact support if you sent the money.`;
    await this.send(u.telegramId, text, { parse_mode: 'HTML', reply_markup: d.status === 'APPROVED' ? this.playKeyboard() : undefined });
  }

  private async tellPlayerWithdrawal(w: Withdrawal) {
    const u = await this.prisma.user.findUnique({ where: { id: w.userId } });
    if (!u) return;
    const text =
      w.status === 'PAID'
        ? `✅ ${money(w.amountMinor).birr} birr has been sent to ${escape(w.accountNumber)}.`
        : `↩️ Your withdrawal of ${money(w.amountMinor).birr} birr was not paid${w.note ? ` (${escape(w.note)})` : ''}. The money is back in your wallet.`;
    await this.send(u.telegramId, text, { parse_mode: 'HTML' });
  }
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
