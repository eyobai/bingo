import { useEffect, useState } from 'react';
import { ApiError, api, fmtDate, type Money } from '../api';
import { Badge, Birr, Button, Empty, ErrorLine, Panel, field, useApi, useToast } from '../ui';

interface RoundRow {
  number: number;
  roomId: string;
  status: string;
  cardsSold: number;
  stakes: Money;
  prize: Money;
  houseStake: Money;
  housePrize: Money;
  houseWinningCards: number[];
  houseCut: Money;
  topUp: Money;
  calls: number;
  winners: number[];
  at: string;
}

export function Rounds() {
  const list = useApi<RoundRow[]>('/admin/rounds', 10_000);
  return (
    <Panel title="Recent rounds">
      <ErrorLine error={list.error} />
      {list.data?.length === 0 && <Empty>No rounds yet.</Empty>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-2 font-semibold">Round</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 text-right font-semibold">Cards</th>
              <th className="px-4 py-2 text-right font-semibold">Stakes</th>
              <th className="px-4 py-2 text-right font-semibold">Prize</th>
              <th className="px-4 py-2 text-right font-semibold">House</th>
              <th className="px-4 py-2 font-semibold">Winning cards</th>
              <th className="px-4 py-2 font-semibold">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.data?.map((r) => (
              <tr key={r.number}>
                <td className="num px-4 py-2 font-semibold">
                  #{r.number}
                  {r.roomId === 'house-cash' && <span className="block text-[11px] text-muted">House Cash</span>}
                </td>
                <td className="px-4 py-2">
                  <Badge value={r.status} />
                </td>
                <td className="num px-4 py-2 text-right">{r.cardsSold}</td>
                <td className="px-4 py-2 text-right">
                  <Birr m={r.stakes} />
                  {r.houseStake.minor !== '0' && <span className="block text-[11px] text-muted">{r.houseStake.birr} from house bankroll</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  <Birr m={r.prize} />
                  {r.housePrize.minor !== '0' && <span className="block text-[11px] text-muted">{r.housePrize.birr} to house bankroll</span>}
                  {r.topUp.minor !== '0' && <span className="block text-[11px] text-gold">+{r.topUp.birr} top-up</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  <Birr m={r.houseCut} />
                </td>
                <td className="num px-4 py-2 text-muted">
                  {[...r.winners.map((w) => `#${w}`), ...r.houseWinningCards.map((w) => `#${w} (automated)`)].join(', ') || '—'}
                  {r.status === 'FINISHED' && <span className="block text-[11px]">on ball {r.calls}</span>}
                </td>
                <td className="px-4 py-2 text-muted">{fmtDate(r.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

interface Room {
  id: string;
  name: string;
  stakeMinor: Money;
  cardPool: number;
  maxCardsPerPlayer: number;
  selectSeconds: number;
  callIntervalMs: number;
  houseCutBps: number;
  minCards: number;
  guaranteedPrizeMinor: Money;
  isActive: boolean;
}

export function Settings() {
  const rooms = useApi<Room[]>('/admin/rooms');
  return (
    <div className="flex flex-col gap-4">
      <ErrorLine error={rooms.error} />
      <HouseBankroll />
      {rooms.data?.map((r) => <RoomForm key={r.id} room={r} onSaved={rooms.reload} />)}
    </div>
  );
}

interface BankrollView {
  enabled: boolean;
  balance: Money;
  recent: { id: string; description: string; createdAt: string; metadata: { amountMinor: string; staffId: string } }[];
}

function HouseBankroll() {
  const bankroll = useApi<BankrollView>('/admin/house-bankroll', 10_000);
  const toast = useToast();
  const [amountBirr, setAmount] = useState('');
  const [bankReference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = bankroll.data;

  const submit = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      await api('/admin/house-bankroll/funding', { body: { amountBirr, bankReference: bankReference.trim() } });
      setAmount('');
      setReference('');
      setConfirmed(false);
      bankroll.reload();
      toast('Funding recorded.');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="House Cash bankroll">
      <ErrorLine error={bankroll.error} />
      {data && (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm">Available for automated stakes: <Birr m={data.balance} /></p>
          {!data.enabled ? <p className="text-sm text-muted">New House Cash entries are disabled on the server.</p> : (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <p className="text-xs text-muted">Record cash already transferred from operator funds. This form does not move money.</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                  Amount (whole birr)
                  <input className={field} inputMode="numeric" pattern="[1-9][0-9]{0,6}" required value={amountBirr} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                  Bank transfer reference
                  <input className={field} minLength={3} maxLength={80} required value={bankReference} onChange={(e) => setReference(e.target.value)} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" required checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                I verified that operator cash arrived. No customer funds were used.
              </label>
              <div><Button tone="primary" type="submit" disabled={busy || !confirmed}>Record funding</Button></div>
            </form>
          )}
          {data.recent.length > 0 && (
            <ul className="divide-y divide-line border-t border-line text-xs text-muted">
              {data.recent.map((record) => (
                <li key={record.id} className="py-2">
                  {record.description} · {Number(record.metadata.amountMinor) / 100} ETB · {fmtDate(record.createdAt)}
                  <span className="block">Recorded by {record.metadata.staffId}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function RoomForm({ room, onSaved }: { room: Room; onSaved: () => void }) {
  const toast = useToast();
  const initial = () => ({
    name: room.name,
    stakeBirr: Number(room.stakeMinor.birr),
    cardPool: room.cardPool,
    maxCardsPerPlayer: room.maxCardsPerPlayer,
    selectSeconds: room.selectSeconds,
    callSeconds: room.callIntervalMs / 1000,
    housePercent: room.houseCutBps / 100,
    minCards: room.minCards,
    guaranteedPrizeBirr: Number(room.guaranteedPrizeMinor.birr),
    isActive: room.isActive,
  });
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setF(initial()), [room]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const prizePerCard = f.stakeBirr * (1 - f.housePercent / 100);
  const cardsToCoverGuarantee = f.guaranteedPrizeBirr > 0 ? Math.ceil(f.guaranteedPrizeBirr / Math.max(prizePerCard, 0.01)) : 0;

  const save = async () => {
    setBusy(true);
    try {
      await api(`/admin/rooms/${room.id}`, {
        method: 'PATCH',
        body: {
          name: f.name,
          stakeBirr: f.stakeBirr,
          cardPool: f.cardPool,
          maxCardsPerPlayer: f.maxCardsPerPlayer,
          selectSeconds: f.selectSeconds,
          callIntervalMs: Math.round(f.callSeconds * 1000),
          houseCutBps: Math.round(f.housePercent * 100),
          minCards: f.minCards,
          guaranteedPrizeBirr: f.guaranteedPrizeBirr,
          isActive: f.isActive,
        },
      });
      toast(`Saved. ${room.name} uses the new settings from its next round.`);
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const num = (k: keyof typeof f, label: string, hint: string, min: number, max: number, step = 1) => (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor={`${room.id}-${k}`}>
      {label}
      <input
        id={`${room.id}-${k}`}
        type="number"
        min={min}
        max={max}
        step={step}
        required
        value={f[k] as number}
        onChange={(e) => set(k, Number(e.target.value) as never)}
        className={`${field} num`}
      />
      <span className="font-normal">{hint}</span>
    </label>
  );

  return (
    <Panel
      title={
        <span>
          {room.name} <span className="font-normal text-muted">({room.id})</span>
        </span>
      }
      action={<Badge value={room.isActive ? 'APPROVED' : 'REJECTED'} label={room.isActive ? 'running' : 'switched off'} />}
    >
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor={`${room.id}-name`}>
            Name shown to players
            <input id={`${room.id}-name`} required minLength={2} maxLength={60} value={f.name} onChange={(e) => set('name', e.target.value)} className={field} />
          </label>
          {num('stakeBirr', 'Price per card (birr)', 'What one card costs.', 1, 10000)}
          {num('housePercent', 'House share (%)', `Winner gets ${100 - f.housePercent}% of all cards sold.`, 0, 50, 0.5)}
          {num('guaranteedPrizeBirr', 'Guaranteed prize (birr)', f.guaranteedPrizeBirr ? `You pay the difference while fewer than ${cardsToCoverGuarantee} cards are sold.` : '0 = off. The prize is just what players paid.', 0, 1000000)}
          {num('selectSeconds', 'Countdown to pick cards (seconds)', 'Time before the balls start.', 15, 300)}
          {num('callSeconds', 'Seconds between balls', 'How fast numbers are called.', 1, 15, 0.5)}
          {num('maxCardsPerPlayer', 'Most cards per player', 'Per round.', 1, 10)}
          {num('cardPool', 'Card numbers to choose from', 'Cards 1 to this number. Up to 1000.', 20, 1000)}
          {num('minCards', 'Fewest cards to start', 'Fewer, or under 2 players: the round is cancelled and refunded.', 1, 1000)}
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`${room.id}-active`}>
          <input id={`${room.id}-active`} type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} className="h-4 w-4 accent-[var(--gold)]" />
          Room is running (switching off lets the current round finish first)
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" type="submit" disabled={busy}>
            Save settings
          </Button>
          <span className="text-xs text-muted">Changes apply from the next round, never in the middle of one.</span>
        </div>
      </form>
    </Panel>
  );
}
