import type { Balances, User } from './api';
import { useI18n } from './i18n';

const BRAND = (import.meta.env.VITE_BRAND_NAME as string | undefined) || 'Leyu Games';

export function Header({ user, wallet }: { user: User; wallet: Balances | null }) {
  const { t, lang, setLang } = useI18n();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-bg/95 px-3 py-2.5 backdrop-blur">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white font-display text-lg text-gray-900">
        {user.firstName.slice(0, 1).toUpperCase()}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <WalletPill label={t('playShort')} value={wallet?.play.birr} tone="text-sky-400" />
        <WalletPill label={t('mainShort')} value={wallet?.main.birr} tone="text-gold" />
      </div>
      {/* Two-word names ("Leyu Games") stack on two lines so they fit next to the wallets on small phones. */}
      <div className="flex min-w-0 flex-1 flex-col items-center text-center font-display leading-[1.05] tracking-wide text-gold">
        {BRAND.split(' ').length === 2 ? (
          BRAND.split(' ').map((w) => (
            <span key={w} className="max-w-full truncate text-base">
              {w}
            </span>
          ))
        ) : (
          <span className="max-w-full truncate text-xl">{BRAND}</span>
        )}
      </div>
      <div className="flex shrink-0 rounded-full border border-line bg-panel p-0.5 text-[11px] font-bold">
        {(['am', 'om', 'en'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            aria-pressed={lang === l}
            className={`rounded-full px-2 py-1 ${lang === l ? 'bg-gold text-gold-ink' : 'text-muted'}`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}

function WalletPill({ label, value, tone }: { label: string; value?: string; tone: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-panel px-2 py-0.5 text-[10px] leading-tight">
      <span className={`min-w-0 truncate font-bold uppercase tracking-wide ${tone}`}>{label}</span>
      <span className="font-bold tabular-nums text-ink">{value ?? '–'}</span>
      <span className="text-muted">ETB</span>
    </div>
  );
}
