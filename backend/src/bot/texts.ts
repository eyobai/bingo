/**
 * Everything the bot says, in Amharic, Afaan Oromoo and English. The player picks the language on first
 * /start (or with /language); staff messages stay in English.
 *
 * The Afaan Oromoo texts should be checked by a native speaker before launch.
 */
export type BotLang = 'am' | 'en' | 'om';

export interface BalanceInfo {
  main: string;
  play: string;
  total: string;
  withdrawable: string;
  min: string;
  /** Amount waiting to be paid out, or null when nothing is pending. */
  hold: string | null;
}

export interface InviteInfo {
  reward: string;
  link: string;
  /** Friends who registered and made a first deposit (rewarded). */
  deposited: number;
  /** Friends who joined but have not deposited yet. */
  waiting: number;
  earned: string;
  /** Most friends that earn a reward; 0 = no limit. */
  max: number;
}

const LINE = '━━━━━━━━━━━━━━';
const LANGS = 'Choose your language · ቋንቋ ይምረጡ · Afaan filadhu';

const en = {
  description:
    'Live bingo in Telegram. Pick your cards, watch the balls being called and complete a line to win the prize. Press Start to register.',
  shortDescription: 'Live bingo: pick cards, complete a line, win the prize.',
  chooseLanguage: LANGS,
  languageSet: '✅ Language set: English',
  sharePhone: (name: string) =>
    `👋 Welcome, <b>${name}</b>!\n\nTo register, share your phone number with the button below. It is used for your account and your payments.`,
  sharePhoneButton: '📱 Share my phone number',
  notYourContact: 'Please use the button below to share your own number.',
  registered: '✅ You are registered!',
  welcomeGift: (birr: string) => `🎁 Welcome gift: <b>${birr} birr</b> added to your play wallet.`,
  welcomeBack: (name: string, main: string, play: string) =>
    `👋 Welcome, <b>${name}</b>!\n\n💰 Main wallet: <b>${main} birr</b>\n🎁 Play wallet: <b>${play} birr</b>\n\nTap <b>🎮 Play</b> to join the next round.`,
  needPhone: 'Register first: share your phone number with the button below.',
  menu: 'Main menu 👇',
  btnPlay: '🎮 Play bingo',
  btnDeposit: '💰 Deposit',
  btnWithdraw: '💸 Withdraw',
  btnBalance: '📊 Balance',
  btnInvite: '👥 Invite friends',
  btnLanguage: '🌐 Language',
  btnRules: '📖 How to play',
  btnCancel: '✖️ Cancel',
  btnPromo: '🎁 Promo code',
  promoAsk: '🎁 Type your promo code:',
  promoDone: (amount: string, code: string) => `🎉 Promo code <b>${code}</b> accepted: <b>+${amount} birr</b> added to your play wallet.`,
  promoErrors: {
    PROMO_NOT_FOUND: 'That promo code does not exist. Check the spelling and try again.',
    PROMO_OFF: 'This promo code is no longer active.',
    PROMO_EXPIRED: 'This promo code has expired.',
    PROMO_USED_UP: 'This promo code has been used by the maximum number of players.',
    PROMO_ALREADY_USED: 'You have already used this promo code.',
    PROMO_NEEDS_DEPOSIT: 'This promo code is for players who have made a deposit. Deposit first, then try again.',
  } as Record<string, string>,
  openGame: 'Open the game and pick your cards before the countdown ends:',
  playNow: '🎮 Play now',
  balance: (b: BalanceInfo) =>
    [
      '💰 <b>BALANCE</b>',
      LINE,
      `🏦 Main wallet: <b>${b.main} birr</b>`,
      `🎁 Bonus wallet: <b>${b.play} birr</b>`,
      `💵 Total: <b>${b.total} birr</b>`,
      LINE,
      `💸 Withdrawable: <b>${b.withdrawable} birr</b>`,
      `ℹ️ Minimum withdrawal: ${b.min} birr`,
      b.hold ? `⏳ Being paid out: <b>${b.hold} birr</b>` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  invite: (i: InviteInfo) =>
    [
      '👥 <b>Invite friends</b>',
      '',
      `Get <b>${i.reward} birr</b> in your bonus wallet for each friend who registers and makes a first deposit.`,
      '',
      `✅ Friends who deposited: <b>${i.deposited}</b>`,
      `⏳ Waiting for first deposit: <b>${i.waiting}</b>`,
      `🎁 Total earned: <b>${i.earned} birr</b>`,
      '',
      '🔗 Your invite link:',
      `<code>${i.link}</code>`,
      i.max ? `\n📊 Progress: <b>${Math.min(i.deposited, i.max)} / ${i.max}</b> friends` : '',
      i.max && i.deposited >= i.max ? 'You reached the limit: friends can still join, but no more rewards.' : '',
    ]
      .filter((l) => l !== '')
      .join('\n'),
  shareText: 'Play live bingo with me on Telegram!',
  shareButton: '📤 Share link',
  rulesCaption: '🏆 4 ways to win: complete any one line.',
  rules: [
    '🃏 <b>Cards (cartelas)</b>',
    "Before a round starts you can pick up to 4 cards from the numbered board. Cards other players took are shown in purple and can't be picked. Tap a number and that card's 25 numbers appear below. Each card costs the room's price; tap it again before the countdown ends to give it back.",
    '',
    '🎮 <b>How a round works</b>',
    'When the countdown reaches zero the round starts and your cards appear on the game screen. Balls from 1 to 75 are called at random, one every few seconds: B 1–15, I 16–30, N 31–45, G 46–60, O 61–75.',
    '',
    '✍️ <b>Marking</b>',
    'Auto: called numbers on your cards are marked for you.',
    'Manual: you tap them yourself.',
    'Either way the game checks every card after each ball, so you never miss a win.',
    '',
    '🏆 <b>Ways to win</b>',
    'Complete one full line:',
    '• Row (across)',
    '• Column (down)',
    '• Diagonal ↘',
    '• Diagonal ↙',
    'The ★ in the middle is free.',
    '',
    '💰 <b>The prize</b>',
    'All cards sold, minus the house share. Cards that complete a line on the same ball share it equally. A round with fewer than 2 players is cancelled and refunded.',
  ].join('\n'),
  depositsOff: 'Deposits are not open yet. Please try again later.',
  depositChoose: (min: string) => `💰 <b>Deposit</b>\n\nChoose how you will pay (minimum ${min} birr):`,
  depositHow: (method: string, account: string, name: string, min: string, bonus: number) =>
    [
      `📱 <b>${method} deposit</b>`,
      '',
      `Account: <code>${account}</code>`,
      `Name: <b>${name}</b>`,
      `Minimum: ${min} birr`,
      bonus ? `🎁 First deposit bonus: ${bonus}%` : '',
      '',
      '1. Send money to the account above.',
      '2. You will receive a confirmation SMS.',
      '3. Copy the <b>whole SMS</b> and paste it here.',
    ]
      .filter(Boolean)
      .join('\n'),
  depositReceived: (amount: string, ref: string) =>
    `✅ Received. Your deposit of <b>${amount} birr</b> (ref ${ref}) is being checked. You will get a message when it is added.`,
  depositApproved: (amount: string, bonus: string | null) =>
    `✅ Deposit approved: <b>+${amount} birr</b>` + (bonus ? `\n🎁 First-deposit bonus: <b>+${bonus} birr</b> (play wallet)` : '') + '\n\nGood luck!',
  depositRejected: (ref: string, note: string | null) =>
    `❌ Your deposit (ref ${ref}) was not approved${note ? `: ${note}` : ''}. Contact support if you sent the money.`,
  withdrawNotEnough: (withdrawable: string, min: string) =>
    `⚠️ <b>Not enough to withdraw</b>\n${LINE}\nMinimum withdrawal: <b>${min} birr</b>\nYour withdrawable balance: <b>${withdrawable} birr</b>\n\nBonus money can't be withdrawn, but what you win with it can.`,
  withdrawAmount: (main: string, min: string) => `💸 <b>Withdraw</b>\n\nYou can withdraw up to <b>${main} birr</b>.\nType the amount (minimum ${min}):`,
  withdrawBadAmount: (main: string, min: string) => `Type a whole number between ${min} and ${main}.`,
  withdrawMethod: 'Where should we send it?',
  withdrawAccount: 'Type the phone number to send it to, or use your registered number:',
  useMyNumber: (phone: string) => `📱 Use ${phone}`,
  withdrawBadAccount: 'That does not look like a phone number. Type it like 0911223344.',
  withdrawName: 'Type the full name on that account:',
  withdrawConfirm: (amount: string, method: string, account: string, name: string) =>
    `Please check:\n\nAmount: <b>${amount} birr</b>\nTo: <b>${method} ${account}</b>\nName: <b>${name}</b>`,
  confirm: '✅ Confirm',
  withdrawSent: (amount: string) =>
    `✅ Withdrawal of <b>${amount} birr</b> requested. The money has left your wallet and will be sent to you shortly. You will get a message when it is paid.`,
  withdrawPaid: (amount: string, account: string) => `✅ <b>${amount} birr</b> has been sent to ${account}.`,
  withdrawRejected: (amount: string, note: string | null) =>
    `↩️ Your withdrawal of ${amount} birr was not paid${note ? ` (${note})` : ''}. The money is back in your wallet.`,
  cancelled: 'Cancelled.',
  unknown: 'Use the menu below 👇',
  error: '⚠️ Something went wrong. Please try again.',
};

type Texts = typeof en;

const am: Texts = {
  description: 'በቴሌግራም ቀጥታ ቢንጎ። ካርቴላ ይምረጡ፣ የሚጠሩትን ኳሶች ይከታተሉ፣ መስመር ሞልተው ሽልማቱን ያሸንፉ። ለመመዝገብ Start ይጫኑ።',
  shortDescription: 'ቀጥታ ቢንጎ፦ ካርቴላ ይምረጡ፣ መስመር ይሙሉ፣ ያሸንፉ።',
  chooseLanguage: LANGS,
  languageSet: '✅ ቋንቋ፦ አማርኛ',
  sharePhone: (name) => `👋 እንኳን ደህና መጡ፣ <b>${name}</b>!\n\nለመመዝገብ ከታች ያለውን ቁልፍ ተጭነው ስልክ ቁጥርዎን ያጋሩ። ለአካውንትዎና ለክፍያዎችዎ ይጠቅማል።`,
  sharePhoneButton: '📱 ስልክ ቁጥሬን አጋራ',
  notYourContact: 'እባክዎ የራስዎን ቁጥር ለማጋራት ከታች ያለውን ቁልፍ ይጠቀሙ።',
  registered: '✅ ተመዝግበዋል!',
  welcomeGift: (birr) => `🎁 የእንኳን ደህና መጡ ስጦታ፦ <b>${birr} ብር</b> ወደ መጫወቻ ሂሳብዎ ገብቷል።`,
  welcomeBack: (name, main, play) =>
    `👋 እንኳን ደህና መጡ፣ <b>${name}</b>!\n\n💰 ዋና ሂሳብ፦ <b>${main} ብር</b>\n🎁 መጫወቻ ሂሳብ፦ <b>${play} ብር</b>\n\nበሚቀጥለው ዙር ለመሳተፍ <b>🎮 ቢንጎ ተጫወት</b> ይጫኑ።`,
  needPhone: 'መጀመሪያ ይመዝገቡ፦ ከታች ያለውን ቁልፍ ተጭነው ስልክ ቁጥርዎን ያጋሩ።',
  menu: 'ዋና ማውጫ 👇',
  btnPlay: '🎮 ቢንጎ ተጫወት',
  btnDeposit: '💰 ገንዘብ አስገባ',
  btnWithdraw: '💸 ገንዘብ አውጣ',
  btnBalance: '📊 ቀሪ ሂሳብ',
  btnInvite: '👥 ጓደኛ ጋብዝ',
  btnLanguage: '🌐 ቋንቋ',
  btnRules: '📖 መመሪያ',
  btnCancel: '✖️ ሰርዝ',
  btnPromo: '🎁 ፕሮሞ ኮድ',
  promoAsk: '🎁 የፕሮሞ ኮድዎን ይጻፉ፦',
  promoDone: (amount, code) => `🎉 ፕሮሞ ኮድ <b>${code}</b> ተቀባይነት አግኝቷል፦ <b>+${amount} ብር</b> ወደ መጫወቻ ሂሳብዎ ገብቷል።`,
  promoErrors: {
    PROMO_NOT_FOUND: 'ይህ ፕሮሞ ኮድ የለም። አጻጻፉን አረጋግጠው እንደገና ይሞክሩ።',
    PROMO_OFF: 'ይህ ፕሮሞ ኮድ ከአሁን በኋላ አይሰራም።',
    PROMO_EXPIRED: 'የዚህ ፕሮሞ ኮድ ጊዜ አልፏል።',
    PROMO_USED_UP: 'ይህ ፕሮሞ ኮድ በተፈቀደው የተጫዋቾች ብዛት ተጠቅሟል።',
    PROMO_ALREADY_USED: 'ይህን ፕሮሞ ኮድ አስቀድመው ተጠቅመውበታል።',
    PROMO_NEEDS_DEPOSIT: 'ይህ ፕሮሞ ኮድ ገንዘብ ላስገቡ ተጫዋቾች ነው። መጀመሪያ ገንዘብ አስገብተው እንደገና ይሞክሩ።',
  },
  openGame: 'ጨዋታውን ከፍተው ሰዓቱ ሳያልቅ ካርቴላ ይምረጡ፦',
  playNow: '🎮 አሁን ይጫወቱ',
  balance: (b) =>
    [
      '💰 <b>ቀሪ ሂሳብ</b>',
      LINE,
      `🏦 ዋና ሂሳብ፦ <b>${b.main} ብር</b>`,
      `🎁 የቦነስ ሂሳብ፦ <b>${b.play} ብር</b>`,
      `💵 ጠቅላላ፦ <b>${b.total} ብር</b>`,
      LINE,
      `💸 ሊወጣ የሚችል፦ <b>${b.withdrawable} ብር</b>`,
      `ℹ️ ዝቅተኛ ማውጫ፦ ${b.min} ብር`,
      b.hold ? `⏳ በመክፈል ላይ፦ <b>${b.hold} ብር</b>` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  invite: (i) =>
    [
      '👥 <b>ጓደኛ ይጋብዙ</b>',
      '',
      `የጋበዙት ጓደኛ ተመዝግቦ መጀመሪያ ገንዘብ ሲያስገባ <b>${i.reward} ብር</b> ወደ ቦነስ ሂሳብዎ ያገኛሉ።`,
      '',
      `✅ ገንዘብ ያስገቡ ጓደኞች፦ <b>${i.deposited}</b>`,
      `⏳ የመጀመሪያ ማስገቢያ የሚጠብቁ፦ <b>${i.waiting}</b>`,
      `🎁 ጠቅላላ ያገኙት፦ <b>${i.earned} ብር</b>`,
      '',
      '🔗 የመጋበዣ ሊንክዎ፦',
      `<code>${i.link}</code>`,
      i.max ? `\n📊 ሂደት፦ <b>${Math.min(i.deposited, i.max)} / ${i.max}</b> ጓደኞች` : '',
      i.max && i.deposited >= i.max ? 'ገደቡ ላይ ደርሰዋል፤ ጓደኞች መቀላቀል ይችላሉ ግን ተጨማሪ ሽልማት የለም።' : '',
    ]
      .filter((l) => l !== '')
      .join('\n'),
  shareText: 'በቴሌግራም ቀጥታ ቢንጎ አብረን እንጫወት!',
  shareButton: '📤 ሊንክ አጋራ',
  rulesCaption: '🏆 4 የማሸነፊያ መንገዶች፦ ማንኛውንም አንድ መስመር ይሙሉ።',
  rules: [
    '🃏 <b>ካርቴላዎች</b>',
    'ዙሩ ከመጀመሩ በፊት ከቁጥር ሰሌዳው እስከ 4 ካርቴላ መምረጥ ይችላሉ። ሌሎች ተጫዋቾች የወሰዷቸው ካርቴላዎች በሐምራዊ ቀለም ይታያሉ፤ እነሱን መምረጥ አይቻልም። ቁጥር ሲጫኑ የካርቴላው 25 ቁጥሮች ከታች ይታያሉ። እያንዳንዱ ካርቴላ የክፍሉን ዋጋ ያስከፍላል፤ ሰዓቱ ሳያልቅ እንደገና በመጫን መመለስ ይችላሉ።',
    '',
    '🎮 <b>ዙሩ እንዴት ይካሄዳል</b>',
    'ቆጠራው ዜሮ ሲደርስ ዙሩ ይጀምራል፣ ካርቴላዎችዎም በጨዋታው ገጽ ላይ ይታያሉ። ከ1 እስከ 75 ያሉ ኳሶች በዘፈቀደ በየጥቂት ሰከንዱ አንድ በአንድ ይጠራሉ፦ B 1–15፣ I 16–30፣ N 31–45፣ G 46–60፣ O 61–75።',
    '',
    '✍️ <b>ምልክት ማድረግ</b>',
    'አውቶ፦ የተጠሩ ቁጥሮች በካርቴላዎ ላይ በራሳቸው ይመረጣሉ።',
    'በእጅ፦ እርስዎ ራስዎ ይጫኗቸዋል።',
    'በየትኛውም መንገድ ጨዋታው ከእያንዳንዱ ኳስ በኋላ ሁሉንም ካርቴላዎች ይፈትሻል፤ ማሸነፍዎ አያመልጥዎትም።',
    '',
    '🏆 <b>የማሸነፊያ መንገዶች</b>',
    'አንድ ሙሉ መስመር ይሙሉ፦',
    '• ረድፍ (ወደ ጎን)',
    '• አምድ (ወደ ታች)',
    '• ሰያፍ ↘',
    '• ሰያፍ ↙',
    'መሃል ያለው ★ ነፃ ነው።',
    '',
    '💰 <b>ሽልማቱ</b>',
    'የተሸጡት ካርቴላዎች ድምር ከቤቱ ድርሻ ተቀንሶ ነው። በአንድ ኳስ መስመር የሞሉ ካርቴላዎች ሽልማቱን እኩል ይካፈላሉ። ከ2 ያነሰ ተጫዋች ያለው ዙር ይሰረዛል፣ ገንዘብም ይመለሳል።',
  ].join('\n'),
  depositsOff: 'ገንዘብ ማስገቢያ ገና አልተከፈተም። እባክዎ ቆይተው ይሞክሩ።',
  depositChoose: (min) => `💰 <b>ገንዘብ ማስገቢያ</b>\n\nየክፍያ መንገድ ይምረጡ (ዝቅተኛ ${min} ብር)፦`,
  depositHow: (method, account, name, min, bonus) =>
    [
      `📱 <b>${method} ማስገቢያ</b>`,
      '',
      `አካውንት፦ <code>${account}</code>`,
      `ስም፦ <b>${name}</b>`,
      `ዝቅተኛ፦ ${min} ብር`,
      bonus ? `🎁 የመጀመሪያ ማስገቢያ ቦነስ፦ ${bonus}%` : '',
      '',
      '1. ገንዘቡን ወደ ላይኛው አካውንት ይላኩ።',
      '2. የማረጋገጫ መልዕክት (SMS) ይደርስዎታል።',
      '3. <b>ሙሉውን መልዕክት</b> ኮፒ አድርገው እዚህ ይለጥፉ።',
    ]
      .filter(Boolean)
      .join('\n'),
  depositReceived: (amount, ref) => `✅ ደርሶናል። የ<b>${amount} ብር</b> ማስገቢያዎ (ref ${ref}) እየተረጋገጠ ነው። ሲገባ መልዕክት ይደርስዎታል።`,
  depositApproved: (amount, bonus) =>
    `✅ ገንዘብዎ ገብቷል፦ <b>+${amount} ብር</b>` + (bonus ? `\n🎁 የመጀመሪያ ማስገቢያ ቦነስ፦ <b>+${bonus} ብር</b> (መጫወቻ ሂሳብ)` : '') + '\n\nመልካም ዕድል!',
  depositRejected: (ref, note) => `❌ ማስገቢያዎ (ref ${ref}) አልተቀበለም${note ? `፦ ${note}` : ''}። ገንዘቡን ልከው ከሆነ ድጋፍ ያግኙ።`,
  withdrawNotEnough: (withdrawable, min) =>
    `⚠️ <b>ለማውጣት በቂ አይደለም</b>\n${LINE}\nዝቅተኛ ማውጫ፦ <b>${min} ብር</b>\nሊወጣ የሚችል ሂሳብዎ፦ <b>${withdrawable} ብር</b>\n\nቦነስ ማውጣት አይቻልም፤ በእሱ ያሸነፉትን ግን ይቻላል።`,
  withdrawAmount: (main, min) => `💸 <b>ገንዘብ ማውጫ</b>\n\nእስከ <b>${main} ብር</b> ማውጣት ይችላሉ።\nመጠኑን ይጻፉ (ዝቅተኛ ${min})፦`,
  withdrawBadAmount: (main, min) => `ከ${min} እስከ ${main} ያለ ሙሉ ቁጥር ይጻፉ።`,
  withdrawMethod: 'ወዴት እንላክልዎ?',
  withdrawAccount: 'የሚላክበትን ስልክ ቁጥር ይጻፉ፣ ወይም የተመዘገበውን ቁጥርዎን ይጠቀሙ፦',
  useMyNumber: (phone) => `📱 ${phone} ተጠቀም`,
  withdrawBadAccount: 'ይህ ስልክ ቁጥር አይመስልም። እንደ 0911223344 ይጻፉ።',
  withdrawName: 'በአካውንቱ ላይ ያለውን ሙሉ ስም ይጻፉ፦',
  withdrawConfirm: (amount, method, account, name) => `እባክዎ ያረጋግጡ፦\n\nመጠን፦ <b>${amount} ብር</b>\nወደ፦ <b>${method} ${account}</b>\nስም፦ <b>${name}</b>`,
  confirm: '✅ አረጋግጥ',
  withdrawSent: (amount) => `✅ የ<b>${amount} ብር</b> ማውጫ ተጠይቋል። ገንዘቡ ከሂሳብዎ ወጥቷል፤ በቅርቡ ይላክልዎታል። ሲከፈል መልዕክት ይደርስዎታል።`,
  withdrawPaid: (amount, account) => `✅ <b>${amount} ብር</b> ወደ ${account} ተልኳል።`,
  withdrawRejected: (amount, note) => `↩️ የ${amount} ብር ማውጫዎ አልተከፈለም${note ? ` (${note})` : ''}። ገንዘቡ ወደ ሂሳብዎ ተመልሷል።`,
  cancelled: 'ተሰርዟል።',
  unknown: 'ከታች ያለውን ማውጫ ይጠቀሙ 👇',
  error: '⚠️ የሆነ ችግር ተፈጥሯል። እባክዎ እንደገና ይሞክሩ።',
};

const om: Texts = {
  description: "Bingo kallattii Telegram irratti. Kaarteelaa filadhu, kubbaawwan waamaman hordofi, sarara tokko guutii badhaasa mo'adhu. Galmaa'uuf Start tuqi.",
  shortDescription: "Bingo kallattii: kaarteelaa filadhu, sarara guuti, mo'adhu.",
  chooseLanguage: LANGS,
  languageSet: '✅ Afaan: Afaan Oromoo',
  sharePhone: (name) =>
    `👋 Baga nagaan dhufte, <b>${name}</b>!\n\nGalmaa'uuf, qabduu armaan gadii tuqiitii lakkoofsa bilbilaa kee qoodi. Herrega keetii fi kaffaltii keetiif tajaajila.`,
  sharePhoneButton: '📱 Lakkoofsa bilbilaa koo qoodi',
  notYourContact: 'Maaloo lakkoofsa kee ofii qooduuf qabduu armaan gadii fayyadami.',
  registered: "✅ Galmaa'teetta!",
  welcomeGift: (birr) => `🎁 Kennaa simannaa: <b>qarshii ${birr}</b> waaleetii boonasii keetti galeera.`,
  welcomeBack: (name, main, play) =>
    `👋 Baga nagaan dhufte, <b>${name}</b>!\n\n💰 Waaleetii ijoo: <b>qarshii ${main}</b>\n🎁 Waaleetii boonasii: <b>qarshii ${play}</b>\n\nMarsaa itti aanu irratti hirmaachuuf <b>🎮 Bingo taphadhu</b> tuqi.`,
  needPhone: "Dura galmaa'i: qabduu armaan gadii tuqiitii lakkoofsa bilbilaa kee qoodi.",
  menu: 'Baafata ijoo 👇',
  btnPlay: '🎮 Bingo taphadhu',
  btnDeposit: '💰 Maallaqa galchi',
  btnWithdraw: '💸 Maallaqa baasi',
  btnBalance: '📊 Haftee',
  btnInvite: '👥 Hiriyoota affeeri',
  btnLanguage: '🌐 Afaan',
  btnRules: '📖 Akkaataa taphaa',
  btnCancel: '✖️ Haqi',
  btnPromo: '🎁 Koodii promoo',
  promoAsk: '🎁 Koodii promoo kee barreessi:',
  promoDone: (amount, code) => `🎉 Koodiin promoo <b>${code}</b> fudhatameera: <b>+qarshii ${amount}</b> waaleetii boonasii keetti galeera.`,
  promoErrors: {
    PROMO_NOT_FOUND: "Koodiin promoo kun hin jiru. Barreeffama isaa mirkaneessiitii irra deebi'ii yaali.",
    PROMO_OFF: 'Koodiin promoo kun kana booda hin hojjetu.',
    PROMO_EXPIRED: 'Yeroon koodii promoo kanaa darbeera.',
    PROMO_USED_UP: "Koodiin promoo kun baay'ina taphattootaa hayyamameen fayyadamameera.",
    PROMO_ALREADY_USED: 'Koodii promoo kana duraan fayyadamteetta.',
    PROMO_NEEDS_DEPOSIT: "Koodiin promoo kun taphattoota maallaqa galchaniif qofa. Dura maallaqa galchiitii irra deebi'ii yaali.",
  },
  openGame: "Taphicha bani, sa'aatiin osoo hin xumuramin kaarteelaa filadhu:",
  playNow: '🎮 Amma taphadhu',
  balance: (b) =>
    [
      '💰 <b>HAFTEE</b>',
      LINE,
      `🏦 Waaleetii ijoo: <b>qarshii ${b.main}</b>`,
      `🎁 Waaleetii boonasii: <b>qarshii ${b.play}</b>`,
      `💵 Waliigala: <b>qarshii ${b.total}</b>`,
      LINE,
      `💸 Kan baafamuu danda'u: <b>qarshii ${b.withdrawable}</b>`,
      `ℹ️ Baasii xiqqaa: qarshii ${b.min}`,
      b.hold ? `⏳ Kaffalamaa jira: <b>qarshii ${b.hold}</b>` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  invite: (i) =>
    [
      '👥 <b>Hiriyoota affeeri</b>',
      '',
      `Hiriyaa galmaa'ee yeroo jalqabaaf maallaqa galchu tokko tokkoof <b>qarshii ${i.reward}</b> waaleetii boonasii keetti argatta.`,
      '',
      `✅ Hiriyoota maallaqa galchan: <b>${i.deposited}</b>`,
      `⏳ Galchii jalqabaa eegaa jiran: <b>${i.waiting}</b>`,
      `🎁 Waliigala argatte: <b>qarshii ${i.earned}</b>`,
      '',
      '🔗 Liinkii affeerraa kee:',
      `<code>${i.link}</code>`,
      i.max ? `\n📊 Adeemsa: <b>${Math.min(i.deposited, i.max)} / ${i.max}</b> hiriyoota` : '',
      i.max && i.deposited >= i.max ? 'Daangaa gahteetta: hiriyoonni makamuu danda\'u, garuu badhaasni dabalataa hin jiru.' : '',
    ]
      .filter((l) => l !== '')
      .join('\n'),
  shareText: 'Telegram irratti bingo kallattii waliin haa taphannu!',
  shareButton: '📤 Liinkii qoodi',
  rulesCaption: "🏆 Karaa mo'icha 4: sarara kamiyyuu tokko guuti.",
  rules: [
    '🃏 <b>Kaarteelaa</b>',
    "Marsaan osoo hin jalqabin, boordii lakkoofsaa irraa kaarteelaa hanga 4 filachuu dandeessa. Kaarteelaan taphattoonni biroo fudhatan halluu adda ta'een mul'atu; filachuun hin danda'amu. Lakkoofsa tokko yoo tuqxe, lakkoofsonni 25 kaarteelaa sanaa jala isaatti mul'atu. Kaarteelaan tokko tokkoon gatii kutaa sanaa kaffala; sa'aatiin osoo hin xumuramin irra deebitee tuquun deebisuu dandeessa.",
    '',
    '🎮 <b>Akkaataa marsaan itti deemu</b>',
    "Yeroo lakkaa'insi zeeroo gahu marsaan jalqaba, kaarteelaan kee iskiriinii taphaa irratti mul'atu. Kubbaawwan 1 hanga 75 akka carraatti sekondii muraasa keessatti tokko tokkoon waamamu: B 1–15, I 16–30, N 31–45, G 46–60, O 61–75.",
    '',
    '✍️ <b>Mallatteessuu</b>',
    "Ofumaan (Auto): lakkoofsonni waamaman kaarteelaa kee irratti ofumaan mallattaa'u.",
    'Harkaan (Manual): ofii tuqi.',
    "Haala kamiinuu taphichi kubbaa hunda booda kaarteelaa hunda ni ilaala; mo'icha kee hin dhabdu.",
    '',
    "🏆 <b>Karaa mo'icha</b>",
    'Sarara guutuu tokko guuti:',
    '• Toora (gama gamaan)',
    '• Utubaa (gadi)',
    '• Diyaagoonaalii ↘',
    '• Diyaagoonaalii ↙',
    '★ walakkaa jiru bilisa.',
    '',
    '💰 <b>Badhaasa</b>',
    "Kaarteelaa gurgurame hunda irraa qooda manaa hir'isuun. Kaarteelaan kubbaa tokko irratti sarara guutan walqixa qooddatu. Marsaan taphattoota 2 gadi qabu ni haqama, maallaqnis ni deebi'a.",
  ].join('\n'),
  depositsOff: 'Maallaqa galchuun ammaaf hin banamne. Maaloo booda yaali.',
  depositChoose: (min) => `💰 <b>Maallaqa galchi</b>\n\nMala kaffaltii filadhu (xiqqaate qarshii ${min}):`,
  depositHow: (method, account, name, min, bonus) =>
    [
      `📱 <b>${method} galchii</b>`,
      '',
      `Herrega: <code>${account}</code>`,
      `Maqaa: <b>${name}</b>`,
      `Xiqqaate: qarshii ${min}`,
      bonus ? `🎁 Boonasii galchii jalqabaa: ${bonus}%` : '',
      '',
      '1. Maallaqa herrega armaan oliitti ergi.',
      '2. Ergaa mirkaneessaa (SMS) siif dhufa.',
      '3. <b>SMS guutuu</b> garagalchiitii as maxxansi.',
    ]
      .filter(Boolean)
      .join('\n'),
  depositReceived: (amount, ref) => `✅ Nu gaheera. Galchiin kee <b>qarshii ${amount}</b> (ref ${ref}) mirkanaa'aa jira. Yeroo galu ergaan siif dhufa.`,
  depositApproved: (amount, bonus) =>
    `✅ Maallaqni kee galeera: <b>+qarshii ${amount}</b>` + (bonus ? `\n🎁 Boonasii galchii jalqabaa: <b>+qarshii ${bonus}</b> (waaleetii boonasii)` : '') + '\n\nCarraa gaarii!',
  depositRejected: (ref, note) => `❌ Galchiin kee (ref ${ref}) hin fudhatamne${note ? `: ${note}` : ''}. Maallaqa ergiteetta yoo ta'e deeggarsa quunnami.`,
  withdrawNotEnough: (withdrawable, min) =>
    `⚠️ <b>Baasuuf hin gahu</b>\n${LINE}\nBaasii xiqqaa: <b>qarshii ${min}</b>\nHaftee baafamuu danda'u: <b>qarshii ${withdrawable}</b>\n\nMaallaqni boonasii hin baafamu; kan isaan mo'atte garuu ni baafama.`,
  withdrawAmount: (main, min) => `💸 <b>Maallaqa baasi</b>\n\nHanga <b>qarshii ${main}</b> baasuu dandeessa.\nHamma isaa barreessi (xiqqaate ${min}):`,
  withdrawBadAmount: (main, min) => `Lakkoofsa guutuu ${min} fi ${main} gidduu jiru barreessi.`,
  withdrawMethod: 'Eessatti siif erginu?',
  withdrawAccount: "Lakkoofsa bilbilaa itti ergamu barreessi, ykn lakkoofsa kee galmaa'e fayyadami:",
  useMyNumber: (phone) => `📱 ${phone} fayyadami`,
  withdrawBadAccount: 'Kun lakkoofsa bilbilaa hin fakkaatu. Akka 0911223344 barreessi.',
  withdrawName: 'Maqaa guutuu herrega sana irra jiru barreessi:',
  withdrawConfirm: (amount, method, account, name) => `Maaloo mirkaneessi:\n\nHamma: <b>qarshii ${amount}</b>\nGara: <b>${method} ${account}</b>\nMaqaa: <b>${name}</b>`,
  confirm: '✅ Mirkaneessi',
  withdrawSent: (amount) =>
    `✅ Baasiin <b>qarshii ${amount}</b> gaafatameera. Maallaqni waaleetii kee keessaa ba'eera, yeroo dhiyootti siif ergama. Yeroo kaffalamu ergaan siif dhufa.`,
  withdrawPaid: (amount, account) => `✅ <b>Qarshiin ${amount}</b> gara ${account} ergameera.`,
  withdrawRejected: (amount, note) => `↩️ Baasiin kee qarshii ${amount} hin kaffalamne${note ? ` (${note})` : ''}. Maallaqni waaleetii keetti deebi'eera.`,
  cancelled: 'Haqameera.',
  unknown: 'Baafata armaan gadii fayyadami 👇',
  error: "⚠️ Rakkoon uumameera. Maaloo irra deebi'ii yaali.",
};

export const TEXTS: Record<BotLang, Texts> = { en, am, om };
export const textsFor = (lang: string | null | undefined): Texts => TEXTS[lang === 'en' || lang === 'om' ? lang : 'am'];

/** Menu buttons in every language, so a tap works whatever language the keyboard was drawn in. */
export type MenuAction = 'play' | 'deposit' | 'withdraw' | 'balance' | 'invite' | 'language' | 'rules' | 'cancel' | 'promo';
const ACTION_KEYS: Record<MenuAction, keyof Texts> = {
  play: 'btnPlay',
  deposit: 'btnDeposit',
  withdraw: 'btnWithdraw',
  balance: 'btnBalance',
  invite: 'btnInvite',
  language: 'btnLanguage',
  rules: 'btnRules',
  cancel: 'btnCancel',
  promo: 'btnPromo',
};
export function menuActionFor(text: string): MenuAction | null {
  for (const [action, key] of Object.entries(ACTION_KEYS) as [MenuAction, keyof Texts][]) {
    if (text === en[key] || text === am[key] || text === om[key]) return action;
  }
  return null;
}

/** Commands shown in Telegram's Menu, per language. */
export const COMMANDS: Record<BotLang, { command: string; description: string }[]> = {
  en: [
    { command: 'start', description: 'Start or open the menu' },
    { command: 'play', description: 'Play bingo' },
    { command: 'deposit', description: 'Add money' },
    { command: 'withdraw', description: 'Withdraw winnings' },
    { command: 'balance', description: 'My balance' },
    { command: 'invite', description: 'Invite friends' },
    { command: 'promo', description: 'Use a promo code' },
    { command: 'instructions', description: 'How to play' },
    { command: 'language', description: 'Language / ቋንቋ' },
    { command: 'menu', description: 'Show the menu buttons' },
  ],
  am: [
    { command: 'start', description: 'ጀምር ወይም ማውጫ ክፈት' },
    { command: 'play', description: 'ቢንጎ ተጫወት' },
    { command: 'deposit', description: 'ገንዘብ አስገባ' },
    { command: 'withdraw', description: 'ገንዘብ አውጣ' },
    { command: 'balance', description: 'ቀሪ ሂሳብ' },
    { command: 'invite', description: 'ጓደኛ ጋብዝ' },
    { command: 'promo', description: 'ፕሮሞ ኮድ ተጠቀም' },
    { command: 'instructions', description: 'መመሪያ' },
    { command: 'language', description: 'ቋንቋ / Language' },
    { command: 'menu', description: 'የማውጫ ቁልፎችን አሳይ' },
  ],
  om: [
    { command: 'start', description: 'Jalqabi ykn baafata bani' },
    { command: 'play', description: 'Bingo taphadhu' },
    { command: 'deposit', description: 'Maallaqa galchi' },
    { command: 'withdraw', description: 'Maallaqa baasi' },
    { command: 'balance', description: 'Haftee' },
    { command: 'invite', description: 'Hiriyoota affeeri' },
    { command: 'promo', description: 'Koodii promoo fayyadami' },
    { command: 'instructions', description: 'Akkaataa taphaa' },
    { command: 'language', description: 'Afaan / Language' },
    { command: 'menu', description: 'Qabduuwwan baafataa agarsiisi' },
  ],
};

/** "+251911223344", "251911223344", "0911223344", "911223344" -> "0911223344"; null if not an Ethiopian mobile. */
export function localPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  let rest = digits;
  if (rest.startsWith('251')) rest = rest.slice(3);
  if (rest.startsWith('0')) rest = rest.slice(1);
  return /^[79]\d{8}$/.test(rest) ? `0${rest}` : null;
}
