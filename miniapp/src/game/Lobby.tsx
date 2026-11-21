import { useEffect, useRef, useState } from 'react';
import { api, type LobbyRoom, type LobbyState } from '../api';
import { useI18n } from '../i18n';
import { telegram } from '../telegram';
import { useTick } from './useRoom';

/** Colour of each stake level: coin, border, button. Unknown stakes cycle through the list. */
const TIERS = [
  { stake: 10, color: '#3b82f6' },
  { stake: 20, color: '#22c55e' },
  { stake: 50, color: '#a855f7' },
  { stake: 100, color: '#f6b93b' },
  { stake: 200, color: '#f0645a' },
];
const tierColor = (stake: number, index: number) => TIERS.find((t) => t.stake === stake)?.color ?? TIERS[index % TIERS.length].color;
const BALLS = 75;
const fmt = (birr: string) => Number(birr).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** "Games": every stake room with its live state. Tapping one opens it. */
export function Lobby({ onOpen }: { onOpen: (roomId: string) => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<LobbyState | null>(null);
  const [failed, setFailed] = useState(false);
  const offset = useRef(0);
  useTick(500);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api<LobbyState>('/rooms');
        if (!alive) return;
        offset.current = new Date(r.serverTime).getTime() - Date.now();
        setData(r);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    const id = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const now = () => Date.now() + offset.current;

  return (
    <div className="flex flex-col gap-3 px-3 pb-4 pt-3">
      <div className="px-1">
        <h1 className="font-display text-2xl">{t('games')}</h1>
        <p className="text-xs text-muted">{t('gamesSub')}</p>
      </div>
      {!data && <p className="py-10 text-center text-sm text-muted">{failed ? t('lobbyOffline') : '…'}</p>}
      {data?.rooms.map((room, i) => (
        <RoomCard key={room.id} room={room} color={tierColor(Number(room.stake.birr), i)} now={now()} onOpen={() => onOpen(room.id)} />
      ))}
    </div>
  );
}

function RoomCard({ room, color, now, onOpen }: { room: LobbyRoom; color: string; now: number; onOpen: () => void }) {
  const { t } = useI18n();
  const r = room.round;
  const selecting = r.status === 'SELECTING';
  const drawing = r.status === 'DRAWING';
  const left = Math.max(0, Math.ceil((new Date(r.selectEndsAt).getTime() - now) / 1000));
  const progress = drawing ? r.calls / BALLS : selecting ? 1 - Math.min(1, left / Math.max(1, room.selectSeconds)) : 1;

  const pill = drawing ? `${t('inPlay')}` : selecting ? `${t('selecting')} · ${left}s` : t('nextSoon');
  const note = drawing
    ? t('calledOf', { n: r.calls, total: BALLS })
    : selecting
      ? r.needPlayers > 0
        ? t('moreToStart', { n: r.needPlayers })
        : t('readyToStart')
      : '';

  return (
    <button
      type="button"
      onClick={() => {
        telegram.tap();
        onOpen();
      }}
      className="relative flex w-full flex-col gap-3 overflow-hidden rounded-2xl border bg-panel p-4 text-left transition-transform active:scale-[0.99]"
      style={{ borderColor: `${color}66`, boxShadow: `0 0 0 1px ${color}22, 0 8px 28px -12px ${color}55` }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          {/* The card price is what players choose by, so it is the title. */}
          <span className="flex items-baseline gap-1.5">
            <span className="font-display text-[30px] leading-none tabular-nums" style={{ color }}>
              {fmt(room.stake.birr)}
            </span>
            <span className="font-display text-sm text-ink">ETB</span>
            <span className="text-[11px] font-bold text-muted">{t('perCard')}</span>
          </span>
          <span className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-muted">
            <span className="font-bold text-ink">{room.name}</span>
            <span aria-hidden>·</span>
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: drawing ? 'var(--color-live)' : color }} />
            {r.players} {drawing ? t('playing') : t('waiting')}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${drawing ? 'border-line text-muted' : ''}`}
          style={drawing ? undefined : { borderColor: `${color}88`, color }}
        >
          {drawing && <span className="mr-1 text-live">●</span>}
          {pill}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-muted">{t('prizeNow')}</span>
          <span className="font-display text-xl leading-tight tabular-nums text-ink">{fmt(r.prize.birr)}</span>
          <span className="ml-1 text-xs text-muted">ETB</span>
        </span>
        <span
          className={`shrink-0 rounded-xl px-6 py-3 font-display text-base ${selecting ? 'text-bg' : 'border-2 bg-transparent'}`}
          style={selecting ? { background: color } : { borderColor: color, color }}
        >
          {selecting ? `${t('join')} · ${fmt(room.stake.birr)}` : t('watch')}
        </span>
      </div>

      {note && (
        <span className="-mb-1 text-right text-[11px] font-bold" style={{ color }}>
          {note}
        </span>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2" aria-hidden>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%`, background: color }} />
      </div>
    </button>
  );
}
