import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, api, session, type Balances, type RoomState } from '../api';

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
  const [closed, setClosed] = useState(false);
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
      socket.emit('join', { roomId }, (response?: { ok: boolean }) => {
        if (response?.ok === false) {
          setClosed(true);
          setState(null);
        }
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (s: RoomState | null) => {
      if (!s) {
        setClosed(true);
        setState(null);
        return;
      }
      setClosed(false);
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

  /**
   * Instant feedback: a tapped card turns gold (or back) at once, before the server answers.
   * `pending` holds what the player asked for and is waiting on; the server's answer replaces it.
   */
  const [pending, setPending] = useState<Map<number, 'add' | 'remove'>>(new Map());
  const inFlight = useRef(0);
  const stale = useRef(false);
  const setPendingFor = (n: number, op: 'add' | 'remove' | null) =>
    setPending((p) => {
      const next = new Map(p);
      if (op) next.set(n, op);
      else next.delete(n);
      return next;
    });

  const shown = useMemo(() => {
    const set = new Set(mine);
    for (const [n, op] of pending) {
      if (op === 'add') set.add(n);
      else set.delete(n);
    }
    return [...set].sort((a, b) => a - b);
  }, [mine, pending]);

  /** Takes the card, or gives it back if it is already yours. Throws ApiError for the caller to show. */
  const toggle = useCallback(
    async (cardNo: number) => {
      if (pending.has(cardNo)) return;
      const giveBack = shown.includes(cardNo);
      setPendingFor(cardNo, giveBack ? 'remove' : 'add');
      inFlight.current++;
      try {
        const r = giveBack
          ? await api<{ cards: number[] }>(`/rooms/${roomId}/cards/${cardNo}`, { method: 'DELETE' })
          : await api<{ cards: number[] }>(`/rooms/${roomId}/cards`, { body: { cardNos: [cardNo] } });
        // With several taps in flight the answers can arrive out of order, so an answer is only trusted
        // when it is the last one; otherwise the list is fetched again once all of them are back.
        if (inFlight.current === 1) setMine(r.cards);
        else stale.current = true;
      } catch (e) {
        stale.current = true;
        throw e;
      } finally {
        inFlight.current--;
        setPendingFor(cardNo, null);
        if (inFlight.current === 0 && stale.current) {
          stale.current = false;
          void refreshMine();
        }
      }
    },
    [pending, shown, roomId, refreshMine],
  );

  const busy = useMemo(() => new Set(pending.keys()), [pending]);
  const now = () => Date.now() + offset.current;
  return { state, mine: shown, layouts, connected, closed, busy, toggle, now };
}

/** Re-renders every `ms` so countdowns tick. */
export function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
