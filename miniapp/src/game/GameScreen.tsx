import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, type Balances, type RoomState, type Winner } from '../api';
import { useI18n } from '../i18n';
import { telegram } from '../telegram';
import { useOnline, ReconnectingBar } from '../Connection';
import { useCaller, useSoundSetting } from './caller';
import { BallChip, BigBall, BingoCard, GoldBall, LETTERS, colorOf, letterOf, oneAway } from './parts';
import { useRoom, useTick } from './useRoom';

interface Props {
  roomId: string;
  onWallet: (b: Balances) => void;
  onNeedMoney: () => void;
  toast: (msg: string) => void;
}

export function GameScreen({ roomId, onWallet, onNeedMoney, toast }: Props) {
  const room = useRoom(roomId, onWallet);
  const { t } = useI18n();
  const { state } = room;
  const online = useOnline();
  // Only after the first connection, so opening a room does not flash the bar.
  const everConnected = useRef(false);
  if (room.connected) everConnected.current = true;
  const reconnecting = online && everConnected.current && !room.connected;
  useTick(250);
  useCaller(state?.round.id ?? '', state?.round.status ?? '', state?.round.calls ?? NO_CALLS);
  // A new phase (countdown, draw, result) starts at the top, even if the player had scrolled down the card list.
  const phase = `${state?.round.id}:${state?.round.status}`;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase]);

  if (!state) {
    return (
      <>
        {reconnecting && <ReconnectingBar />}
        <div className="flex h-64 items-center justify-center text-muted">{room.closed ? t('roomClosed') : '…'}</div>
      </>
    );
  }
  const { status } = state.round;
  return (
    <>
      {reconnecting && <ReconnectingBar />}
      {state.room.practice && (
        <div className="mx-3 mt-3 rounded-xl border border-line bg-panel px-3 py-2">
          <h2 className="font-display text-sm">{t('practiceRoom')}</h2>
          <p className="text-xs text-muted">{t('practiceNotice', { n: state.room.samplePlayers })}</p>
        </div>
      )}
      {state.room.houseCash && (
        <div className="mx-3 mt-3 rounded-xl border border-gold/60 bg-panel px-3 py-2">
          <h2 className="font-display text-sm">{t('houseRoom')}</h2>
          <p className="text-xs text-muted">{t('houseRetired')}</p>
          <p className="mt-1 text-xs text-muted">
            {state.room.houseCards.map((n, i) => `${t('housePlayer', { n: i + 1 })}: #${n}`).join(' · ')}
          </p>
        </div>
      )}
      {status === 'SELECTING' && <SelectView key={state.round.id} {...room} state={state} onNeedMoney={onNeedMoney} toast={toast} />}
      {status === 'DRAWING' && <PlayView {...room} state={state} />}
      {status === 'FINISHED' && <ResultView {...room} state={state} />}
      {status === 'CANCELLED' && <CancelledView state={state} now={room.now} hadCards={room.mine.length > 0} />}
    </>
  );
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

function PlayerCount({ state }: { state: RoomState; totalOnly?: boolean }) {
  const { t } = useI18n();
  const bots = state.round.automated ?? 0;
  if (state.room.practice || state.room.houseCash) return <>{t('realPlayers', { n: state.round.players })}</>;
  return (
    <>
      {state.round.players + bots} {t('players')}
      {/* {!totalOnly && bots > 0 && <> ({t('automatedCount', { n: bots })})</>} */}
    </>
  );
}

