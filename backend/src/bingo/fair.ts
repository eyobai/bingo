import { createHash, createHmac, randomBytes } from 'node:crypto';
import { MAX_BALL } from './cards';

/**
 * Provably fair ball order (commit and reveal).
 *
 * Before any card is sold the server picks a random secret and shows players only its SHA-256 hash.
 * The ball order is derived from that secret, so it is fixed before anyone buys a card. When the round
 * ends the secret is published; anyone can hash it to check it matches, and re-derive the order.
 */
export function newServerSeed(): { serverSeed: string; seedHash: string } {
  const serverSeed = randomBytes(32).toString('hex');
  return { serverSeed, seedHash: hashSeed(serverSeed) };
}

export function hashSeed(serverSeed: string): string {
  return createHash('sha256').update(serverSeed).digest('hex');
}

/** Uniform integer in [0, max) from HMAC-SHA256(seed, "<roundNumber>:<counter>"), with rejection sampling. */
function uniform(seed: string, roundNumber: number, counter: { n: number }, max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  for (;;) {
    const value = createHmac('sha256', seed).update(`${roundNumber}:${counter.n++}`).digest().readUInt32BE(0);
    if (value < limit) return value % max;
  }
}

/** All 75 balls in the order they will be called (Fisher-Yates driven by the seed). */
export function ballOrder(serverSeed: string, roundNumber: number): number[] {
  const balls = Array.from({ length: MAX_BALL }, (_, i) => i + 1);
  const counter = { n: 0 };
  for (let i = balls.length - 1; i > 0; i--) {
    const j = uniform(serverSeed, roundNumber, counter, i + 1);
    [balls[i], balls[j]] = [balls[j], balls[i]];
  }
  return balls;
}
