import { useEffect, useRef, useState } from 'react';

/**
 * Announces each called ball ("ቢ አምስት" for B5) from recorded clips in public/sounds/am/:
 * b1.mp3 … b15.mp3, i16.mp3 … i30.mp3, n31.mp3 … n45.mp3, g46.mp3 … g60.mp3, o61.mp3 … o75.mp3.
 * A missing clip is skipped silently, so the game works before the recordings exist.
 *
 * Uses the Web Audio API: clips are decoded once and play instantly. Phones only allow sound after the
 * player has touched the screen, so the audio engine is unlocked on the first tap (picking a card counts).
 */
const BASE = `${import.meta.env.BASE_URL}sounds/am/`;
const LETTERS = ['b', 'i', 'n', 'g', 'o'];
export const clipFile = (n: number) => `${LETTERS[Math.floor((n - 1) / 15)]}${n}.mp3`;

const STORAGE_KEY = 'bingo.sound';

class Caller {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<number, Promise<AudioBuffer | null>>();
  private current: AudioBufferSourceNode | null = null;
  enabled = true;

  constructor() {
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      /* storage blocked: keep the default */
    }
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.audio();
        void this.ctx?.resume();
      };
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock);
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    if (!on) this.stop();
  }

  private audio(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  private load(n: number): Promise<AudioBuffer | null> {
    let p = this.buffers.get(n);
    if (!p) {
      p = fetch(BASE + clipFile(n))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((data) => {
          const ctx = this.audio();
          return data && ctx ? ctx.decodeAudioData(data) : null;
        })
        .catch(() => null);
      this.buffers.set(n, p);
    }
    return p;
  }

  /** Loads clips ahead of time so the first calls are not late. */
  preload(numbers: number[]) {
    for (const n of numbers) void this.load(n);
  }

  async play(n: number) {
    if (!this.enabled) return;
    const ctx = this.audio();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    const buffer = await this.load(n);
    if (!buffer || !this.enabled) return;
    this.stop();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    this.current = source;
  }

  stop() {
    try {
      this.current?.stop();
    } catch {
      /* already stopped */
    }
    this.current = null;
  }
}

export const caller = new Caller();

/** Calls out every new ball while the round is drawing. Balls called before the player arrived stay silent. */
export function useCaller(roundId: string, status: string, calls: number[]) {
  const seen = useRef<{ round: string; count: number } | null>(null);

  useEffect(() => {
    // Warm up all 75 clips while players pick their cards.
    if (status === 'SELECTING') caller.preload(Array.from({ length: 75 }, (_, i) => i + 1));
  }, [status]);

  useEffect(() => {
    const prev = seen.current;
    seen.current = { round: roundId, count: calls.length };
    if (status !== 'DRAWING' || !prev || prev.round !== roundId || calls.length <= prev.count) return;
    void caller.play(calls[calls.length - 1]);
  }, [roundId, status, calls]);
}

export function useSoundSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(caller.enabled);
  return [
    on,
    (v: boolean) => {
      caller.setEnabled(v);
      setOn(v);
    },
  ];
}
