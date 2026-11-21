import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PaymentMethod, Role } from '@prisma/client';
import type { Deposit, User, Withdrawal } from '@prisma/client';
import { Bot, InlineKeyboard, InputFile, Keyboard, type Context } from 'grammy';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, money } from '../common/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { NotifyService } from '../notify.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma.service';
import { PromoService } from '../promo/promo.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { COMMANDS, TEXTS, localPhone, menuActionFor, textsFor, type BotLang } from './texts';

const METHOD_LABEL: Record<PaymentMethod, string> = { TELEBIRR: 'Telebirr', CBE_BIRR: 'CBE Birr' };
/** How long the bot waits for the next step of a deposit or withdrawal before forgetting it. */
const FLOW_TTL_MS = 30 * 60_000;
/** Telegram allows about 30 messages a second to different chats; stay well below. */
const BROADCAST_GAP_MS = 45;

type Flow =
  | { kind: 'sms'; method: PaymentMethod; until: number }
  | { kind: 'promo'; until: number }
  | { kind: 'withdraw'; step: 'amount' | 'method' | 'account' | 'name' | 'confirm'; until: number; amount?: bigint; method?: PaymentMethod; account?: string; name?: string };

export interface BroadcastInput {
  text: string;
  photo?: Buffer;
  playButton: boolean;
  /** Only this Telegram id (a test send), or everyone. */
  onlyTo?: string;
}

