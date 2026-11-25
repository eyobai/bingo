import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, ApiError, api, session, type Balances, type Money } from '../api';
import { GameTile } from '../game/GameTile';
import { useI18n } from '../i18n';
import { telegram } from '../telegram';
import { useTick } from '../game/useRoom';

/** Same curve as the server: multiplier = e^(K·t). */
const K = 0.00006;
const xAt = (ms: number) => Math.max(1, Math.floor(100 * Math.exp(K * Math.max(0, ms)) + 1e-9) / 100);

type Status = 'BETTING' | 'FLYING' | 'CRASHED';
export interface RocketState {
  serverTime: string;
  enabled: boolean;
  limits?: { minBet: Money; maxBet: Money; maxX: number; maxWin: Money; houseEdgePercent: number };
  round: {
    id: string;
    number: number;
    status: Status;
    seedHash: string;
    bettingEndsAt: string;
    startedAt: string | null;
    crashX: number | null;
    serverSeed: string | null;
    players: number;
    betsCount: number;
    totalBet: Money;
    totalWon: Money;
  } | null;
  bets: { name: string; stake: Money; cashedX: number | null; payout: Money; status: string }[];
  history: { number: number; x100: number }[];
}
interface MyBets {
  roundId: string | null;
  current: { slot: number; stake: Money; autoX: number | null; status: string; cashedX: number | null; payout: Money }[];
  recent: { round: number; stake: Money; cashedX: number | null; crashX: number | null; payout: Money; status: string; at: string }[];
}

