import { useState } from 'react';
import { fmtDate, type Money } from '../api';
import { Badge, Birr, ErrorLine, Panel, Stat, useApi } from '../ui';

interface Summary {
  periodDays: number;
  rounds: number;
  cardsSold: number;
  stakes: Money;
  prizesPaid: Money;
  housePlayerStakes: Money;
  housePlayerPrizes: Money;
  houseRevenue: Money;
  guaranteeTopUps: Money;
  depositsApproved: Money;
  depositBonuses: Money;
  withdrawalsPaid: Money;
  players: number;
  newPlayers: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
  owedToPlayers: Money;
  ledgerCheck: Money;
}
interface LiveRoom {
  room: { id: string; name: string; stake: Money; cardPool: number };
  round: { number: number; status: string; players: number; cardsSold: number; prize: Money; calls: number[]; selectEndsAt: string };
}

const PERIODS = [
  { days: 1, label: 'Last 24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

export function Overview({ go }: { go: (page: string) => void }) {
  const [days, setDays] = useState(1);
  const summary = useApi<Summary>(`/admin/summary?days=${days}`, 15_000);
  const live = useApi<(LiveRoom | null)[]>('/admin/live', 3_000);
  const s = summary.data;
  const booksOk = s?.ledgerCheck.minor === '0';

  return (
    <div className="flex flex-col gap-4">
      {s && !booksOk && (
        <div role="alert" className="rounded-2xl border border-bad bg-bad-soft px-4 py-3 text-sm font-semibold text-bad">
          The books do not balance (difference {s.ledgerCheck.birr} birr). Stop approving money and investigate before anything else.
        </div>
      )}

      {s && (s.pendingDeposits > 0 || s.pendingWithdrawals > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {s.pendingDeposits > 0 && (
            <button type="button" onClick={() => go('deposits')} className="rounded-2xl border border-gold bg-gold-soft px-4 py-3 text-left">
              <span className="text-2xl font-bold text-gold">{s.pendingDeposits}</span>{' '}
              <span className="font-semibold">deposit{s.pendingDeposits > 1 ? 's' : ''} waiting for approval →</span>
            </button>
          )}
          {s.pendingWithdrawals > 0 && (
            <button type="button" onClick={() => go('withdrawals')} className="rounded-2xl border border-gold bg-gold-soft px-4 py-3 text-left">
              <span className="text-2xl font-bold text-gold">{s.pendingWithdrawals}</span>{' '}
              <span className="font-semibold">withdrawal{s.pendingWithdrawals > 1 ? 's' : ''} to pay →</span>
            </button>
          )}
        </div>
      )}

      <Panel title="Live game">
        <ErrorLine error={live.error} />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {(live.data ?? []).filter(Boolean).map((l) => (
            <div key={l!.room.id} className="flex flex-col gap-2 rounded-xl bg-panel-2 p-3">
              <div className="flex items-center justify-between">
                <span className="font-bold">{l!.room.name}</span>
                <Badge value={l!.round.status} label={l!.round.status === 'SELECTING' ? 'picking cards' : l!.round.status === 'DRAWING' ? 'calling balls' : l!.round.status.toLowerCase()} />
              </div>
              <div className="num grid grid-cols-4 gap-2 text-center text-xs text-muted">
                <span>
                  <b className="block text-base text-ink">#{l!.round.number}</b>round
                </span>
                <span>
                  <b className="block text-base text-ink">{l!.round.players}</b>players
                </span>
                <span>
                  <b className="block text-base text-ink">{l!.round.cardsSold}</b>cards
                </span>
                <span>
                  <b className="block text-base text-gold">{l!.round.prize.birr}</b>prize
                </span>
              </div>
              {l!.round.status === 'DRAWING' && <p className="text-xs text-muted">Ball {l!.round.calls.length} of 75 · last {l!.round.calls.at(-1)}</p>}
            </div>
          ))}
          {live.data && live.data.filter(Boolean).length === 0 && <p className="text-sm text-muted">No room is running. Switch one on in Game settings.</p>}
        </div>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Money and players</h2>
        <div className="flex rounded-lg border border-line bg-panel p-0.5 text-xs font-semibold" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.days} type="button" onClick={() => setDays(p.days)} aria-pressed={days === p.days} className={`rounded-md px-3 py-1.5 ${days === p.days ? 'bg-nav text-nav-ink' : 'text-muted'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <ErrorLine error={summary.error} />
      {s && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="House revenue" value={<Birr m={s.houseRevenue} />} tone="gold" hint={`${s.rounds} rounds · ${s.cardsSold} cards`} />
            <Stat label="Stakes played" value={<Birr m={s.stakes} />} hint={s.housePlayerStakes.minor !== '0' ? `includes ${s.housePlayerStakes.birr} birr from house bankroll` : undefined} />
            <Stat label="Prizes paid" value={<Birr m={s.prizesPaid} />} hint={s.housePlayerPrizes.minor !== '0' ? `includes ${s.housePlayerPrizes.birr} birr to house bankroll` : undefined} />
            <Stat label="Guarantee top-ups" value={<Birr m={s.guaranteeTopUps} />} hint="paid from promotions" />
            <Stat label="Deposits approved" value={<Birr m={s.depositsApproved} />} hint={`bonuses given: ${s.depositBonuses.birr} birr`} />
            <Stat label="Withdrawals paid" value={<Birr m={s.withdrawalsPaid} />} />
            <Stat label="Players" value={s.players} hint={`${s.newPlayers} new in this period`} />
            <Stat label="Owed to players now" value={<Birr m={s.owedToPlayers} />} hint="keep at least this in your accounts" />
          </div>
          <p className={`text-xs ${booksOk ? 'text-good' : 'text-bad'}`}>
            {booksOk ? '✓ Books balance: every birr is accounted for.' : '✗ Books do not balance.'}
          </p>
        </>
      )}
      <RetiredHouseBankroll />
    </div>
  );
}

function RetiredHouseBankroll() {
  const { data, error } = useApi<{
    balance: Money;
    recent: { id: string; description: string; createdAt: string; metadata: { amountMinor?: string; staffId?: string } | null }[];
  }>('/admin/house-bankroll', 15_000);
  if (!error && (!data || (!data.recent.length && data.balance.minor === '0'))) return null;

  return (
    <Panel title="House bankroll (automated players)">
      <ErrorLine error={error} />
      {data && (
        <div className="p-4">
          <p className="text-sm">Operator balance: <Birr m={data.balance} /></p>
          {data.recent.length > 0 && (
            <ul aria-label="Recent bankroll records" className="mt-2 divide-y divide-line border-t border-line text-xs text-muted">
              {data.recent.map(({ id, description, createdAt, metadata }) => (
                <li key={id} className="py-2">
                  {description} · {fmtDate(createdAt)}
                  {metadata?.amountMinor && <> · {Number(metadata.amountMinor) / 100} ETB</>}
                  {metadata?.staffId && <span className="block">Recorded by {metadata.staffId}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
