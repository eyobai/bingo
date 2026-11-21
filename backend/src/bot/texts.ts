/**
 * Everything the bot says, in Amharic and English. The player picks the language on first /start (or with
 * /language); staff messages stay in English.
 */
export type BotLang = 'am' | 'en';

const en = {
  description:
    'Live bingo in Telegram. Pick your cards, watch the balls being called and complete a line to win the prize. Press Start to register.',
  shortDescription: 'Live bingo: pick cards, complete a line, win the prize.',
  chooseLanguage: 'Choose your language / ቋንቋ ይምረጡ',
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
  balance: (main: string, play: string, hold: string | null) =>
    `💰 Main wallet: <b>${main} birr</b> (withdrawable)\n🎁 Play wallet: <b>${play} birr</b> (bonus, for cards only)` +
    (hold ? `\n⏳ Being paid out: <b>${hold} birr</b>` : ''),
  invite: (reward: string, link: string, count: number) =>
    `👥 <b>Invite friends</b>\n\nYou get <b>${reward} birr</b> bonus when a friend you invited makes a first deposit.\nFriends joined so far: <b>${count}</b>\n\nYour link:\n${link}`,
  shareText: 'Play live bingo with me on Telegram!',
  shareButton: '📤 Share link',
  rules: [
    '📖 <b>How to play</b>',
    '',
    '1. Open the game and pick up to 4 card numbers before the countdown ends. Each card costs the room price.',
    '2. Balls from 1 to 75 are called one by one: B 1–15, I 16–30, N 31–45, G 46–60, O 61–75.',
    '3. Numbers on your cards are marked for you. The ★ in the middle is free.',
    '4. The first card to complete a row, column or diagonal wins. Cards that finish on the same ball share the prize.',
    '',
    'The prize is the total of all cards minus the house share. A round with too few players is cancelled and refunded.',
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
  withdrawNotEnough: (main: string, min: string) =>
    `Your main wallet has <b>${main} birr</b>. The minimum withdrawal is <b>${min} birr</b>.\nBonus money cannot be withdrawn; winnings can.`,
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
  chooseLanguage: 'ቋንቋ ይምረጡ / Choose your language',
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
  balance: (main, play, hold) =>
    `💰 ዋና ሂሳብ፦ <b>${main} ብር</b> (ሊወጣ የሚችል)\n🎁 መጫወቻ ሂሳብ፦ <b>${play} ብር</b> (ቦነስ፣ ለካርቴላ ብቻ)` + (hold ? `\n⏳ በመክፈል ላይ፦ <b>${hold} ብር</b>` : ''),
  invite: (reward, link, count) =>
    `👥 <b>ጓደኛ ይጋብዙ</b>\n\nየጋበዙት ጓደኛ መጀመሪያ ገንዘብ ሲያስገባ <b>${reward} ብር</b> ቦነስ ያገኛሉ።\nእስካሁን የተቀላቀሉ፦ <b>${count}</b>\n\nሊንክዎ፦\n${link}`,
  shareText: 'በቴሌግራም ቀጥታ ቢንጎ አብረን እንጫወት!',
  shareButton: '📤 ሊንክ አጋራ',
  rules: [
    '📖 <b>እንዴት ይጫወታሉ</b>',
    '',
    '1. ጨዋታውን ከፍተው ሰዓቱ ሳያልቅ እስከ 4 ካርቴላ ይምረጡ። እያንዳንዱ ካርቴላ የክፍሉን ዋጋ ያስከፍላል።',
    '2. ከ1 እስከ 75 ያሉ ኳሶች አንድ በአንድ ይጠራሉ፦ B 1–15፣ I 16–30፣ N 31–45፣ G 46–60፣ O 61–75።',
    '3. በካርቴላዎ ላይ ያሉ ቁጥሮች በራሳቸው ይመረጣሉ። መሃል ያለው ★ ነፃ ነው።',
    '4. መጀመሪያ ረድፍ፣ አምድ ወይም ሰያፍ የሞላ ካርቴላ ያሸንፋል። በአንድ ኳስ የሞሉ ካርቴላዎች ሽልማቱን ይካፈላሉ።',
    '',
    'ሽልማቱ የሁሉም ካርቴላዎች ድምር ከቤቱ ድርሻ ተቀንሶ ነው። በቂ ተጫዋች የሌለው ዙር ይሰረዛል፣ ገንዘብም ይመለሳል።',
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
  withdrawNotEnough: (main, min) => `ዋና ሂሳብዎ <b>${main} ብር</b> ነው። ዝቅተኛው ማውጫ <b>${min} ብር</b> ነው።\nቦነስ ማውጣት አይቻልም፤ ያሸነፉትን ግን ይቻላል።`,
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

export const TEXTS: Record<BotLang, Texts> = { en, am };
export const textsFor = (lang: string | null | undefined): Texts => TEXTS[lang === 'en' ? 'en' : 'am'];

/** Menu buttons in both languages, so a tap works whatever language the keyboard was drawn in. */
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
    if (text === en[key] || text === am[key]) return action;
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
};

/** "+251911223344", "251911223344", "0911223344", "911223344" -> "0911223344"; null if not an Ethiopian mobile. */
export function localPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  let rest = digits;
  if (rest.startsWith('251')) rest = rest.slice(3);
  if (rest.startsWith('0')) rest = rest.slice(1);
  return /^[79]\d{8}$/.test(rest) ? `0${rest}` : null;
}
