export interface SettlementInput {
  /** Everything players paid for cards this round. */
  stakeTotalMinor: bigint;
  /** House cut in basis points (2000 = 20%). */
  houseCutBps: number;
  /** Minimum prize the platform promises. 0 = no guarantee. */
  guaranteedMinor: bigint;
  winners: number;
  /** Money carried over from earlier rounds (test players' winnings), added to this prize. */
  carryMinor?: bigint;
  /** How many of the winning cards belong to test players. Their share is carried to the next round. */
  sampleWinners?: number;
}

export interface Settlement {
  /** Total paid to winners. */
  prizeMinor: bigint;
  /** What the platform adds from its promotions budget to reach the guarantee. */
  topUpMinor: bigint;
  /** What the platform keeps, including the rounding remainder of the split. */
  houseCutMinor: bigint;
  prizePerWinnerMinor: bigint;
  /** Carry-over used in this prize. */
  carryInMinor: bigint;
  /** Test players' share, carried to the next round's prize instead of being paid out. */
  toRolloverMinor: bigint;
}

/**
 * Prize for a finished round.
 *
 * Normal case: the prize is the stakes minus the house cut. With a guarantee the prize is never lower than
 * the guarantee: the house first gives up its cut, then tops up from promotions. The prize is split equally
 * between winning cards; the indivisible remainder (a few santim) goes to the house.
 *
 * Test players (TEST_MODE): money carried over from earlier rounds is added to the prize, and a test player's
 * share is not paid to anyone: it is carried to the next round, so real players get it back.
 */
export function settle(input: SettlementInput): Settlement {
  const { stakeTotalMinor: stake, houseCutBps, guaranteedMinor, winners } = input;
  const carry = input.carryMinor ?? 0n;
  const sampleWinners = input.sampleWinners ?? 0;
  if (winners < 1) throw new Error('settle() needs at least one winner');
  if (sampleWinners < 0 || sampleWinners > winners) throw new Error('sampleWinners must be 0..winners');
  if (carry < 0n) throw new Error('carryMinor cannot be negative');
  if (houseCutBps < 0 || houseCutBps > 10_000) throw new Error('houseCutBps must be 0..10000');

  const normalCut = (stake * BigInt(houseCutBps)) / 10_000n;
  let pool = stake - normalCut;
  let topUp = 0n;
  if (guaranteedMinor > pool) {
    pool = guaranteedMinor;
    if (guaranteedMinor > stake) topUp = guaranteedMinor - stake;
  }
  // The carry-over is added after the house cut: the house takes nothing from it.
  const total = pool + carry;
  const perWinner = total / BigInt(winners);
  const prize = perWinner * BigInt(winners);
  const houseCut = stake + topUp + carry - prize;
  return {
    prizeMinor: prize,
    topUpMinor: topUp,
    houseCutMinor: houseCut,
    prizePerWinnerMinor: perWinner,
    carryInMinor: carry,
    toRolloverMinor: perWinner * BigInt(sampleWinners),
  };
}
