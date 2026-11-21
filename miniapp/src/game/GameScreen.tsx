import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, type Balances, type RoomState } from '../api';
import { useI18n } from '../i18n';
import { telegram } from '../telegram';
import { useCaller, useSoundSetting } from './caller';
import { BallChip, BigBall, BingoCard, GoldBall, LETTERS, colorOf } from './parts';
import { useRoom, useTick } from './useRoom';

interface Props {
  roomId: string;
  onWallet: (b: Balances) => void;
  onNeedMoney: () => void;
  toast: (msg: string) => void;
}

export function GameScreen({ roomId, onWallet, onNeedMoney, toast }: Props) {
  const room = useRoom(roomId, onWallet);
  const { state } = room;
  useTick(250);
  useCaller(state?.round.id ?? '', state?.round.status ?? '', state?.round.calls ?? NO_CALLS);

  if (!state) {
    return <div className="flex h-64 items-center justify-center text-muted">…</div>;
  }
  const { status } = state.round;
  if (status === 'SELECTING') return <SelectView {...room} state={state} onNeedMoney={onNeedMoney} toast={toast} />;
  if (status === 'DRAWING') return <PlayView {...room} state={state} />;
  if (status === 'FINISHED') return <ResultView {...room} state={state} />;
  return <CancelledView state={state} now={room.now} hadCards={room.mine.length > 0} />;
}

type RoomHook = ReturnType<typeof useRoom> & { state: RoomState };
const NO_CALLS: number[] = [];

const DECOR = [
  { n: 27, x: 8, y: 4 },
  { n: 31, x: 38, y: 0 },
  { n: 32, x: 68, y: 3 },
  { n: 8, x: 98, y: 1 },
  { n: 43, x: 0, y: 34 },
  { n: 68, x: 28, y: 30 },
  { n: 23, x: 56, y: 32 },
  { n: 18, x: 86, y: 30 },
  { n: 38, x: 14, y: 60 },
  { n: 75, x: 42, y: 62 },
  { n: 73, x: 70, y: 60 },
  { n: 64, x: 100, y: 58 },
];

