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
  automatedAnnounced: number;
  automatedCards: number;
  automatedPlayers: number;
  automatedSkipped: number;
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
                <td className="num px-4 py-2 text-right">
                  {r.cardsSold}
                  {r.automatedAnnounced > 0 && (
                    <span className="block text-[11px] text-muted">
                      {r.automatedPlayers} automated · {r.automatedCards} cards{r.automatedSkipped > 0 && <span className="text-bad"> · {r.automatedSkipped} skipped (bankroll)</span>}
                    </span>
                  )}
                </td>
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
  automatedEnabled: boolean;
  automatedMinPlayers: number;
  automatedPlayers: number;
  automatedMaxCards: number;
}

export function Settings() {
  const rooms = useApi<Room[]>('/admin/rooms');
  const audit = useApi<AuditRow[]>('/admin/audit', 30_000);
  return (
    <div className="flex flex-col gap-4">
      <ErrorLine error={rooms.error} />
      {rooms.data?.map((r) => (
        <RoomForm
          key={r.id}
          room={r}
          onSaved={() => {
            rooms.reload();
            audit.reload();
          }}
        />
      ))}
      <HouseBankroll onChanged={audit.reload} />
      <AuditLog rows={audit.data} error={audit.error} />
    </div>
  );
}

interface AuditRow {
  id: string;
  at: string;
  action: string;
  targetType: string;
  targetId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  staff: { name: string; username: string | null; telegramId: string };
}

const ACTION_LABEL: Record<string, string> = {
  ROOM_AUTOMATED_PLAYERS: 'Automated players changed',
  ROOM_UPDATE: 'Room settings changed',
  BANKROLL_FUND: 'Bankroll funded',
  BANKROLL_WITHDRAW: 'Bankroll withdrawal',
};

/** Shows only the fields that changed, as "field: before → after". */
function changes(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const show = (v: unknown) => (v === undefined || v === null ? '—' : String(v));
  return keys
    .filter((k) => !before || show(before[k]) !== show(after?.[k]))
    .map((k) => (before ? `${k}: ${show(before[k])} → ${show(after?.[k])}` : `${k}: ${show(after?.[k])}`));
}

function AuditLog({ rows, error }: { rows: AuditRow[] | null; error: string | null }) {
  return (
    <Panel title="Audit trail (automated players, room settings, bankroll)">
      <ErrorLine error={error} />
      {rows?.length === 0 && <Empty>No changes recorded yet.</Empty>}
      <ul className="divide-y divide-line text-sm">
        {rows?.map((r) => (
          <li key={r.id} className="flex flex-col gap-0.5 px-4 py-2">
            <span>
              <span className="font-semibold">{ACTION_LABEL[r.action] ?? r.action}</span>{' '}
              <span className="text-muted">
                · {r.targetType} {r.targetId} · {r.staff.name}
                {r.staff.username ? ` @${r.staff.username}` : ''} ({r.staff.telegramId}) · {fmtDate(r.at)}
              </span>
            </span>
            <span className="num text-xs text-muted">{changes(r.before, r.after).join(' · ')}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

interface BankrollView {
  balance: Money;
  recent: { id: string; type: string; description: string; createdAt: string; metadata: { amountMinor?: string } | null }[];
}

/** Operator cash that pays automated players' stakes. Recording a transfer updates the books; it does not move money. */
function HouseBankroll({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const view = useApi<BankrollView>('/admin/house-bankroll', 15_000);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const move = async (direction: 'funding' | 'withdrawal') => {
    setBusy(true);
    try {
      await api(`/admin/house-bankroll/${direction}`, { body: { amountBirr: amount, bankReference: reference } });
      toast(direction === 'funding' ? `Recorded ${amount} birr into the bankroll.` : `Recorded ${amount} birr out of the bankroll.`);
      setAmount('');
      setReference('');
      view.reload();
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="House bankroll (pays automated players' cards)" action={view.data && <Birr m={view.data.balance} />}>
      <ErrorLine error={view.error} />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted">
          Keep this money separate from player funds. Record each real bank transfer here with its bank reference; recording does not move money.
          Automated entries that the bankroll cannot pay for are skipped.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto_auto]">
          <input inputMode="numeric" placeholder="Amount (birr)" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} className={field} aria-label="Amount in birr" />
          <input placeholder="Bank reference" value={reference} onChange={(e) => setReference(e.target.value)} className={field} aria-label="Bank reference" />
          <Button tone="primary" disabled={busy || !amount || reference.length < 3} onClick={() => void move('funding')}>
            Record funding
          </Button>
          <Button disabled={busy || !amount || reference.length < 3} onClick={() => void move('withdrawal')}>
            Record withdrawal
          </Button>
        </div>
        {view.data && view.data.recent.length > 0 && (
          <ul aria-label="Recent bankroll records" className="divide-y divide-line border-t border-line text-xs text-muted">
            {view.data.recent.map((r) => (
              <li key={r.id} className="py-2">
                {r.type === 'HOUSE_WITHDRAWAL' ? '−' : '+'}
                {r.metadata?.amountMinor ? Number(r.metadata.amountMinor) / 100 : '?'} ETB · {r.description} · {fmtDate(r.createdAt)}
              </li>
            ))}
          </ul>
        )}
      </div>
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
    automatedEnabled: room.automatedEnabled,
    automatedMinPlayers: room.automatedMinPlayers,
    automatedPlayers: room.automatedPlayers,
    automatedMaxCards: room.automatedMaxCards,
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
          automatedEnabled: f.automatedEnabled,
          automatedMinPlayers: f.automatedMinPlayers,
          automatedPlayers: f.automatedPlayers,
          automatedMaxCards: f.automatedMaxCards,
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
        <fieldset className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">House-funded automated players</legend>
          <label className="flex items-center gap-2 text-sm font-semibold" htmlFor={`${room.id}-automated`}>
            <input
              id={`${room.id}-automated`}
              type="checkbox"
              checked={f.automatedEnabled}
              onChange={(e) => set('automatedEnabled', e.target.checked)}
              className="h-4 w-4 accent-[var(--gold)]"
            />
            Automated players join each round (only where your licence allows it)
          </label>
          {f.automatedEnabled && (
            <div className="grid gap-4 sm:grid-cols-3">
              {num('automatedMinPlayers', 'Automated players per round: from', 'Each round picks a random number in this range.', 0, f.automatedPlayers)}
              {num(
                'automatedPlayers',
                'Automated players per round: to',
                `${f.automatedMinPlayers === f.automatedPlayers ? `Always ${f.automatedPlayers}` : `${f.automatedMinPlayers} to ${f.automatedPlayers}`} per round. They join when each countdown starts.`,
                1,
                Math.min(500, f.cardPool - 1),
              )}
              {num(
                'automatedMaxCards',
                'Most cards per automated player',
                `Each takes 1 to ${f.automatedMaxCards} cards at random (up to ${f.automatedPlayers * f.automatedMaxCards * f.stakeBirr} birr per round from the bankroll). At most ${f.maxCardsPerPlayer}, like real players.`,
                1,
                f.maxCardsPerPlayer,
              )}
            </div>
          )}
          <span className="text-xs text-muted">
            Players see this before buying and must confirm it. Automated cards are in the same prize pool with the same chance to win; their prizes go to the bankroll.
            Off by default. Every change is recorded in the audit trail.
          </span>
        </fieldset>
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
