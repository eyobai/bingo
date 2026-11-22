import { AUTOMATED_NAMES, automatedName } from './automated-names';
import { FREE, LINES, completeLines, generateCardSet } from './cards';
import { ballOrder, hashSeed, newServerSeed } from './fair';
import { settle } from './prize';

describe('card set', () => {
  const cards = generateCardSet(400, 'test-seed');

  it('is the same every time for the same seed', () => {
    expect(generateCardSet(400, 'test-seed')).toEqual(cards);
    expect(generateCardSet(5, 'other-seed')[0]).not.toEqual(cards[0]);
  });

  it('puts each column in its range, with no repeats and a free centre', () => {
    for (const card of cards) {
      expect(card[12]).toBe(FREE);
      expect(new Set(card.filter((n) => n !== FREE)).size).toBe(24);
      card.forEach((n, i) => {
        if (i === 12) return;
        const col = i % 5;
        expect(n).toBeGreaterThanOrEqual(col * 15 + 1);
        expect(n).toBeLessThanOrEqual(col * 15 + 15);
      });
    }
  });

  it('has no two identical cards', () => {
    expect(new Set(cards.map((c) => c.join(','))).size).toBe(cards.length);
  });
});

describe('completeLines', () => {
  const card = generateCardSet(1, 'lines')[0];

  it('finds nothing on an empty board', () => {
    expect(completeLines(card, new Set())).toEqual([]);
  });

  it('finds every one of the 12 lines', () => {
    LINES.forEach((line, index) => {
      const called = new Set(line.map((i) => card[i]).filter((n) => n !== FREE));
      expect(completeLines(card, called)).toContain(index);
    });
  });

  it('counts the free centre as marked', () => {
    const middleRow = LINES[2].map((i) => card[i]).filter((n) => n !== FREE);
    expect(middleRow).toHaveLength(4);
    expect(completeLines(card, new Set(middleRow))).toEqual([2]);
  });
});

describe('ball order', () => {
  it('is a permutation of 1..75 fixed by the seed', () => {
    const { serverSeed, seedHash } = newServerSeed();
    expect(hashSeed(serverSeed)).toBe(seedHash);
    const order = ballOrder(serverSeed, 7);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 75 }, (_, i) => i + 1));
    expect(ballOrder(serverSeed, 7)).toEqual(order);
    expect(ballOrder(serverSeed, 8)).not.toEqual(order);
  });
});

describe('settle', () => {
  it('pays stakes minus the house cut to a single winner', () => {
    expect(settle({ stakeTotalMinor: 547_000n, houseCutBps: 2000, guaranteedMinor: 0n, winners: 1 })).toEqual({
      prizeMinor: 437_600n,
      topUpMinor: 0n,
      houseCutMinor: 109_400n,
      prizePerWinnerMinor: 437_600n,
    });
  });

  it('splits between winners and gives the remainder to the house', () => {
    const s = settle({ stakeTotalMinor: 100_000n, houseCutBps: 2000, guaranteedMinor: 0n, winners: 3 });
    expect(s.prizePerWinnerMinor).toBe(26_666n);
    expect(s.prizeMinor).toBe(79_998n);
    expect(s.houseCutMinor).toBe(20_002n);
    expect(s.prizeMinor + s.houseCutMinor).toBe(100_000n);
  });

  it('gives up the house cut first, then tops up, to reach a guarantee', () => {
    // 80 cards x 10 birr = 800 birr; guarantee 1,000 birr -> platform adds 200, keeps nothing.
    const low = settle({ stakeTotalMinor: 80_000n, houseCutBps: 2000, guaranteedMinor: 100_000n, winners: 1 });
    expect(low).toMatchObject({ prizeMinor: 100_000n, topUpMinor: 20_000n, houseCutMinor: 0n });
    // 110 cards = 1,100 birr; normal prize 880 < 1,000 -> house keeps 100 instead of 220.
    const mid = settle({ stakeTotalMinor: 110_000n, houseCutBps: 2000, guaranteedMinor: 100_000n, winners: 1 });
    expect(mid).toMatchObject({ prizeMinor: 100_000n, topUpMinor: 0n, houseCutMinor: 10_000n });
    // 200 cards: the guarantee no longer matters.
    const high = settle({ stakeTotalMinor: 200_000n, houseCutBps: 2000, guaranteedMinor: 100_000n, winners: 1 });
    expect(high).toMatchObject({ prizeMinor: 160_000n, topUpMinor: 0n, houseCutMinor: 40_000n });
  });

  it('pays a sole real winner the whole pool after the cut, including automated players\' stakes', () => {
    // 50 automated + 10 real players, one 10-birr card each: 600 birr pool, 20% house cut.
    expect(settle({ stakeTotalMinor: 60n * 1000n, houseCutBps: 2000, guaranteedMinor: 0n, winners: 1 })).toMatchObject({
      prizeMinor: 48_000n,
      prizePerWinnerMinor: 48_000n,
      houseCutMinor: 12_000n,
    });
  });
});

describe('automated player names', () => {
  it('has at least 10 names and gives players in one round different names', () => {
    expect(AUTOMATED_NAMES.length).toBeGreaterThanOrEqual(10);
    const names = Array.from({ length: AUTOMATED_NAMES.length }, (_, i) => automatedName('round-a', i + 1).en);
    expect(new Set(names).size).toBe(AUTOMATED_NAMES.length);
    expect(automatedName('round-a', 3)).toEqual(automatedName('round-a', 3)); // stable within a round
    const other = Array.from({ length: 5 }, (_, i) => automatedName('round-b', i + 1).en);
    expect(other).not.toEqual(names.slice(0, 5)); // shuffled per round
    expect(automatedName('round-a', AUTOMATED_NAMES.length + 1).en).toMatch(/ 2$/);
  });
});
