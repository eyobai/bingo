import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, ApiError, api, session, type Balances, type RoomState } from '../api';

const layoutCache = new Map<number, number[][]>();

/**
 * Live state of one room over socket.io, plus the player's own cards and card layouts.
 * The server pushes the full public state on every change, so the client never has to guess.
 */
export function useRoom(roomId: string, onWallet: (b: Balances) => void) {
  const [state, setState] = useState<RoomState | null>(null);
  const [mine, setMine] = useState<number[]>([]);
  const [layouts, setLayouts] = useState<number[][]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  /** server clock minus local clock, so countdowns are right even when the phone's clock is wrong. */
  const offset = useRef(0);
  const roundRef = useRef<string | null>(null);
  const onWalletRef = useRef(onWallet);
  onWalletRef.current = onWallet;

  const refreshMine = useCallback(async () => {
    if (!session.token) return;
    try {
      const r = await api<{ roundId: string | null; cards: number[] }>(`/rooms/${roomId}/my-cards`);
      if (r.roundId === roundRef.current || roundRef.current === null) setMine(r.cards);
    } catch {
      /* the next state push retries */
    }
  }, [roomId]);

  useEffect(() => {
    const socket: Socket = io(API_URL || undefined, {
      path: '/socket.io',
      auth: { token: session.token },
      transports: ['websocket', 'polling'],
    });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', { roomId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (s: RoomState | null) => {
      if (!s) return;
      offset.current = new Date(s.serverTime).getTime() - Date.now();
      if (s.round.id !== roundRef.current) {
        roundRef.current = s.round.id;
        setMine([]);
        void refreshMine();
      }
      setState(s);
    });
    socket.on('wallet', (b: Balances) => onWalletRef.current(b));
    return () => {
      socket.disconnect();
    };
  }, [roomId, refreshMine]);

  const pool = state?.room.cardPool ?? 0;
  useEffect(() => {
    if (!pool) return;
    const cached = layoutCache.get(pool);
    if (cached) return setLayouts(cached);
    void api<{ cards: number[][] }>(`/cards?pool=${pool}`).then((r) => {
      layoutCache.set(pool, r.cards);
      setLayouts(r.cards);
    });
  }, [pool]);

  const mark = (n: number, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(n);
      else next.delete(n);
      return next;
    });

  /** Takes the card, or gives it back if it is already yours. Throws ApiError for the caller to show. */
  const toggle = useCallback(
    async (cardNo: number) => {
      if (busy.has(cardNo)) return;
      mark(cardNo, true);
      try {
        const r = mine.includes(cardNo)
          ? await api<{ cards: number[] }>(`/rooms/${roomId}/cards/${cardNo}`, { method: 'DELETE' })
          : await api<{ cards: number[] }>(`/rooms/${roomId}/cards`, { body: { cardNos: [cardNo] } });
        setMine(r.cards);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CARD_TAKEN') void refreshMine();
        throw e;
      } finally {
        mark(cardNo, false);
      }
    },
    [busy, mine, roomId, refreshMine],
  );

  const now = () => Date.now() + offset.current;
  return { state, mine, layouts, connected, busy, toggle, now };
}

/** Re-renders every `ms` so countdowns tick. */
export function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
