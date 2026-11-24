import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Leyu Rocket maths.
 *
 * Crash point: from a secret server seed (its SHA-256 is published before betting) and the round number,
 * HMAC-SHA256 gives 52 random bits u ∈ [0, 1). The crash multiplier is (1 − edge) / (1 − u), floored to
 * hundredths, never below 1.00× and never above the room's maximum. For any cash-out target m, the chance
 * the rocket reaches m is (1 − edge) / m, so every strategy returns (1 − edge) on average: the house edge.
 * After the round the seed is revealed and anyone can recompute the crash point.
 */
export const E52 = 2n ** 52n;

export function newRocketSeed() {
  const serverSeed = randomBytes(32).toString('hex');
  return { serverSeed, seedHash: sha256(serverSeed) };
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The crash multiplier × 100 (e.g. 213 = 2.13×) for a seed, round number, house edge and cap. */
export function crashX100(serverSeed: string, roundNumber: number, houseEdgeBps: number, maxX100: number): number {
  const h = createHmac('sha256', serverSeed).update(`rocket:${roundNumber}`).digest('hex');
  const r = BigInt('0x' + h.slice(0, 13)); // 52 bits
  // floor(100 · (1 − edge) · E / (E − r)), computed exactly with integers.
  const x = (100n * BigInt(10_000 - houseEdgeBps) * E52) / (10_000n * (E52 - r));
  return Math.max(100, Math.min(maxX100, Number(x)));
}

/** How fast the rocket climbs: the multiplier is e^(K·t), so 2× after ~11.6 s, 10× after ~38 s. */
export const GROWTH_PER_MS = 0.00006;

/** Multiplier × 100 reached after `ms` milliseconds of flight (floored to hundredths). */
export function x100At(ms: number): number {
  return Math.max(100, Math.floor(100 * Math.exp(GROWTH_PER_MS * Math.max(0, ms)) + 1e-9));
}

/** Milliseconds of flight until the multiplier reaches `x100`. */
export function msUntil(x100: number): number {
  return x100 <= 100 ? 0 : Math.ceil(Math.log(x100 / 100) / GROWTH_PER_MS);
}

/** Win for a stake cashed out at `x100`, capped at `maxWinMinor`. */
export function payoutFor(stakeMinor: bigint, x100: number, maxWinMinor: bigint): bigint {
  const raw = (stakeMinor * BigInt(x100)) / 100n;
  return raw > maxWinMinor ? maxWinMinor : raw;
}

/** The multiplier at which a bet is cashed out automatically: its own target, or where the win hits the cap. */
export function effectiveAutoX100(stakeMinor: bigint, autoX100: number | null, maxWinMinor: bigint): number {
  const capX = Number((maxWinMinor * 100n) / stakeMinor); // win reaches the cap here
  const cap = Math.max(101, capX);
  return autoX100 ? Math.min(autoX100, cap) : cap;
}
