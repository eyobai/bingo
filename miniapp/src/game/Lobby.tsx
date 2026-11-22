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
  const [joinedRetiringRoom, setJoinedRetiringRoom] = useState<string | null>(null);
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

  const retiringRoomId = data?.retiringRoomId;
  useEffect(() => {
    if (!retiringRoomId) return;
    let alive = true;
    const load = async () => {
      try {
        const { cards } = await api<{ cards: number[] }>(`/rooms/${retiringRoomId}/my-cards`);
        if (alive) setJoinedRetiringRoom(cards.length ? retiringRoomId : null);
      } catch {
        // Retry while the final round is still available.
      }
    };
    void load();
    const id = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [retiringRoomId]);

  const now = () => Date.now() + offset.current;

  return (
    <div className="flex flex-col gap-2 px-3 pb-4 pt-3">
      <div className="px-1">
        <h1 className="font-display text-2xl">{t('games')}</h1>
        <p className="text-xs text-muted">{t('gamesSub')}</p>
      </div>
      {retiringRoomId && retiringRoomId === joinedRetiringRoom && (
        <button type="button" onClick={() => onOpen(retiringRoomId)} className="rounded-2xl border border-gold bg-panel px-3 py-2 text-left">
          <span className="block font-display text-sm">{t('houseRoom')} · {t('yourCards')}</span>
          <span className="block text-xs text-muted">{t('houseRetired')}</span>
        </button>
      )}
      {!data && <p className="py-10 text-center text-sm text-muted">{failed ? t('lobbyOffline') : '…'}</p>}
      {data?.rooms.map((room, i) => (
        <RoomCard key={room.id} room={room} color={room.practice ? '#2dd4bf' : tierColor(Number(room.stake.birr), i)} now={now()} onOpen={() => onOpen(room.id)} />
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

  // One short status line: what is happening and what it needs.
  const status = drawing
    ? `● ${t('inPlay')} · ${r.calls}/${BALLS}`
    : selecting
      ? `${left}s · ${r.needPlayers > 0 ? t('moreToStart', { n: r.needPlayers }) : t('readyToStart')}`
      : t('nextSoon');

  return (
    <button
      type="button"
      onClick={() => {
        telegram.tap();
        onOpen();
      }}
      className="relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-line bg-panel py-2.5 pl-4 pr-2.5 text-left active:bg-panel-2"
    >
      {/* Room colour on the left edge */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} aria-hidden />

      {!room.practice && (
        <span className="w-[74px] shrink-0">
          <span className="flex items-baseline gap-1">
            <span className="font-display text-2xl leading-none tabular-nums" style={{ color }}>
              {fmt(room.stake.birr)}
            </span>
            <span className="text-[10px] font-black text-ink">ETB</span>
          </span>
          <span className="mt-1 block truncate text-[11px] font-bold text-muted">{room.name}</span>
        </span>
      )}

      <span className="min-w-0 flex-1 leading-tight">
        {room.practice ? (
          <>
            <span className="block font-display text-sm">{t('practiceRoom')}</span>
            <span className="mt-0.5 block text-[11px] text-muted">{t('practiceNotice', { n: room.samplePlayers })}</span>
          </>
        ) : (
          <span className="block truncate text-[13px] font-bold text-ink">
            🏆 {fmt(r.prize.birr)} <span className="text-[11px] text-muted">ETB</span>
            <span className="ml-1.5 text-[11px] font-semibold text-muted">
              · {t('maxShort')} {fmt(room.maxWin.birr)}
            </span>
          </span>
        )}
        <span className="mt-0.5 block truncate text-[11px] text-muted">
          {room.practice ? `👤 ${t('realPlayers', { n: r.players })}` : `${r.players + r.automated} ${drawing ? t('playing') : t('waiting')}`}
        </span>
        <span className={`mt-0.5 block truncate text-[11px] font-bold ${drawing ? 'text-live' : ''}`} style={drawing ? undefined : { color }}>
          {status}
        </span>
      </span>

      <span
        className={`shrink-0 rounded-lg px-3.5 py-2.5 font-display text-sm ${selecting ? 'text-bg' : 'border-2'}`}
        style={selecting ? { background: color } : { borderColor: color, color }}
      >
        {selecting ? t('join') : t('watch')}
      </span>

      {/* Countdown / draw progress along the bottom edge */}
      <span className="absolute inset-x-0 bottom-0 h-[3px] bg-panel-2" aria-hidden>
        <span className="block h-full transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%`, background: color }} />
      </span>
    </button>
  );
}