function SelectView({ state, mine, layouts, busy, toggle, now, onNeedMoney, toast }: RoomHook & { onNeedMoney: () => void; toast: (m: string) => void }) {
  const { t } = useI18n();
  const taken = useMemo(() => new Set(state.round.taken), [state.round.taken]);
  const automatedCards = useMemo(() => new Set(state.round.automatedCards ?? []), [state.round.automatedCards]);
  // When each automated card was first seen, so a card that was just taken flashes for a moment.
  const seenAt = useRef(new Map<number, number>());
  const firstLoad = useRef(true);
  for (const n of automatedCards) if (!seenAt.current.has(n)) seenAt.current.set(n, firstLoad.current ? 0 : Date.now());
  firstLoad.current = false;
  const automated = state.room.automatedPlayers ?? 0;
  const showAutomatedNotice = automated > 0 && !state.room.entriesPaused;
  const max = state.room.maxCardsPerPlayer;
  const left = new Date(state.round.selectEndsAt).getTime() - now();
  const closing = left < 1500;

  const pick = async (n: number) => {
    const isMine = mine.includes(n);
    if (!isMine && (state.room.entriesPaused || taken.has(n))) return;
    if (!isMine && mine.length >= max) {
      telegram.error();
      return toast(`${t('selectCards')}: ${mine.length}/${max}`);
    }
    telegram.tap();
    try {
      await toggle(n, !isMine && showAutomatedNotice);
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
      {!state.room.practice && (
        <section className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-3 py-2.5">
          <div className="h-8 w-8 rounded-lg bg-panel-2" aria-hidden />
          <div className="leading-tight">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted">{t('events')}</p>
            <p className="text-sm font-bold">{t('eventsTitle')}</p>
            <p className="text-[10px] text-muted">{t('eventsBody')}</p>
          </div>
        </section>
      )}

      <section className="jackpot relative flex items-center justify-between gap-2 overflow-hidden rounded-2xl px-4 py-3">
        <div className="z-10 flex flex-col gap-1">
          {!state.room.practice && (
            <>
              <span className="w-fit rounded-md bg-gold/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-gold">{t('jackpot')}</span>
              <span className="font-display text-[26px] leading-none tabular-nums">
                {state.round.prize.birr}
                <span className="ml-1 text-base">ETB</span>
              </span>
            </>
          )}
          <span className="text-[10px] text-muted">
            <PlayerCount state={state} /> ·{' '}
            {state.round.cardsSold + (state.room.practice ? state.room.samplePlayers : 0)} {t('cards')}
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
            {state.room.entriesPaused ? t('yourCards') : t('selectCards')}
            {!state.room.practice && !state.room.entriesPaused && ` (${state.room.stake.birr} ETB)`}
          </h2>
          <span className="font-display text-gold">
            {mine.length}
            <span className="text-muted">/{max}</span>
          </span>
        </div>
        {/* Shown before purchase: tapping a free card buys it and acknowledges this notice (sent to the server). */}
        {/* {showAutomatedNotice && (
          <p id="automated-card-disclosure" role="note" className="mx-3 mt-3 rounded-lg border border-sky-400/50 bg-sky-400/10 px-3 py-2 text-[11px] leading-snug">
            🤖 {t('automatedBody', { n: automated, stake: state.room.stake.birr, cards: state.room.automatedMaxCards ?? 1 })}
          </p>
        )} */}
        {!state.room.entriesPaused && <p className="px-4 pt-2 text-[11px] text-muted">{t('tapToPick')}</p>}
        <div className="grid grid-cols-10 gap-1 p-2.5">
          {(state.room.entriesPaused ? mine : Array.from({ length: state.room.cardPool }, (_, i) => i + 1)).map((n) => {
            const isMine = mine.includes(n);
            const isTaken = !isMine && taken.has(n);
            const isBusy = busy.has(n);
            const isAutomated = isTaken && automatedCards.has(n);
            const justTaken = isAutomated && Date.now() - (seenAt.current.get(n) ?? 0) < 1500;
            const look = isMine
              ? 'bg-gold text-gold-ink border-gold'
              : isAutomated
                ? 'bg-taken/50 text-taken-ink border-dashed border-sky-400/70'
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
                aria-label={`Card ${n}${isMine ? ', yours' : isAutomated ? `, ${t('automatedTaken')}` : isTaken ? ', taken' : ''}`}
                aria-describedby={showAutomatedNotice && !isMine && !isTaken ? 'automated-card-disclosure' : undefined}
                className={`aspect-square min-w-0 rounded-md border text-[11px] font-bold tabular-nums transition-colors ${look} ${isBusy ? 'animate-pulse' : ''} ${justTaken ? 'pop ring-2 ring-sky-400' : ''}`}
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
        ) : !state.room.entriesPaused && (
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
          ● {t('live')} · <PlayerCount state={state} totalOnly />
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

function PlayView({ state, mine, layouts }: RoomHook) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'auto' | 'manual'>(() => {
    try {
      return localStorage.getItem('bingo.mode') === 'manual' ? 'manual' : 'auto';
    } catch {
      return 'auto';
    }
  });
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

  const calls = state.round.calls;
  const last = calls.at(-1) ?? null;
  const recent = calls.slice(-4, -1).reverse();
  const playing = mine.length > 0 && layouts.length > 0;
  // With 3-4 cards the board moves out of the way so every card fits on screen without scrolling.
  const compact = playing && mine.length >= 3;
  const [boardOpen, setBoardOpen] = useState(false);

  const modeSwitch = (
    <div className="grid grid-cols-2 rounded-full border border-line bg-panel p-0.5 text-[10px] font-black uppercase">
      {(['auto', 'manual'] as const).map((m) => (
        <button key={m} type="button" onClick={() => setModeSaved(m)} aria-pressed={mode === m} className={`rounded-full py-1.5 ${mode === m ? 'bg-ink text-bg' : 'text-muted'}`}>
          {t(m)}
        </button>
      ))}
    </div>
  );
  // Card layouts download separately; a card is shown once its layout has arrived (opening a room mid-draw
  // or reconnecting could otherwise render a card with no numbers and crash the screen).
  const cards = mine.filter((n) => layouts[n - 1]).map((n) => {
    const layout = layouts[n - 1];
    const needs = oneAway(layout, marked);
    return (
      <BingoCard
        key={n}
        cardNo={n}
        layout={layout}
        marked={marked}
        hint={mode === 'manual' ? called : undefined}
        onCell={mode === 'manual' ? toggleMark : undefined}
        compact
        tone="mine"
        needs={needs}
        needsLabel={needs ? t('oneAway', { n: `${letterOf(needs)}-${needs}` }) : undefined}
      />
    );
  });

  if (compact) {
    return (
      <div className="flex flex-col">
        <RoundBar state={state} />
        <div className="flex items-center gap-2 px-2 pt-2">
          <BigBall n={last} size={64} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex h-8 items-center gap-1">
              {recent.map((n) => (
                <BallChip key={n} n={n} size={30} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 text-[11px] font-black tabular-nums">
              <span className="text-muted">
                {t('balls')} <span className="text-gold">{calls.length}/75</span>
              </span>
              {!state.room.practice && (
                <span className="text-muted">
                  {t('prizePool')} <span className="text-gold">{state.round.prize.birr} ETB</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 p-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBoardOpen((v) => !v)}
              aria-expanded={boardOpen}
              className="flex-1 rounded-full border border-line bg-panel py-1.5 text-[10px] font-black uppercase tracking-wider"
            >
              ▦ {boardOpen ? t('hideBoard') : t('showBoard')}
            </button>
            <div className="w-40 shrink-0">{modeSwitch}</div>
          </div>
          {boardOpen && <WideBoard calls={calls} />}
          <div className="grid grid-cols-2 gap-2">{cards}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <RoundBar state={state} />
      <div className="grid grid-cols-[minmax(0,44fr)_minmax(0,56fr)] items-start gap-2 p-2">
        {/* Left: every number 1-75 under its letter, lit up as it is called. */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="grid grid-cols-2 divide-x divide-line overflow-hidden rounded-xl border border-line bg-panel text-center">
            <div className="px-1 py-1.5">
              <p className="text-[8px] font-bold uppercase tracking-widest text-muted">{t('cards')}</p>
              <p className="font-display text-sm tabular-nums">{state.round.cardsSold + (state.room.practice ? state.room.samplePlayers : 0)}</p>
            </div>
            <div className="px-1 py-1.5">
              <p className="text-[8px] font-bold uppercase tracking-widest text-muted">{t('balls')}</p>
              <p className="font-display text-sm tabular-nums text-gold">{calls.length}/75</p>
            </div>
          </div>
          <VerticalBoard calls={calls} />
        </div>

        {/* Right: the latest calls, then your cards (or a note when you are only watching). */}
        <div className="flex min-w-0 flex-col items-center gap-2">
          <p className="pt-1 text-[10px] font-black uppercase tracking-[0.2em] text-muted">{t('currentCall')}</p>
          <div className="flex h-9 items-center gap-1.5">
            {recent.map((n) => (
              <BallChip key={n} n={n} size={34} />
            ))}
          </div>
          <BigBall n={last} size={96} />
          {!state.room.practice && (
            <p className="rounded-full border border-gold/60 bg-gold/10 px-3 py-1 text-xs font-black tabular-nums text-gold">
              {t('prizePool')}: {state.round.prize.birr} ETB
            </p>
          )}

          {playing ? (
            <div className="flex w-full flex-col gap-2">
              {modeSwitch}
              <p className="text-center text-[10px] leading-snug text-muted">{mode === 'auto' ? t('autoHelp') : t('manualHelp')}</p>
              {cards}
            </div>
          ) : (
            <div className="flex min-h-48 w-full items-center justify-center rounded-2xl border border-line bg-panel px-4 py-8 text-center">
              <p className="text-base font-semibold leading-snug">{t('watching')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 1-75 as five rows (one per letter) across the full width; used when there is no room for the side board. */
function WideBoard({ calls }: { calls: number[] }) {
  const set = new Set(calls);
  const last = calls.at(-1);
  return (
    <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-[3px] rounded-xl border border-line bg-panel p-1.5">
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

/** 1-75 in five columns under B I N G O; called numbers take their column colour, the latest one is ringed. */
function VerticalBoard({ calls }: { calls: number[] }) {
  const set = new Set(calls);
  const last = calls.at(-1);
  return (
    <div className="rounded-xl border border-line bg-panel p-1.5">
      <div className="grid grid-cols-5 gap-1">
        {LETTERS.map((l, c) => (
          <div key={l} className="py-0.5 text-center font-display text-xs" style={{ color: colorOf(c * 15 + 1) }}>
            {l}
          </div>
        ))}
        {Array.from({ length: 15 }, (_, row) =>
          LETTERS.map((_, c) => {
            const n = c * 15 + row + 1;
            const on = set.has(n);
            return (
              <div
                key={n}
                className={`flex aspect-square items-center justify-center rounded-md text-[11px] font-bold tabular-nums ${on ? 'text-white' : 'bg-panel-2 text-muted'} ${n === last ? 'ring-2 ring-white ring-offset-1 ring-offset-panel' : ''}`}
                style={on ? { background: colorOf(n) } : undefined}
              >
                {n}
              </div>
            );
          }),
        )}
      </div>
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
  // const winnerName = (w: Winner) =>
  //   // Automated players have names but are always labelled as automated.
  //   w.automated ? t('automatedPlayer', { name: w.name }) : w.sampleNo ? t(state.room.houseCash ? 'housePlayer' : 'samplePlayer', { n: w.sampleNo }) : w.name;
  const winnerName = (w: Winner) =>
    // Automated winners use the name from the list (sent by the server), with the 🤖 automated label.
    w.automated
      ? t('automatedPlayer', { name: w.name })
      : w.sampleNo
        ? t(state.room.houseCash ? 'housePlayer' : 'samplePlayer', { n: w.sampleNo })
        : w.name;
  return (
    <div className="winner-glow flex min-h-[70vh] flex-col items-center gap-4 px-4 py-6">
      {myWins.length > 0 && (
        <div className="pop w-full rounded-2xl bg-win px-4 py-3 text-center font-display text-lg text-white">
          {state.room.practice ? t('practiceWin') : t('youWon', { amount: won.toLocaleString('en-US') })}
        </div>
      )}
      {state.room.houseCash && result.winners.some((w) => w.sampleNo) && (
        <p className="text-center text-sm text-muted">{t('housePrizeReturned')}</p>
      )}
      {result.winners.length === 1 ? (
        <>
          <span className="rounded-full bg-gold px-5 py-1.5 text-xs font-black uppercase tracking-[0.25em] text-gold-ink shadow-lg">{t('grandWinner')}</span>
          <p className="font-display text-4xl italic text-gold">BINGO!</p>
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-gold/80">— {t('winnerIs')} —</p>
            <p className="font-display text-3xl uppercase">{winnerName(result.winners[0])}</p>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">
              {t('ticket')} #{result.winners[0].cardNo}{!state.room.practice && ` · ${result.prizePerWinner.birr} ETB`}
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
            {!state.room.practice && (
              <div className="flex justify-between py-3 text-xs font-black uppercase tracking-wider text-muted">
                <span>{t('prizePerWinner')}</span>
                <span className="font-display text-xl text-gold">{result.prizePerWinner.birr} ETB</span>
              </div>
            )}
          </div>
          <div className={`grid w-full gap-3 ${result.winners.length > 1 ? 'grid-cols-2' : ''}`}>
            {result.winners.map((w) => (
              <div key={w.cardNo} className="flex min-w-0 flex-col gap-1.5">
                <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${mine.includes(w.cardNo) ? 'border-gold bg-gold/10' : 'border-line bg-panel'}`}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gold text-sm font-black text-gold-ink">{winnerName(w).slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 leading-tight">
                    <span className={`block text-sm font-bold ${w.sampleNo && state.room.houseCash ? '' : 'truncate'}`}>{winnerName(w)}</span>
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
      {!state.room.houseCash && <p className="text-xs text-muted">{t('nextRoundIn', { s: Math.max(0, Math.ceil(left / 1000)) })}</p>}
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
      {!state.room.houseCash && <p className="text-xs text-muted">{t('nextRoundIn', { s: Math.max(0, Math.ceil(left / 1000)) })}</p>}
    </div>
  );
}
