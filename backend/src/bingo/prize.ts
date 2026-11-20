export interface SettlementInput {
  /** Everything players paid for cards this round. */
  stakeTotalMinor: bigint;
  /** House cut in basis points (2000 = 20%). */
  houseCutBps: number;
  /** Minimum prize the platform promises. 0 = no guarantee. */
  guaranteedMinor: bigint;
  winners: number;
}

export interface Settlement {
  /** Total paid to winners. */
  prizeMinor: bigint;
  /** What the platform adds from its promotions budget to reach the guarantee. */
  topUpMinor: bigint;
  /** What the platform keeps, including the rounding remainder of the split. */
  houseCutMinor: bigint;
  prizePerWinnerMinor: bigint;
}

/**
 * Prize for a finished round.
 *
 * Normal case: the prize is the stakes minus the house cut. With a guarantee the prize is never lower than
 * the guarantee: the house first gives up its cut, then tops up from promotions. The prize is split equally
 * between winning cards; the indivisible remainder (a few santim) goes to the house.
 */
export function settle(input: SettlementInput): Settlement {
  const { stakeTotalMinor: stake, houseCutBps, guaranteedMinor, winners } = input;
  if (winners < 1) throw new Error('settle() needs at least one winner');
  if (houseCutBps < 0 || houseCutBps > 10_000) throw new Error('houseCutBps must be 0..10000');

  const normalCut = (stake * BigInt(houseCutBps)) / 10_000n;
  let pool = stake - normalCut;
  let topUp = 0n;
  if (guaranteedMinor > pool) {
    pool = guaranteedMinor;
    if (guaranteedMinor > stake) topUp = guaranteedMinor - stake;
  }
  const perWinner = pool / BigInt(winners);
  const prize = perWinner * BigInt(winners);
  const houseCut = stake + topUp - prize;
  return { prizeMinor: prize, topUpMinor: topUp, houseCutMinor: houseCut, prizePerWinnerMinor: perWinner };
}
