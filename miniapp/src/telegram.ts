/** Thin, typed wrapper around window.Telegram.WebApp. Every call is safe outside Telegram (normal browser). */
interface TgWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { id: number; first_name: string; language_code?: string } };
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  openTelegramLink?(url: string): void;
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'success' | 'warning' | 'error'): void;
    selectionChanged(): void;
  };
}

const tg = (): TgWebApp | undefined => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

export const telegram = {
  /** Signed data proving who the user is. Empty when opened outside Telegram. */
  initData: () => tg()?.initData ?? '',
  languageHint: () => tg()?.initDataUnsafe?.user?.language_code,
  init() {
    const app = tg();
    if (!app) return;
    app.ready();
    app.expand();
    app.setHeaderColor?.('#0b1120');
    app.setBackgroundColor?.('#0b1120');
  },
  /** Shows Telegram's own back arrow (top left) while `onBack` is set; pass null to hide it. */
  backButton(onBack: (() => void) | null) {
    const b = tg()?.BackButton;
    if (!b) return () => undefined;
    if (!onBack) {
      b.hide();
      return () => undefined;
    }
    b.onClick(onBack);
    b.show();
    return () => {
      b.offClick(onBack);
      b.hide();
    };
  },
  tap: () => tg()?.HapticFeedback?.selectionChanged(),
  bump: () => tg()?.HapticFeedback?.impactOccurred('light'),
  success: () => tg()?.HapticFeedback?.notificationOccurred('success'),
  error: () => tg()?.HapticFeedback?.notificationOccurred('error'),
  share(url: string, text: string) {
    const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    if (tg()?.openTelegramLink) tg()!.openTelegramLink!(link);
    else window.open(link, '_blank');
  },
};