const xColor = (x: number) => (x >= 10 ? '#f6b93b' : x >= 2 ? '#a78bfa' : '#60a5fa');
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Live game state over the socket, plus the player's own bets. */
function useRocket(onWallet: (b: Balances) => void) {
  const [state, setState] = useState<RocketState | null>(null);
  const [mine, setMine] = useState<MyBets | null>(null);
  const [connected, setConnected] = useState(false);
  const offset = useRef(0);
  const roundRef = useRef<string | null>(null);
  const onWalletRef = useRef(onWallet);
  onWalletRef.current = onWallet;

  const refreshMine = useCallback(async () => {
    if (!session.token) return;
    try {
      setMine(await api<MyBets>('/rocket/my'));
    } catch {
      /* next update retries */
    }
  }, []);

  useEffect(() => {
    const socket: Socket = io(API_URL || undefined, { path: '/socket.io', auth: { token: session.token }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('rocket:join');
      void refreshMine();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('rocket', (s: RocketState) => {
      offset.current = new Date(s.serverTime).getTime() - Date.now();
      const key = s.round ? `${s.round.id}:${s.round.status}` : null;
      if (key !== roundRef.current) {
        roundRef.current = key;
        void refreshMine();
      }
      setState(s);
    });
    socket.on('wallet', (b: Balances) => onWalletRef.current(b));
    return () => {
      socket.disconnect();
    };
  }, [refreshMine]);

  const now = useCallback(() => Date.now() + offset.current, []);
  return { state, mine, setMine, refreshMine, connected, now };
}

export function RocketScreen({ onWallet, onNeedMoney, toast }: { onWallet: (b: Balances) => void; onNeedMoney: () => void; toast: (m: string) => void }) {
  const { t } = useI18n();
  const { state, mine, setMine, now } = useRocket(onWallet);
  useTick(50);
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [showRules, setShowRules] = useState(false);

  if (!state) return <div className="flex h-64 items-center justify-center text-muted">…</div>;
  if (!state.enabled || !state.round || !state.limits) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <RocketIcon size={72} />
        <p className="font-display text-lg">Leyu Rocket</p>
        <p className="text-sm text-muted">{t('rocketClosed')}</p>
      </div>
    );
  }
  const r = state.round;
  const t0 = now();
  const flyingX = r.status === 'FLYING' && r.startedAt ? xAt(t0 - Date.parse(r.startedAt)) : 1;
  const shownX = r.status === 'CRASHED' ? (r.crashX ?? 1) : flyingX;
  const bettingLeft = Math.max(0, Date.parse(r.bettingEndsAt) - t0);

  return (
    <div className="flex flex-col gap-3 px-3 pb-4 pt-3">
      {/* Recent crash points */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {state.history.map((h) => (
          <span key={h.number} className="shrink-0 rounded-full bg-panel-2 px-2.5 py-1 text-[11px] font-black tabular-nums" style={{ color: xColor(h.x100 / 100) }}>
            {fmt(h.x100 / 100)}×
          </span>
        ))}
      </div>

      <Flight status={r.status} x={shownX} startedAt={r.startedAt} now={t0} bettingLeft={bettingLeft} bettingTotal={Date.parse(r.bettingEndsAt) - Date.parse(r.startedAt ?? r.bettingEndsAt)} players={r.players} />

      {[1, 2].map((slot) => (
        <BetPanel
          key={slot}
          slot={slot}
          state={state}
          mine={mine}
          x={flyingX}
          onMine={setMine}
          onNeedMoney={onNeedMoney}
          toast={toast}
        />
      ))}

      {/* Live bets */}
      <section className="rounded-2xl border border-line bg-panel">
        <div className="flex border-b border-line p-1">
          {(['all', 'mine'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 rounded-xl py-2 text-xs font-bold ${tab === k ? 'bg-panel-2 text-ink' : 'text-muted'}`}>
              {k === 'all' ? t('rocketAllBets') : t('rocketMyBets')}
            </button>
          ))}
        </div>
        {tab === 'all' ? (
          <>
            <div className="flex items-center justify-between px-4 py-2 text-[11px] text-muted">
              <span>{t('rocketBetsCount', { n: r.betsCount, p: r.players })}</span>
              <span>
                {t('rocketTotalWon')} <b className="text-ink">{r.totalWon.birr} ETB</b>
              </span>
            </div>
            <ul className="max-h-72 divide-y divide-line overflow-y-auto">
              {state.bets.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted">{t('rocketNoBets')}</li>}
              {state.bets.map((b, i) => (
                <li key={i} className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-xs ${b.status === 'CASHED' ? 'bg-win/10' : ''}`}>
                  <span className="truncate font-bold">{b.name}</span>
                  <span className="tabular-nums text-muted">{b.stake.birr} ETB</span>
                  <span className="w-24 text-right tabular-nums">
                    {b.cashedX ? (
                      <>
                        <b style={{ color: xColor(b.cashedX) }}>{fmt(b.cashedX)}×</b> <span className="text-win">+{b.payout.birr}</span>
                      </>
                    ) : b.status === 'LOST' ? (
                      <span className="text-danger">—</span>
                    ) : (
                      <span className="text-muted">…</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {!mine?.recent.length && <li className="px-4 py-6 text-center text-xs text-muted">{t('rocketNoMyBets')}</li>}
            {mine?.recent.map((b, i) => (
              <li key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2 text-xs">
                <span className="text-muted">#{b.round}</span>
                <span className="tabular-nums">
                  {b.stake.birr} ETB {b.crashX ? <span className="text-muted">· {t('rocketCrashedAt', { x: fmt(b.crashX) })}</span> : null}
                </span>
                <span className="text-right tabular-nums">
                  {b.status === 'CASHED' ? <b className="text-win">+{b.payout.birr}</b> : b.status === 'LOST' ? <span className="text-danger">−{b.stake.birr}</span> : <span className="text-muted">…</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Fairness and rules */}
      <section className="rounded-2xl border border-line bg-panel px-4 py-3 text-[11px] leading-relaxed text-muted">
        <p>
          🔒 {t('rocketFair')} <span className="break-all font-mono text-[10px]">{r.seedHash.slice(0, 16)}…</span>
        </p>
        {r.serverSeed && (
          <p className="mt-1">
            {t('rocketSeed')} <span className="break-all font-mono text-[10px]">{r.serverSeed}</span>
          </p>
        )}
        <button type="button" onClick={() => setShowRules((v) => !v)} className="mt-2 font-bold text-gold">
          {showRules ? '▾' : '▸'} {t('rocketRules')}
        </button>
        {showRules && (
          <ul className="mt-1 list-disc pl-4">
            <li>{t('rocketRule1')}</li>
            <li>{t('rocketRule2', { edge: state.limits.houseEdgePercent, rtp: 100 - state.limits.houseEdgePercent })}</li>
            <li>{t('rocketRule3', { min: state.limits.minBet.birr, max: state.limits.maxBet.birr, maxX: state.limits.maxX, maxWin: state.limits.maxWin.birr })}</li>
            <li>{t('rocketRule4')}</li>
          </ul>
        )}
        <p className="mt-2 font-bold">18+ · {t('rocketResponsible')}</p>
      </section>
    </div>
  );
}

/** The sky: the trail and rocket climbing while flying, a countdown while betting, the crash point after. */
function Flight({ status, x, startedAt, now, bettingLeft, bettingTotal, players }: { status: Status; x: number; startedAt: string | null; now: number; bettingLeft: number; bettingTotal: number; players: number }) {
  const { t } = useI18n();
  const W = 400;
  const H = 240;
  const elapsed = status === 'FLYING' && startedAt ? now - Date.parse(startedAt) : 0;
  // The view zooms out as the rocket climbs: time axis and multiplier axis both grow.
  const span = Math.max(8000, elapsed * 1.15);
  const top = Math.max(2, x * 1.25);
  const pts: [number, number][] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const ms = (elapsed * i) / steps;
    const m = Math.exp(K * ms);
    pts.push([20 + (ms / span) * (W - 70), H - 24 - ((m - 1) / (top - 1)) * (H - 70)]);
  }
  const tip = pts[pts.length - 1];
  const prev = pts[Math.max(0, pts.length - 4)];
  const angle = (Math.atan2(tip[1] - prev[1], tip[0] - prev[0]) * 180) / Math.PI;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${tip[0].toFixed(1)},${H - 24} L20,${H - 24} Z`;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-line" style={{ background: 'radial-gradient(ellipse at 50% 120%, #1e3a6e 0%, #0b1120 70%)' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" aria-hidden>
        <defs>
          <linearGradient id="trail" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#f6b93b" stopOpacity="0.45" />
            <stop offset="1" stopColor="#f6b93b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* stars */}
        {STARS.map(([sx, sy, r], i) => (
          <circle key={i} cx={sx} cy={sy} r={r} fill="#fff" opacity={0.25 + ((i * 37) % 50) / 100} />
        ))}
        {/* city skyline */}
        <path d={SKYLINE} fill="#0f1a30" />
        <path d={SKYLINE} fill="none" stroke="#24304a" strokeWidth="1" />
        {status === 'FLYING' && (
          <>
            <path d={area} fill="url(#trail)" />
            <path d={line} fill="none" stroke="#f6b93b" strokeWidth="3.5" strokeLinecap="round" />
            <g transform={`translate(${tip[0]},${tip[1]}) rotate(${angle + 45})`}>
              <RocketShape />
            </g>
          </>
        )}
        {status === 'CRASHED' && <text x={W - 44} y={58} textAnchor="middle" fontSize="34">💥</text>}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {status === 'BETTING' ? (
          <>
            <RocketIcon size={54} />
            <p className="mt-2 text-xs font-bold uppercase tracking-widest text-muted">{t('rocketNextFlight')}</p>
            <p className="font-display text-3xl tabular-nums">{(bettingLeft / 1000).toFixed(1)}s</p>
            <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-gold" style={{ width: `${Math.max(0, Math.min(100, (bettingLeft / Math.max(1, bettingTotal)) * 100))}%` }} />
            </div>
          </>
        ) : (
          <>
            <p className={`font-display text-6xl tabular-nums drop-shadow-[0_4px_0_rgba(0,0,0,0.5)] ${status === 'CRASHED' ? 'text-danger' : 'text-ink'}`}>{fmt(x)}×</p>
            {status === 'CRASHED' && <p className="mt-1 text-sm font-black uppercase tracking-widest text-danger">{t('rocketFlewAway')}</p>}
          </>
        )}
      </div>
      <span className="absolute bottom-2 right-3 rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-bold text-muted">👤 {players}</span>
    </section>
  );
}

/** One bet slot: stake, optional auto cash-out, and the main button that changes with the round. */
function BetPanel({ slot, state, mine, x, onMine, onNeedMoney, toast }: { slot: number; state: RocketState; mine: MyBets | null; x: number; onMine: (m: MyBets) => void; onNeedMoney: () => void; toast: (m: string) => void }) {
  const { t } = useI18n();
  const limits = state.limits!;
  const r = state.round!;
  const min = Number(limits.minBet.birr);
  const max = Number(limits.maxBet.birr);
  const [mode, setMode] = useState<'bet' | 'auto'>('bet');
  const [stake, setStake] = useState(min);
  const [autoX, setAutoX] = useState('2.00');
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  // Quick amounts: the lowest bet, then round numbers above it.
  const chips = useMemo(() => [min, ...[5, 10, 20, 50, 100, 200, 500].filter((v) => v > min && v <= max)].slice(0, 4), [min, max]);
  // Keeps the stake inside the limits when staff change them.
  useEffect(() => setStake((s) => Math.min(max, Math.max(min, s))), [min, max]);

  const bet = mine && mine.roundId === r.id ? mine.current.find((b) => b.slot === slot) : undefined;
  const live = bet && bet.status === 'PLACED' && r.status === 'FLYING';
  const canBet = r.status === 'BETTING' && Date.parse(r.bettingEndsAt) - Date.now() > 500;

  const call = useCallback(
    async (fn: () => Promise<MyBets>) => {
      setBusy(true);
      try {
        onMine(await fn());
        telegram.tap();
      } catch (e) {
        telegram.error();
        if (e instanceof ApiError && e.code === 'INSUFFICIENT_FUNDS') {
          toast(t('needMoney'));
          onNeedMoney();
        } else toast(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onMine, onNeedMoney, toast, t],
  );
  const place = useCallback(
    () =>
      call(() =>
        api<MyBets>('/rocket/bet', {
          body: { slot, amount: String(stake), ...(mode === 'auto' && Number(autoX) >= 1.01 ? { autoX: Number(Number(autoX).toFixed(2)) } : {}) },
        }),
      ),
    [call, slot, stake, mode, autoX],
  );

  // A bet asked for during a flight goes in as soon as the next betting window opens.
  useEffect(() => {
    if (queued && canBet && !bet && !busy) {
      setQueued(false);
      void place();
    }
  }, [queued, canBet, bet, busy, place]);

  let button: { label: string; sub?: string; cls: string; onClick?: () => void; disabled?: boolean };
  if (live) {
    const win = Math.min(Number(bet!.stake.birr) * x, Number(limits.maxWin.birr));
    button = { label: t('rocketCashOut'), sub: `${fmt(win)} ETB`, cls: 'bg-gold text-gold-ink', onClick: () => void call(() => api<MyBets>('/rocket/cashout', { body: { slot } })) };
  } else if (bet?.status === 'CASHED') {
    button = { label: t('rocketCashedAt', { x: fmt(bet.cashedX ?? 0) }), sub: `+${bet.payout.birr} ETB`, cls: 'bg-win text-white', disabled: true };
  } else if (bet && r.status === 'BETTING') {
    button = { label: t('rocketCancel'), sub: t('rocketWaitingTakeoff'), cls: 'bg-danger text-white', onClick: () => void call(() => api<MyBets>(`/rocket/bet/${slot}`, { method: 'DELETE' })) };
  } else if (queued) {
    button = { label: t('rocketCancel'), sub: t('rocketQueued'), cls: 'bg-danger text-white', onClick: () => setQueued(false) };
  } else if (canBet) {
    button = { label: t('rocketBet'), sub: `${fmt(stake)} ETB`, cls: 'bg-win text-white', onClick: () => void place() };
  } else {
    button = { label: t('rocketBetNext'), sub: `${fmt(stake)} ETB`, cls: 'bg-win/80 text-white', onClick: () => setQueued(true) };
  }
  const locked = Boolean(bet) || queued;

  return (
    <section className="rounded-2xl border border-line bg-panel p-3">
      <div className="mb-2 flex rounded-full bg-panel-2 p-0.5 text-[11px] font-bold">
        {(['bet', 'auto'] as const).map((m) => (
          <button key={m} type="button" disabled={locked} onClick={() => setMode(m)} className={`flex-1 rounded-full py-1.5 ${mode === m ? 'bg-ink text-bg' : 'text-muted'}`}>
            {m === 'bet' ? t('rocketTabBet') : t('rocketTabAuto')}
          </button>
        ))}
      </div>
      <div className="flex gap-3">
        <div className="flex w-[46%] flex-col gap-2">
          <div className="flex items-center justify-between rounded-full bg-panel-2 px-1 py-1">
            <button type="button" disabled={locked} aria-label="−" onClick={() => setStake((s) => Math.max(min, s - min))} className="h-8 w-8 rounded-full bg-line text-lg font-black">−</button>
            <span className="font-display text-base tabular-nums">{fmt(stake)}</span>
            <button type="button" disabled={locked} aria-label="+" onClick={() => setStake((s) => Math.min(max, s + min))} className="h-8 w-8 rounded-full bg-line text-lg font-black">+</button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {chips.map((c) => (
              <button key={c} type="button" disabled={locked} onClick={() => setStake(c)} className={`rounded-lg py-1 text-xs font-bold tabular-nums ${stake === c ? 'bg-gold/20 text-gold' : 'bg-panel-2 text-muted'}`}>
                {c}
              </button>
            ))}
          </div>
          <p className="text-center text-[10px] font-bold text-muted">{t('rocketMinMax', { min: limits.minBet.birr, max: limits.maxBet.birr })}</p>
          {mode === 'auto' && (
            <label className="flex items-center justify-between gap-2 rounded-lg bg-panel-2 px-2 py-1 text-[11px] font-bold text-muted">
              {t('rocketAutoAt')}
              <input
                inputMode="decimal"
                disabled={locked}
                value={autoX}
                onChange={(e) => setAutoX(e.target.value.replace(/[^\d.]/g, ''))}
                className="w-14 rounded bg-bg px-1.5 py-0.5 text-right text-ink"
              />
              ×
            </label>
          )}
        </div>
        <button
          type="button"
          disabled={busy || button.disabled}
          onClick={button.onClick}
          className={`flex min-w-0 flex-1 flex-col items-center justify-center rounded-2xl px-2 text-center font-display shadow-lg transition-transform active:scale-[0.98] disabled:opacity-80 ${button.cls}`}
        >
          <span className={`${button.label.length > 12 ? 'text-base' : 'text-lg'} leading-tight`}>{button.label}</span>
          {button.sub && <span className="text-sm tabular-nums opacity-90">{button.sub}</span>}
        </button>
      </div>
    </section>
  );
}

/** Lobby entry for the game, with its live status and recent results. */
/** Leyu Rocket on the game picker, with its live status and last results. Hidden while staff have it switched off. */
export function RocketTile({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const [s, setS] = useState<RocketState | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api<RocketState>('/rocket/state').then((x) => alive && setS(x)).catch(() => undefined);
    void load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (!s?.enabled || !s.round) return null;
  const st = s.round.status;
  return (
    <GameTile
      name="Leyu Rocket"
      tagline={t('rocketTagline')}
      live={`${st === 'BETTING' ? t('rocketLobbyBetting') : st === 'FLYING' ? t('rocketLobbyFlying') : t('rocketLobbyNext')} · 👤 ${s.round.players}${s.limits ? ` · ${t('rocketFrom', { min: s.limits.minBet.birr })}` : ''}`}
      extra={
        <span className="flex gap-1">
          {s.history.slice(0, 4).map((h) => (
            <span key={h.number} className="rounded-full bg-black/30 px-1.5 text-[10px] font-black tabular-nums" style={{ color: xColor(h.x100 / 100) }}>
              {fmt(h.x100 / 100)}×
            </span>
          ))}
        </span>
      }
      accent="#f6b93b"
      background="linear-gradient(115deg,#1e3a6e 0%,#111a2c 62%)"
      onOpen={onOpen}
      art={<RocketIcon size={96} />}
    />
  );
}

function RocketShape() {
  return (
    <g>
      <path d="M0,-18 C7,-12 8,0 6,10 L-6,10 C-8,0 -7,-12 0,-18 Z" fill="#f6b93b" stroke="#0b1120" strokeWidth="1.5" />
      <circle cx="0" cy="-4" r="3.2" fill="#0b1120" />
      <circle cx="0" cy="-4" r="1.8" fill="#60a5fa" />
      <path d="M-6,4 L-11,13 L-5,10 Z M6,4 L11,13 L5,10 Z" fill="#f0645a" />
      <path d="M-3.5,11 Q0,22 3.5,11 Z" fill="#ffb347">
        <animate attributeName="d" values="M-3.5,11 Q0,22 3.5,11 Z;M-3.5,11 Q0,17 3.5,11 Z;M-3.5,11 Q0,22 3.5,11 Z" dur="0.25s" repeatCount="indefinite" />
      </path>
    </g>
  );
}

export function RocketIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-24 -24 48 48" aria-hidden>
      <circle r="23" fill="#0b1120" stroke="#f6b93b" strokeWidth="2" />
      <g transform="rotate(45)">
        <RocketShape />
      </g>
    </svg>
  );
}

const STARS: [number, number, number][] = [
  [30, 30, 1.2], [80, 60, 0.8], [130, 25, 1], [190, 50, 0.7], [240, 20, 1.3], [300, 45, 0.9], [350, 28, 1.1], [370, 80, 0.7],
  [60, 110, 0.8], [160, 95, 0.6], [270, 100, 0.8], [330, 120, 0.6], [110, 140, 0.7], [220, 150, 0.6],
];
const SKYLINE =
  'M0,240 L0,212 L18,212 L18,198 L30,198 L30,206 L44,206 L44,186 L52,180 L60,186 L60,206 L78,206 L78,194 L96,194 L96,214 L112,214 L112,176 L122,170 L132,176 L132,214 L150,214 L150,200 L170,200 L170,190 L184,190 L184,208 L204,208 L204,160 L212,150 L220,160 L220,208 L240,208 L240,196 L258,196 L258,212 L276,212 L276,184 L294,184 L294,206 L312,206 L312,192 L322,186 L332,192 L332,210 L352,210 L352,198 L372,198 L372,214 L400,214 L400,240 Z';