function Countdown({ ms }: { ms: number }) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return (
    <span className="font-display text-3xl tabular-nums">
      {String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

function SelectView({ state, mine, layouts, busy, toggle, now, onNeedMoney, toast }: RoomHook & { onNeedMoney: () => void; toast: (m: string) => void }) {
  const { t } = useI18n();
  const taken = useMemo(() => new Set(state.round.taken), [state.round.taken]);
  const max = state.room.maxCardsPerPlayer;
  const left = new Date(state.round.selectEndsAt).getTime() - now();
  const closing = left < 1500;

  const pick = async (n: number) => {
    const isMine = mine.includes(n);
    if (!isMine && taken.has(n)) return;
    if (!isMine && mine.length >= max) {
      telegram.error();
      return toast(`${t('selectCards')}: ${mine.length}/${max}`);
    }
    telegram.tap();
    try {
      await toggle(n);
    } catch (e) {
      telegram.error();
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_FUNDS') {
        toast(t('needMoney'));
        onNeedMoney();
      } else toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 px-3 pb-4 pt-3">
      <section className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-3 py-2.5">
        <div className="h-8 w-8 rounded-lg bg-panel-2" aria-hidden />
        <div className="leading-tight">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted">{t('events')}</p>
          <p className="text-sm font-bold">{t('eventsTitle')}</p>
          <p className="text-[10px] text-muted">{t('eventsBody')}</p>
        </div>
      </section>

      <section className="jackpot relative flex items-center justify-between gap-2 overflow-hidden rounded-2xl px-4 py-3">
        <div className="z-10 flex flex-col gap-1">
          <span className="w-fit rounded-md bg-gold/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-gold">{t('jackpot')}</span>
          <span className="font-display text-[26px] leading-none tabular-nums">
            {state.round.prize.birr}
            <span className="ml-1 text-base">ETB</span>
          </span>
          <span className="text-[10px] text-muted">
            {state.round.players} {t('players')} · {state.round.cardsSold} {t('cards')}
          </span>
        </div>
        <div className="relative hidden h-20 w-32 shrink-0 min-[400px]:block" aria-hidden>
          {DECOR.map((d) => (
            <GoldBall key={d.n} n={d.n} style={{ left: d.x, top: d.y, animationDelay: `${(d.n % 7) * 0.2}s` }} />
          ))}
        </div>
        <div className="z-10 flex shrink-0 flex-col items-end gap-0.5 text-right">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{t('startingIn')}</span>
          <Countdown ms={left} />
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-sm uppercase tracking-wider">
            {t('selectCards')} ({state.room.stake.birr} ETB)
          </h2>
          <span className="font-display text-gold">
            {mine.length}
            <span className="text-muted">/{max}</span>
          </span>
        </div>
        <p className="px-4 pt-2 text-[11px] text-muted">{t('tapToPick')}</p>
        <div className="grid grid-cols-10 gap-1 p-2.5">
          {Array.from({ length: state.room.cardPool }, (_, i) => i + 1).map((n) => {
            const isMine = mine.includes(n);
            const isTaken = !isMine && taken.has(n);
            const isBusy = busy.has(n);
            const look = isMine
              ? 'bg-gold text-gold-ink border-gold'
              : isTaken
                ? 'bg-taken text-taken-ink border-taken'
                : 'bg-panel-2 text-ink border-line active:bg-line';
            return (
              <button
                key={n}
                type="button"
                disabled={isTaken || closing}
                onClick={() => void pick(n)}
                aria-pressed={isMine}
                aria-label={`Card ${n}${isMine ? ', yours' : isTaken ? ', taken' : ''}`}
                className={`aspect-square min-w-0 rounded-md border text-[11px] font-bold tabular-nums transition-colors ${look} ${isBusy ? 'animate-pulse' : ''}`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-1 font-display text-xs uppercase tracking-wider text-muted">{t('yourCards')}</h2>
        {mine.length && layouts.length ? (
          <div className="grid grid-cols-2 gap-2">
            {mine.map((n) => (
              <BingoCard key={n} cardNo={n} layout={layouts[n - 1]} marked={new Set()} compact tone="mine" />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-muted">{t('noCardsYet', { max })}</p>
        )}
      </section>
    </div>
  );
}

function RoundBar({ state }: { state: RoomState }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-2 bg-[#e9edf3] px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-700">
      <span className="rounded-full bg-white px-2 py-0.5">
        <span className="text-gold-deep">●</span> {t('gameRound')} #{state.round.number}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
          ● {t('live')} · {state.round.players} {t('players')}
        </span>
        <SoundButton />
      </span>
    </div>
  );
}

/** Turns the Amharic ball announcements on or off (remembered on this phone). */
function SoundButton() {
  const { t } = useI18n();
  const [on, setOn] = useSoundSetting();
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      aria-pressed={on}
      aria-label={on ? t('soundOff') : t('soundOn')}
      className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-gray-700"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
        {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 6 6m0-6-6 6" />}
      </svg>
    </button>
  );
}

function CallStrip({ state }: { state: RoomState }) {
  const { t } = useI18n();
  const calls = state.round.calls;
  const last = calls.at(-1) ?? null;
  const recent = calls.slice(-7, -1).reverse();
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <div className="flex shrink-0 flex-col rounded-xl border-2 border-gold/70 bg-gold/10 px-2.5 py-1">
        <span className="text-[8px] font-black uppercase tracking-widest text-gold">{t('prizePool')}</span>
        <span className="font-display text-lg leading-tight tabular-nums text-gold">{state.round.prize.birr} ETB</span>
      </div>
      <BigBall n={last} size={58} />
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-full border border-line bg-panel px-1.5 py-1">
        {recent.map((n) => (
          <BallChip key={n} n={n} size={30} />
        ))}
      </div>
      <span className="shrink-0 text-[11px] font-bold tabular-nums text-muted">
        <span className="text-gold">●</span> {calls.length}/75
      </span>
    </div>
  );
}

function Board({ calls }: { calls: number[] }) {
  const set = new Set(calls);
  const last = calls.at(-1);
  return (
    <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-[3px] px-3 pb-3">
      {LETTERS.map((l, c) => (
        <div key={l} className="contents">
          <div className="flex aspect-square items-center justify-center rounded font-display text-[10px] text-white" style={{ background: colorOf(c * 15 + 1) }}>
            {l}
          </div>
          {Array.from({ length: 15 }, (_, i) => c * 15 + i + 1).map((n) => (
            <div
              key={n}
              className={`flex aspect-square items-center justify-center rounded text-[9px] font-bold tabular-nums ${set.has(n) ? 'text-white' : 'bg-panel-2 text-muted'} ${n === last ? 'ring-2 ring-white' : ''}`}
              style={set.has(n) ? { background: colorOf(n) } : undefined}
            >
              {n}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PlayView({ state, mine, layouts }: RoomHook) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'auto' | 'manual'>(() => {
    try {
      return localStorage.getItem('bingo.mode') === 'manual' ? 'manual' : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [showBoard, setShowBoard] = useState(false);
  const [manualMarks, setManualMarks] = useState<Set<number>>(new Set());
  const called = useMemo(() => new Set(state.round.calls), [state.round.calls]);
  const lastCount = useRef(state.round.calls.length);

  useEffect(() => {
    if (state.round.calls.length !== lastCount.current) {
      lastCount.current = state.round.calls.length;
      const last = state.round.calls.at(-1);
      if (last && mine.some((c) => layouts[c - 1]?.includes(last))) telegram.bump();
    }
  }, [state.round.calls, mine, layouts]);

  const setModeSaved = (m: 'auto' | 'manual') => {
    setMode(m);
    try {
      localStorage.setItem('bingo.mode', m);
    } catch {
      /* ignore */
    }
  };
  const marked = mode === 'auto' ? called : manualMarks;
  const toggleMark = (n: number) => {
    if (!called.has(n)) return telegram.error();
    telegram.tap();
    setManualMarks((m) => {
      const next = new Set(m);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  return (
    <div className="flex flex-col">
      <RoundBar state={state} />
      <CallStrip state={state} />
      <div className="flex items-center gap-2 px-3 pb-2">
        <button
          type="button"
          onClick={() => setShowBoard((v) => !v)}
          aria-expanded={showBoard}
          className="flex flex-1 items-center justify-between rounded-xl border border-line bg-panel px-3 py-2 text-[11px] font-black uppercase tracking-wider"
        >
          <span>▦ {t('trackNumbers')}</span>
          <span className="text-muted">{showBoard ? '▴' : '▾'}</span>
        </button>
        <div className="flex rounded-full border border-line bg-panel p-0.5 text-[10px] font-black uppercase">
          {(['auto', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModeSaved(m)}
              aria-pressed={mode === m}
              className={`rounded-full px-3 py-1.5 ${mode === m ? 'bg-ink text-bg' : 'text-muted'}`}
            >
              {t(m)}
            </button>
          ))}
        </div>
      </div>
      {showBoard && <Board calls={state.round.calls} />}

      {mine.length && layouts.length ? (
        <div className="flex flex-col gap-2 px-3 pb-4">
          <p className="text-[11px] text-muted">{mode === 'auto' ? t('autoHelp') : t('manualHelp')}</p>
          <div className={`grid gap-2 ${mine.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {mine.map((n) => (
              <BingoCard
                key={n}
                cardNo={n}
                layout={layouts[n - 1]}
                marked={marked}
                hint={mode === 'manual' ? called : undefined}
                onCell={mode === 'manual' ? toggleMark : undefined}
                compact={mine.length > 1}
                tone="mine"
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-panel-2 text-2xl text-muted">◷</div>
          <p className="text-lg font-black">{t('roundInProgress')}</p>
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted">{t('waitNext')}</p>
        </div>
      )}
    </div>
  );
}

function ResultView({ state, mine, now }: RoomHook) {
  const { t } = useI18n();
  const result = state.result;
  const myWins = result?.winners.filter((w) => mine.includes(w.cardNo)) ?? [];
  const called = useMemo(() => new Set(state.round.calls), [state.round.calls]);
  useEffect(() => {
    if (myWins.length) telegram.success();
  }, [myWins.length]);
  if (!result) return null;
  const left = new Date(result.nextRoundAt).getTime() - now();
  const won = myWins.length ? (Number(result.prizePerWinner.minor) * myWins.length) / 100 : 0;

  return (
    <div className="winner-glow flex min-h-[70vh] flex-col items-center gap-4 px-4 py-6">
      {myWins.length > 0 && (
        <div className="pop w-full rounded-2xl bg-win px-4 py-3 text-center font-display text-lg text-white">{t('youWon', { amount: won.toLocaleString('en-US') })}</div>
      )}
      {result.winners.length === 1 ? (
        <>
          <span className="rounded-full bg-gold px-5 py-1.5 text-xs font-black uppercase tracking-[0.25em] text-gold-ink shadow-lg">{t('grandWinner')}</span>
          <p className="font-display text-4xl italic text-gold">BINGO!</p>
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-gold/80">— {t('winnerIs')} —</p>
            <p className="font-display text-3xl uppercase">{result.winners[0].name}</p>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">
              {t('ticket')} #{result.winners[0].cardNo} · {result.prizePerWinner.birr} ETB
            </p>
          </div>
          <div className="w-full max-w-[290px]">
            <BingoCard
              cardNo={result.winners[0].cardNo}
              layout={result.winners[0].layout}
              marked={called}
              winLine={result.winners[0].lineIndex}
              tone="winner"
            />
          </div>
        </>
      ) : (
        <>
          <span className="rounded-full bg-gold px-5 py-1.5 text-xs font-black uppercase tracking-[0.25em] text-gold-ink shadow-lg">
            {result.winners.length} {t('winners')}
          </span>
          <p className="font-display text-3xl italic text-gold">BINGO!</p>
          <div className="w-full rounded-2xl border border-line bg-panel p-4">
            <div className="flex justify-between border-b border-line pb-3 text-xs font-black uppercase tracking-wider text-muted">
              <span>{t('totalWinners')}</span>
              <span className="text-lg text-ink">{result.winners.length}</span>
            </div>
            <div className="flex justify-between py-3 text-xs font-black uppercase tracking-wider text-muted">
              <span>{t('prizePerWinner')}</span>
              <span className="font-display text-xl text-gold">{result.prizePerWinner.birr} ETB</span>
            </div>
          </div>
          <div className={`grid w-full gap-3 ${result.winners.length > 1 ? 'grid-cols-2' : ''}`}>
            {result.winners.map((w) => (
              <div key={w.cardNo} className="flex min-w-0 flex-col gap-1.5">
                <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${mine.includes(w.cardNo) ? 'border-gold bg-gold/10' : 'border-line bg-panel'}`}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gold text-sm font-black text-gold-ink">{w.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-sm font-bold">{w.name}</span>
                    <span className="text-[10px] text-gold">
                      {t('ticket')} #{w.cardNo}
                    </span>
                  </span>
                </div>
                <BingoCard cardNo={w.cardNo} layout={w.layout} marked={called} winLine={w.lineIndex} tone="winner" compact />
              </div>
            ))}
          </div>
        </>
      )}
      <p className="text-xs text-muted">{t('nextRoundIn', { s: Math.max(0, Math.ceil(left / 1000)) })}</p>
    </div>
  );
}

function CancelledView({ state, now, hadCards }: { state: RoomState; now: () => number; hadCards: boolean }) {
  const { t } = useI18n();
  const left = state.cancelled ? new Date(state.cancelled.nextRoundAt).getTime() - now() : 0;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <p className="text-lg font-black">{t('notEnough')}</p>
      {hadCards && <p className="text-sm text-muted">{t('refunded')}</p>}
      <p className="text-xs text-muted">{t('nextRoundIn', { s: Math.max(0, Math.ceil(left / 1000)) })}</p>
    </div>
  );
}
