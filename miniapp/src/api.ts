export interface Money {
  minor: string;
  birr: string;
}

export interface Balances {
  main: Money;
  play: Money;
  pendingWithdrawal: Money;
  total: Money;
}

export interface User {
  id: string;
  firstName: string;
  username: string | null;
  language: 'am' | 'en' | 'om';
  role: 'PLAYER' | 'ADMIN';
  referralCode: string;
  inviteLink: string | null;
  memberSince: string;
}

export type RoundStatus = 'SELECTING' | 'DRAWING' | 'FINISHED' | 'CANCELLED';

export interface Winner {
  cardNo: number;
  name: string;
  lineIndex: number;
  layout: number[];
  /** Card of a test player: the prize share is carried to the next round. */
  test?: boolean;
}

export interface RoomState {
  serverTime: string;
  /** The server is in TEST MODE: test players may be in the game. */
  testMode?: boolean;
  room: {
    id: string;
    name: string;
    stake: Money;
    cardPool: number;
    maxCardsPerPlayer: number;
    selectSeconds: number;
    callIntervalMs: number;
    guaranteedPrize: Money;
  };
  round: {
    id: string;
    number: number;
    status: RoundStatus;
    seedHash: string;
    serverSeed: string | null;
    selectEndsAt: string;
    startedAt: string | null;
    calls: number[];
    cardsSold: number;
    players: number;
    prize: Money;
    taken: number[];
    /** Test mode: how many of the players are test players, and which taken cards are theirs. */
    testPlayers?: number;
    testTaken?: number[];
    /** Money carried over from test players' wins, already included in the prize. */
    carriedIn?: Money;
  };
  result: { prizePerWinner: Money; nextRoundAt: string; winners: Winner[]; carriedOver?: Money } | null;
  cancelled: { reason: string; nextRoundAt: string } | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

let token = '';
try {
  token = sessionStorage.getItem('bingo.token') ?? '';
} catch {
  /* storage blocked: stay signed out until the next sign-in */
}

export const session = {
  get token() {
    return token;
  },
  set(t: string) {
    token = t;
    try {
      sessionStorage.setItem('bingo.token', t);
    } catch {
      /* ignore */
    }
  },
  clear() {
    token = '';
    try {
      sessionStorage.removeItem('bingo.token');
    } catch {
      /* ignore */
    }
  },
};

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection. Check your internet and try again.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? 'Something went wrong.', data?.details ?? {});
  }
  return data as T;
}