export interface BroadcastStatus {
  id: number;
  total: number;
  sent: number;
  failed: number;
  done: boolean;
  startedAt: string;
  finishedAt: string | null;
  test: boolean;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Telegram bot. For players: language choice, registration by sharing the phone number (which unlocks the
 * game and the welcome gift), a menu keyboard, deposits by SMS and withdrawals step by step. For staff:
 * approve/reject buttons on every deposit and withdrawal, and broadcasts from the dashboard.
 * Disabled when BOT_TOKEN is empty.
 */
@Injectable()
export class BotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Bot');
  private bot?: Bot;
  private readonly flows = new Map<number, Flow>();
  private broadcastState: BroadcastStatus | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly wallet: WalletService,
    private readonly payments: PaymentsService,
    private readonly notify: NotifyService,
    private readonly promo: PromoService,
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
      // Commands and the "What can this bot do?" text, in English (default) and Amharic.
      await bot.api.setMyCommands(COMMANDS.en);
      await bot.api.setMyCommands(COMMANDS.am, { language_code: 'am' });
      await bot.api.setMyCommands(COMMANDS.om, { language_code: 'om' });
      await bot.api.setMyDescription(TEXTS.en.description);
      await bot.api.setMyDescription(TEXTS.am.description, { language_code: 'am' });
      await bot.api.setMyDescription(TEXTS.om.description, { language_code: 'om' });
      await bot.api.setMyShortDescription(TEXTS.en.shortDescription);
      await bot.api.setMyShortDescription(TEXTS.am.shortDescription, { language_code: 'am' });
      await bot.api.setMyShortDescription(TEXTS.om.shortDescription, { language_code: 'om' });
      // The button next to the message box opens the command list ("Menu"); the game opens from the
      // 🎮 menu keyboard button and the Play now buttons.
      await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } });
      if (this.config.bot.miniAppUrl.startsWith('https://')) {
        this.logger.log(`Play buttons open ${this.config.bot.miniAppUrl}`);
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

  // ─── Keyboards ────────────────────────────────────────────────────────────

  private playButton(lang: string) {
    const url = this.config.bot.miniAppUrl;
    return url.startsWith('https://') ? new InlineKeyboard().webApp(textsFor(lang).playNow, url) : undefined;
  }

  /** The keyboard that stays under the message box. */
  private mainMenu(lang: string) {
    const t = textsFor(lang);
    return new Keyboard()
      .text(t.btnPlay)
      .text(t.btnLanguage)
      .row()
      .text(t.btnDeposit)
      .text(t.btnWithdraw)
      .row()
      .text(t.btnBalance)
      .text(t.btnInvite)
      .row()
      .text(t.btnPromo)
      .text(t.btnRules)
      .resized()
      .persistent();
  }

  private phoneKeyboard(lang: string) {
    return new Keyboard().requestContact(textsFor(lang).sharePhoneButton).resized().oneTime();
  }

  private languageKeyboard() {
    return new InlineKeyboard().text('🇪🇹 አማርኛ', 'lang:am').row().text('🇪🇹 Afaan Oromoo', 'lang:om').row().text('🇬🇧 English', 'lang:en');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async userFor(ctx: Context, startParam?: string) {
    if (!ctx.from) throw new Error('No sender');
    return this.users.fromTelegram(ctx.from, startParam);
  }

  /** Asks for the phone number when the player has not registered yet. Returns true when they have. */
  private async requireRegistered(ctx: Context, user: User): Promise<boolean> {
    if (user.phone) return true;
    await ctx.reply(textsFor(user.language).needPhone, { reply_markup: this.phoneKeyboard(user.language) });
    return false;
  }

  private async showMenu(ctx: Context, user: User) {
    const t = textsFor(user.language);
    const b = await this.wallet.balances(user.id);
    await ctx.reply(t.welcomeBack(escape(user.firstName), b.main.birr, b.play.birr), { parse_mode: 'HTML', reply_markup: this.mainMenu(user.language) });
  }

  private flow(chatId: number): Flow | undefined {
    const f = this.flows.get(chatId);
    if (f && f.until < Date.now()) {
      this.flows.delete(chatId);
      return undefined;
    }
    return f;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  private register(bot: Bot) {
    bot.command('start', async (ctx) => {
      const { user, created } = await this.userFor(ctx, ctx.match || undefined);
      this.flows.delete(ctx.chat.id);
      if (created) {
        await ctx.reply(TEXTS.en.chooseLanguage, { reply_markup: this.languageKeyboard() });
        return;
      }
      if (!user.phone) {
        await ctx.reply(textsFor(user.language).sharePhone(escape(user.firstName)), { parse_mode: 'HTML', reply_markup: this.phoneKeyboard(user.language) });
        return;
      }
      await this.showMenu(ctx, user);
    });

    bot.command('language', (ctx) => ctx.reply(TEXTS.en.chooseLanguage, { reply_markup: this.languageKeyboard() }));

    bot.callbackQuery(/^lang:(am|en|om)$/, async (ctx) => {
      const lang = ctx.match[1] as BotLang;
      const { user } = await this.userFor(ctx);
      await this.users.setLanguage(user.id, lang);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(TEXTS[lang].languageSet).catch(() => undefined);
      const updated = { ...user, language: lang };
      if (!updated.phone) {
        await ctx.reply(TEXTS[lang].sharePhone(escape(user.firstName)), { parse_mode: 'HTML', reply_markup: this.phoneKeyboard(lang) });
      } else {
        await this.showMenu(ctx, updated);
      }
    });

    bot.on('message:contact', async (ctx) => {
      const { user } = await this.userFor(ctx);
      const t = textsFor(user.language);
      const contact = ctx.message.contact;
      // Only the player's own number counts, not a contact card of someone else.
      if (contact.user_id !== ctx.from.id) {
        await ctx.reply(t.notYourContact, { reply_markup: this.phoneKeyboard(user.language) });
        return;
      }
      const digits = contact.phone_number.replace(/\D/g, '');
      const gift = await this.users.registerPhone(user.id, `+${digits}`);
      await ctx.reply(t.registered + (gift > 0n ? `\n\n${t.welcomeGift(money(gift).birr)}` : ''), { parse_mode: 'HTML' });
      await this.showMenu(ctx, { ...user, phone: `+${digits}` });
    });

    bot.command('menu', async (ctx) => {
      const { user } = await this.userFor(ctx);
      if (await this.requireRegistered(ctx, user)) await ctx.reply(textsFor(user.language).menu, { reply_markup: this.mainMenu(user.language) });
    });

    bot.command('play', (ctx) => this.action(ctx, 'play'));
    bot.command('deposit', (ctx) => this.action(ctx, 'deposit'));
    bot.command('withdraw', (ctx) => this.action(ctx, 'withdraw'));
    bot.command('balance', (ctx) => this.action(ctx, 'balance'));
    bot.command('invite', (ctx) => this.action(ctx, 'invite'));
    bot.command(['instructions', 'rules', 'help'], (ctx) => this.action(ctx, 'rules'));
    bot.command('cancel', (ctx) => this.action(ctx, 'cancel'));
    bot.command('promo', async (ctx) => {
      const code = ctx.match?.trim();
      if (!code) return this.action(ctx, 'promo');
      const { user } = await this.userFor(ctx);
      if (await this.requireRegistered(ctx, user)) await this.redeemPromo(ctx, user, code);
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

    bot.callbackQuery(/^dep:(TELEBIRR|CBE_BIRR)$/, async (ctx) => {
      const { user } = await this.userFor(ctx);
      const t = textsFor(user.language);
      const method = ctx.match[1] as PaymentMethod;
      const acc = this.config.paymentAccounts[method];
      const { depositMin, firstDepositBonusPercent } = this.payments.options();
      this.flows.set(ctx.chat!.id, { kind: 'sms', method, until: Date.now() + FLOW_TTL_MS });
      await ctx.answerCallbackQuery();
      await ctx.reply(t.depositHow(METHOD_LABEL[method], escape(acc.account), escape(acc.name), depositMin.birr, firstDepositBonusPercent), {
        parse_mode: 'HTML',
        reply_markup: new Keyboard().text(t.btnCancel).resized().oneTime(),
      });
    });

    bot.callbackQuery(/^wm:(TELEBIRR|CBE_BIRR)$/, async (ctx) => {
      const { user } = await this.userFor(ctx);
      const f = this.flow(ctx.chat!.id);
      await ctx.answerCallbackQuery();
      if (f?.kind !== 'withdraw' || f.step !== 'method') return;
      const t = textsFor(user.language);
      f.method = ctx.match[1] as PaymentMethod;
      f.step = 'account';
      const mine = user.phone ? localPhone(user.phone) : null;
      const kb = new Keyboard();
      if (mine) kb.text(t.useMyNumber(mine)).row();
      kb.text(t.btnCancel).resized().oneTime();
      await ctx.reply(t.withdrawAccount, { reply_markup: kb });
    });

    bot.callbackQuery(/^wc:(yes|no)$/, async (ctx) => {
      const { user } = await this.userFor(ctx);
      const t = textsFor(user.language);
      const f = this.flow(ctx.chat!.id);
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      this.flows.delete(ctx.chat!.id);
      if (ctx.match[1] === 'no' || f?.kind !== 'withdraw' || f.step !== 'confirm') {
        await ctx.reply(t.cancelled, { reply_markup: this.mainMenu(user.language) });
        return;
      }
      try {
        await this.payments.requestWithdrawal(user.id, { method: f.method!, accountNumber: f.account!, accountName: f.name!, amountMinor: f.amount! });
        await ctx.reply(t.withdrawSent(money(f.amount!).birr), { parse_mode: 'HTML', reply_markup: this.mainMenu(user.language) });
      } catch (e) {
        await ctx.reply(e instanceof AppError ? `⚠️ ${e.message}` : t.error, { reply_markup: this.mainMenu(user.language) });
      }
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
      const text = ctx.message.text.trim();
      const action = menuActionFor(text);
      if (action) return this.action(ctx, action);

      const { user } = await this.userFor(ctx);
      const t = textsFor(user.language);
      const f = this.flow(ctx.chat.id);

      if (f?.kind === 'sms') {
        try {
          const d = await this.payments.submitDeposit(user.id, f.method, text);
          this.flows.delete(ctx.chat.id);
          await ctx.reply(t.depositReceived(money(d.amountMinor).birr, escape(d.txRef)), { parse_mode: 'HTML', reply_markup: this.mainMenu(user.language) });
        } catch (e) {
          await ctx.reply(e instanceof AppError ? `⚠️ ${e.message}` : t.error);
        }
        return;
      }

      if (f?.kind === 'promo') {
        this.flows.delete(ctx.chat.id);
        return this.redeemPromo(ctx, user, text);
      }

      if (f?.kind === 'withdraw') return this.withdrawStep(ctx, user, f, text);

      await ctx.reply(t.unknown, { reply_markup: user.phone ? this.mainMenu(user.language) : this.phoneKeyboard(user.language) });
    });
  }

  /** Menu buttons and their matching /commands. */
  private async action(ctx: Context, action: NonNullable<ReturnType<typeof menuActionFor>>) {
    const { user } = await this.userFor(ctx);
    const t = textsFor(user.language);
    const chatId = ctx.chat!.id;
    if (action === 'cancel') {
      this.flows.delete(chatId);
      await ctx.reply(t.cancelled, { reply_markup: user.phone ? this.mainMenu(user.language) : undefined });
      return;
    }
    if (action === 'language') {
      await ctx.reply(TEXTS.en.chooseLanguage, { reply_markup: this.languageKeyboard() });
      return;
    }
    if (action === 'rules') {
      await this.sendRulesPicture(ctx, t.rulesCaption);
      const rules = this.config.testMode ? `${t.rules}\n\n${t.testNotice}` : t.rules;
      await ctx.reply(rules, { parse_mode: 'HTML', reply_markup: this.playButton(user.language) });
      return;
    }
    if (!(await this.requireRegistered(ctx, user))) return;
    this.flows.delete(chatId);

    if (action === 'promo') {
      this.flows.set(chatId, { kind: 'promo', until: Date.now() + FLOW_TTL_MS });
      await ctx.reply(t.promoAsk, { reply_markup: new Keyboard().text(t.btnCancel).resized().oneTime() });
    } else if (action === 'play') {
      await ctx.reply(t.openGame, { reply_markup: this.playButton(user.language) });
    } else if (action === 'balance') {
      const b = await this.wallet.balancesMinor(user.id);
      await ctx.reply(
        t.balance({
          main: money(b.main).birr,
          play: money(b.play).birr,
          total: money(b.main + b.play).birr,
          withdrawable: money(b.main).birr,
          min: money(this.config.money.withdrawMinMinor).birr,
          hold: b.hold > 0n ? money(b.hold).birr : null,
        }),
        { parse_mode: 'HTML' },
      );
    } else if (action === 'invite') {
      const link = `https://t.me/${this.config.bot.username || ctx.me.username}?start=ref_${user.referralCode}`;
      const stats = await this.users.referralStats(user.id);
      const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t.shareText)}`;
      await ctx.reply(
        t.invite({
          reward: money(this.config.money.referralBonusMinor).birr,
          link,
          deposited: stats.deposited,
          waiting: stats.waiting,
          earned: money(stats.earnedMinor).birr,
          max: this.config.money.referralMaxFriends,
        }),
        {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().url(t.shareButton, share),
      });
    } else if (action === 'deposit') {
      const { methods, depositMin } = this.payments.options();
      if (!methods.length) return void (await ctx.reply(t.depositsOff));
      const kb = new InlineKeyboard();
      methods.forEach((m) => kb.text(m.label, `dep:${m.method}`).row());
      await ctx.reply(t.depositChoose(depositMin.birr), { parse_mode: 'HTML', reply_markup: kb });
    } else if (action === 'withdraw') {
      const b = await this.wallet.balancesMinor(user.id);
      const min = this.config.money.withdrawMinMinor;
      if (b.main < min) {
        await ctx.reply(t.withdrawNotEnough(money(b.main).birr, money(min).birr), { parse_mode: 'HTML' });
        return;
      }
      this.flows.set(chatId, { kind: 'withdraw', step: 'amount', until: Date.now() + FLOW_TTL_MS });
      await ctx.reply(t.withdrawAmount(money(b.main).birr, money(min).birr), {
        parse_mode: 'HTML',
        reply_markup: new Keyboard().text(t.btnCancel).resized().oneTime(),
      });
    }
  }

  private rulesPhotoId?: string;
  /** Sends the "4 ways to win" picture. Uploaded once; Telegram's copy is reused after that. */
  private async sendRulesPicture(ctx: Context, caption: string) {
    const file = join(__dirname, '..', '..', 'assets', 'rules-patterns.png');
    if (!this.rulesPhotoId && !existsSync(file)) return;
    try {
      const msg = await ctx.replyWithPhoto(this.rulesPhotoId ?? new InputFile(file), { caption });
      this.rulesPhotoId ??= msg.photo?.at(-1)?.file_id;
    } catch (e) {
      this.logger.warn(`Rules picture not sent: ${(e as Error).message}`);
    }
  }

  private async redeemPromo(ctx: Context, user: User, code: string) {
    const t = textsFor(user.language);
    try {
      const r = await this.promo.redeem(user.id, code);
      await ctx.reply(t.promoDone(money(r.amountMinor).birr, escape(r.code)), { parse_mode: 'HTML', reply_markup: this.mainMenu(user.language) });
    } catch (e) {
      const msg = e instanceof AppError ? (t.promoErrors[e.code] ?? e.message) : t.error;
      await ctx.reply(`⚠️ ${msg}`, { reply_markup: this.mainMenu(user.language) });
    }
  }

  private async withdrawStep(ctx: Context, user: User, f: Extract<Flow, { kind: 'withdraw' }>, text: string) {
    const t = textsFor(user.language);
    const cancelKb = new Keyboard().text(t.btnCancel).resized().oneTime();
    f.until = Date.now() + FLOW_TTL_MS;

    if (f.step === 'amount') {
      const b = await this.wallet.balancesMinor(user.id);
      const min = this.config.money.withdrawMinMinor;
      const birr = /^\d{1,7}$/.test(text.replace(/[,\s]/g, '')) ? BigInt(text.replace(/[,\s]/g, '')) * 100n : -1n;
      if (birr < min || birr > b.main) {
        await ctx.reply(t.withdrawBadAmount(money(b.main).birr, money(min).birr), { reply_markup: cancelKb });
        return;
      }
      f.amount = birr;
      f.step = 'method';
      const kb = new InlineKeyboard();
      (Object.keys(METHOD_LABEL) as PaymentMethod[]).forEach((m) => kb.text(METHOD_LABEL[m], `wm:${m}`));
      await ctx.reply(t.withdrawMethod, { reply_markup: kb });
      return;
    }
    if (f.step === 'account') {
      const mine = user.phone ? localPhone(user.phone) : null;
      const chosen = mine && text === t.useMyNumber(mine) ? mine : localPhone(text);
      if (!chosen) {
        await ctx.reply(t.withdrawBadAccount, { reply_markup: cancelKb });
        return;
      }
      f.account = chosen;
      f.step = 'name';
      await ctx.reply(t.withdrawName, { reply_markup: cancelKb });
      return;
    }
    if (f.step === 'name') {
      const name = text.replace(/\s+/g, ' ').slice(0, 80);
      if (name.length < 2) {
        await ctx.reply(t.withdrawName, { reply_markup: cancelKb });
        return;
      }
      f.name = name;
      f.step = 'confirm';
      await ctx.reply(t.withdrawConfirm(money(f.amount!).birr, METHOD_LABEL[f.method!], f.account!, escape(name)), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(t.confirm, 'wc:yes').text(t.btnCancel, 'wc:no'),
      });
    }
  }

  // ─── Broadcasts ───────────────────────────────────────────────────────────

  broadcastStatus(): BroadcastStatus | null {
    return this.broadcastState;
  }

  /**
   * Sends a message (optionally with a picture and a Play button) to every player, or to one id as a test.
   * Runs in the background at about 20 messages a second; progress is in broadcastStatus().
   */
  async broadcast(input: BroadcastInput): Promise<BroadcastStatus> {
    if (!this.bot) throw new AppError(503, 'BOT_OFF', 'The bot is off. Set BOT_TOKEN and restart the server.');
    if (this.broadcastState && !this.broadcastState.done && !input.onlyTo) {
      throw new AppError(409, 'BUSY', 'A message is still being sent. Wait for it to finish.');
    }
    const ids = input.onlyTo
      ? [input.onlyTo]
      : (await this.prisma.user.findMany({ where: { isBlocked: false }, select: { telegramId: true } })).map((u) => u.telegramId.toString());
    const status: BroadcastStatus = {
      id: Date.now(),
      total: ids.length,
      sent: 0,
      failed: 0,
      done: false,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      test: Boolean(input.onlyTo),
    };
    if (!input.onlyTo) this.broadcastState = status;
    const run = async () => {
      let photoId: string | undefined;
      for (const chatId of ids) {
        try {
          const playUrl = this.config.bot.miniAppUrl;
          const reply_markup = input.playButton && playUrl.startsWith('https://') ? new InlineKeyboard().webApp('🎮 Play now / አሁን ይጫወቱ', playUrl) : undefined;
          if (input.photo) {
            const msg = await this.bot!.api.sendPhoto(chatId, photoId ?? new InputFile(input.photo, 'promo.jpg'), { caption: input.text, reply_markup });
            photoId ??= msg.photo.at(-1)?.file_id; // upload once, then reuse Telegram's copy
          } else {
            await this.bot!.api.sendMessage(chatId, input.text, { reply_markup });
          }
          status.sent++;
        } catch (e) {
          status.failed++;
          this.sendFailed(chatId, e as Error);
        }
        await new Promise((r) => setTimeout(r, BROADCAST_GAP_MS));
      }
      status.done = true;
      status.finishedAt = new Date().toISOString();
      if (!status.test) this.logger.log(`Broadcast finished: ${status.sent} sent, ${status.failed} not delivered.`);
    };
    if (input.onlyTo) await run();
    else void run();
    return status;
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
      `Player: ${u?.firstName ?? '?'}${u?.username ? ' @' + u.username : ''}${u?.phone ? ` (${u.phone})` : ''}`,
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
      `Player: ${u?.firstName ?? '?'}${u?.username ? ' @' + u.username : ''}${u?.phone ? ` (${u.phone})` : ''}`,
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
    const t = textsFor(u.language);
    const text =
      d.status === 'APPROVED'
        ? t.depositApproved(money(d.amountMinor).birr, d.bonusMinor > 0n ? money(d.bonusMinor).birr : null)
        : t.depositRejected(escape(d.txRef), d.note ? escape(d.note) : null);
    await this.send(u.telegramId, text, { parse_mode: 'HTML', reply_markup: d.status === 'APPROVED' ? this.playButton(u.language) : undefined });
  }

  private async tellPlayerWithdrawal(w: Withdrawal) {
    const u = await this.prisma.user.findUnique({ where: { id: w.userId } });
    if (!u) return;
    const t = textsFor(u.language);
    const text =
      w.status === 'PAID'
        ? t.withdrawPaid(money(w.amountMinor).birr, escape(w.accountNumber))
        : t.withdrawRejected(money(w.amountMinor).birr, w.note ? escape(w.note) : null);
    await this.send(u.telegramId, text, { parse_mode: 'HTML' });
  }
}
