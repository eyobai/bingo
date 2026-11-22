import type { CSSProperties } from 'react';

export const LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;
const LETTER_COLOR = ['var(--color-ball-b)', 'var(--color-ball-i)', 'var(--color-ball-n)', 'var(--color-ball-g)', 'var(--color-ball-o)'];

export const letterIndex = (n: number) => Math.floor((n - 1) / 15);
export const letterOf = (n: number) => LETTERS[letterIndex(n)];
export const colorOf = (n: number) => LETTER_COLOR[letterIndex(n)];

export const LINES: number[][] = (() => {
  const lines: number[][] = [];
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return lines;
})();

/** Small called-ball chip: "G 46" in a ring of the column colour. */
export function BallChip({ n, size = 34 }: { n: number; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center gap-0.5 rounded-full border-2 bg-[#0d1424] font-bold tabular-nums"
      style={{ width: size, height: size, borderColor: colorOf(n), fontSize: size * 0.3 }}
    >
      <span style={{ color: colorOf(n) }}>{letterOf(n)}</span>
      <span>{n}</span>
    </span>
  );
}

/** The big white ball that shows the current call. */
export function BigBall({ n, size = 64 }: { n: number | null; size?: number }) {
  return (
    <div
      key={n ?? 'none'}
      className={`ball-white ${n ? 'pop' : ''} flex shrink-0 flex-col items-center justify-center rounded-full`}
      style={{ width: size, height: size }}
    >
      {n ? (
        <>
          <span className="font-display leading-none" style={{ color: colorOf(n), fontSize: size * 0.2 }}>
            {letterOf(n)}
          </span>
          <span className="font-display leading-none" style={{ fontSize: size * 0.42 }}>
            {n}
          </span>
        </>
      ) : (
        <span className="font-display text-xl text-gray-400">…</span>
      )}
    </div>
  );
}

/** Gold decoration ball for the jackpot box. */
export function GoldBall({ n, style }: { n: number; style?: CSSProperties }) {
  return (
    <span className="ball-gold floaty absolute flex h-7 w-7 flex-col items-center justify-center rounded-full text-[8px] font-black leading-none" style={style}>
      <span>{letterOf(n)}</span>
      <span>{n}</span>
    </span>
  );
}

/** The one number a card still needs to complete a line, or null when it needs more than one. */
export function oneAway(layout: number[] | undefined, marked: Set<number>): number | null {
  if (!layout) return null;
  for (const line of LINES) {
    const missing = line.map((i) => layout[i]).filter((n) => n !== 0 && !marked.has(n));
    if (missing.length === 1) return missing[0];
  }
  return null;
}

interface CardProps {
  cardNo: number;
  layout: number[];
  /** Numbers to show as marked. */
  marked: Set<number>;
  /** Called but not yet marked (manual mode): shown with a ring. */
  hint?: Set<number>;
  winLine?: number;
  onCell?: (n: number) => void;
  compact?: boolean;
  label?: string;
  tone?: 'mine' | 'winner' | 'plain';
  /** Number the card needs for a full line: the card glows and that square is outlined. */
  needs?: number | null;
  /** Shown in the card's header when it needs one number, e.g. "1 away: G-52". */
  needsLabel?: string;
}

export function BingoCard({ cardNo, layout, marked, hint, winLine, onCell, compact, label, tone = 'plain', needs, needsLabel }: CardProps) {
  const win = winLine !== undefined ? new Set(LINES[winLine]) : null;
  const border = needs ? 'border-gold near-glow' : tone === 'winner' ? 'border-gold' : tone === 'mine' ? 'border-gold/50' : 'border-line';
  return (
    <div className={`rounded-2xl border-2 ${border} bg-white ${compact ? 'p-1.5' : 'p-2'} text-gray-900 shadow-lg`}>
      <div className="mb-1.5 flex items-center justify-between gap-1 px-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        <span className={`truncate ${needs ? 'rounded bg-gold px-1 text-gold-ink' : ''}`}>{needs ? needsLabel : (label ?? '')}</span>
        <span className="text-gray-800">#{cardNo}</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {LETTERS.map((l, i) => (
          <div key={l} className="rounded-md py-0.5 text-center font-display text-xs text-white" style={{ background: LETTER_COLOR[i] }}>
            {l}
          </div>
        ))}
        {layout.map((n, i) => {
          const free = n === 0;
          const isMarked = free || marked.has(n);
          const isWin = win?.has(i);
          const isHint = !isMarked && hint?.has(n);
          const isNeeded = needs !== undefined && needs !== null && n === needs;
          const base = `flex aspect-square items-center justify-center rounded-lg font-bold tabular-nums ${compact ? 'text-xs' : 'text-sm'} ${isNeeded ? 'ring-2 ring-gold ring-offset-1 animate-pulse' : ''}`;
          const look = isWin
            ? 'bg-win text-white shadow-inner'
            : isMarked
              ? 'bg-gold text-gold-ink'
              : 'bg-gray-100 text-gray-800';
          const content = free ? '★' : n;
          return onCell && !free ? (
            <button
              key={i}
              type="button"
              onClick={() => onCell(n)}
              className={`${base} ${look} ${isHint ? 'ring-2 ring-sky-500 ring-offset-1' : ''}`}
              aria-label={`${letterOf(n)} ${n}${isMarked ? ', marked' : ''}`}
            >
              {content}
            </button>
          ) : (
            <div key={i} className={`${base} ${look}`}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
