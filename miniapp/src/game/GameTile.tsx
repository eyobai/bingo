import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { telegram } from '../telegram';

/** A big card on the game picker: artwork, name, one-line pitch, a live status line and a Play button. */
export function GameTile({
  name,
  tagline,
  live,
  extra,
  art,
  background,
  accent,
  onOpen,
}: {
  name: string;
  tagline: string;
  live?: ReactNode;
  extra?: ReactNode;
  art: ReactNode;
  background: string;
  accent: string;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => {
        telegram.tap();
        onOpen();
      }}
      className="relative flex min-h-[138px] w-full items-stretch overflow-hidden rounded-2xl border text-left shadow-lg active:scale-[0.99]"
      style={{ background, borderColor: `${accent}99` }}
    >
      <span className="relative z-10 flex min-w-0 flex-1 flex-col justify-between gap-2 py-3.5 pl-4 pr-2">
        <span className="block">
          <span className="block font-display text-[22px] leading-none">{name}</span>
          <span className="mt-1.5 block text-xs leading-snug text-ink/80">{tagline}</span>
        </span>
        {live && <span className="block truncate text-[11px] font-bold" style={{ color: accent }}>{live}</span>}
        {extra}
        <span className="inline-flex w-fit items-center gap-1 rounded-lg px-4 py-2 font-display text-sm" style={{ background: accent, color: '#0b1120' }}>
          {t('rocketPlay')} <span aria-hidden>›</span>
        </span>
      </span>
      <span className="pointer-events-none flex w-[120px] shrink-0 items-center justify-center" aria-hidden>
        {art}
      </span>
    </button>
  );
}

/** The last tile: tells players more games are on the way. */
export function ComingSoonTile() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel-2 text-lg" aria-hidden>
        ✨
      </span>
      <span className="leading-tight">
        <span className="block font-display text-sm">{t('moreGames')}</span>
        <span className="mt-0.5 block text-[11px] text-muted">{t('moreGamesSub')}</span>
      </span>
    </div>
  );
}
