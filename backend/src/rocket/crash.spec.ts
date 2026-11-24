import { crashX100, effectiveAutoX100, msUntil, newRocketSeed, payoutFor, sha256, x100At } from './crash';

describe('Leyu Rocket maths', () => {
  it('is reproducible from the revealed seed and matches the published hash', () => {
    const { serverSeed, seedHash } = newRocketSeed();
    expect(sha256(serverSeed)).toBe(seedHash);
    expect(crashX100(serverSeed, 42, 300, 10_000)).toBe(crashX100(serverSeed, 42, 300, 10_000));
    expect(crashX100(serverSeed, 42, 300, 10_000)).not.toBe(crashX100(serverSeed, 43, 300, 10_000) + 0.5);
  });

  it('never goes below 1.00× or above the cap', () => {
    for (let i = 0; i < 2000; i++) {
      const x = crashX100('seed-' + i, i, 300, 5000);
      expect(x).toBeGreaterThanOrEqual(100);
      expect(x).toBeLessThanOrEqual(5000);
    }
  });

  it('returns about (1 − edge) on average for any cash-out target', () => {
    const n = 200_000;
    const crashes = Array.from({ length: n }, (_, i) => crashX100('rtp-seed', i, 300, 100_000));
    for (const target of [150, 200, 500, 1000]) {
      const wins = crashes.filter((c) => c >= target).length;
      const rtp = (wins * target) / 100 / n;
      expect(rtp).toBeGreaterThan(0.94);
      expect(rtp).toBeLessThan(1.0);
    }
    // Roughly 3% of rounds crash instantly at 1.00×.
    const instant = crashes.filter((c) => c === 100).length / n;
    expect(instant).toBeGreaterThan(0.02);
    expect(instant).toBeLessThan(0.045);
  });

  it('climbs smoothly and the timing helpers agree', () => {
    expect(x100At(0)).toBe(100);
    expect(x100At(msUntil(200))).toBeGreaterThanOrEqual(200);
    expect(x100At(msUntil(200) - 50)).toBeLessThan(200);
    expect(msUntil(1000)).toBeGreaterThan(35_000);
  });

  it('caps a win and turns the cap into an automatic cash-out point', () => {
    expect(payoutFor(10_000n, 250, 1_000_000n)).toBe(25_000n); // 100 birr × 2.5 = 250 birr
    expect(payoutFor(100_000n, 2000, 1_000_000n)).toBe(1_000_000n); // capped at 10,000 birr
    expect(effectiveAutoX100(100_000n, null, 1_000_000n)).toBe(1000); // 1,000 birr bet: cap hit at 10×
    expect(effectiveAutoX100(100_000n, 300, 1_000_000n)).toBe(300);
  });
});
