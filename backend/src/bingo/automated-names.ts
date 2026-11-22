import { createHash } from 'node:crypto';

/**
 * Display names for automated players: common Ethiopian names, men and women. They are always shown with the
 * automated label (🤖 … (automated)) so nobody mistakes them for real people.
 */
export const AUTOMATED_NAMES: { en: string; am: string }[] = [
  { en: 'Abebe', am: 'አበበ' },
  { en: 'Almaz', am: 'አልማዝ' },
  { en: 'Dawit', am: 'ዳዊት' },
  { en: 'Tigist', am: 'ትግስት' },
  { en: 'Yonas', am: 'ዮናስ' },
  { en: 'Hirut', am: 'ሂሩት' },
  { en: 'Bereket', am: 'በረከት' },
  { en: 'Meseret', am: 'መሰረት' },
  { en: 'Tesfaye', am: 'ተስፋዬ' },
  { en: 'Selamawit', am: 'ሰላማዊት' },
  { en: 'Kebede', am: 'ከበደ' },
  { en: 'Hana', am: 'ሀና' },
  { en: 'Biruk', am: 'ብሩክ' },
  { en: 'Liya', am: 'ሊያ' },
  { en: 'Girma', am: 'ግርማ' },
  { en: 'Chaltu', am: 'ጫልቱ' },
  { en: 'Gemechu', am: 'ገመቹ' },
  { en: 'Genet', am: 'ገነት' },
  { en: 'Kidus', am: 'ቅዱስ' },
  { en: 'Lemlem', am: 'ለምለም' },
];

/**
 * The name of automated player `owner` (1, 2, …) in a round. Each round gets its own random-looking order from
 * the round id, so names change between rounds but stay the same within one (also after a restart). Players in
 * the same round never share a name; past the list, a number is added (Abebe 2).
 */
export function automatedName(roundId: string, owner: number): { en: string; am: string } {
  const n = AUTOMATED_NAMES.length;
  const order = Array.from({ length: n }, (_, i) => i);
  const seed = createHash('sha256').update(roundId).digest();
  for (let i = n - 1; i > 0; i--) {
    const j = seed.readUInt16BE((i * 2) % (seed.length - 1)) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const base = AUTOMATED_NAMES[order[(owner - 1) % n]];
  const lap = Math.floor((owner - 1) / n);
  return lap ? { en: `${base.en} ${lap + 1}`, am: `${base.am} ${lap + 1}` } : base;
}
