import { createHash } from 'node:crypto';

/** 25 numbers, row by row. Index 12 (the centre) is 0 and means FREE. */
export type CardLayout = number[];

export const LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;
export const FREE = 0;
export const MAX_BALL = 75;

/** The 12 winning lines as cell indexes: 5 rows, 5 columns (B..O), then the two diagonals. */
export const LINES: readonly (readonly number[])[] = (() => {
  const lines: number[][] = [];
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return lines;
})();

export function letterOf(ball: number): string {
  return LETTERS[Math.floor((ball - 1) / 15)];
}

/** Small deterministic PRNG (mulberry32). Only used to lay out the fixed card set, never to draw balls. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(setSeed: string, attempt: number): number {
  return createHash('sha256').update(`${setSeed}:${attempt}`).digest().readUInt32BE(0);
}

function layoutFrom(rand: () => number): CardLayout {
  const cells = new Array<number>(25);
  for (let c = 0; c < 5; c++) {
    const pool: number[] = [];
    for (let n = c * 15 + 1; n <= c * 15 + 15; n++) pool.push(n);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let r = 0; r < 5; r++) cells[r * 5 + c] = pool[r];
  }
  cells[12] = FREE;
  return cells;
}

/**
 * The numbered card set. Card N always has the same 25 numbers for a given `setSeed`, and no two cards are
 * identical. Changing the seed changes every card, so keep it fixed once players have seen the cards.
 */
export function generateCardSet(size: number, setSeed: string): CardLayout[] {
  const cards: CardLayout[] = [];
  const seen = new Set<string>();
  let attempt = 0;
  while (cards.length < size) {
    const layout = layoutFrom(mulberry32(seedFor(setSeed, attempt++)));
    const key = layout.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(layout);
  }
  return cards;
}

/** Indexes of every complete line on the card, given the balls called so far. */
export function completeLines(layout: CardLayout, called: ReadonlySet<number>): number[] {
  const result: number[] = [];
  LINES.forEach((line, index) => {
    if (line.every((cell) => layout[cell] === FREE || called.has(layout[cell]))) result.push(index);
  });
  return result;
}

export function lineName(index: number): string {
  if (index < 5) return `row ${index + 1}`;
  if (index < 10) return `${LETTERS[index - 5]} column`;
  return index === 10 ? 'diagonal ↘' : 'diagonal ↙';
}
