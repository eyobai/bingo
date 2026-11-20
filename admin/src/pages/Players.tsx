import { useState } from 'react';
import { ApiError, api, fmtDate, type Money } from '../api';
import { Badge, Birr, Button, Empty, ErrorLine, Panel, Stat, field, useApi, useToast } from '../ui';

interface Row {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  role: string;
  isBlocked: boolean;
  joinedAt: string;
  main: Money;
  play: Money;
}
interface Detail {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  role: string;
  isBlocked: boolean;
  joinedAt: string;
  invitedBy: string | null;
  invited: number;
  balances: { main: Money; play: Money; pendingWithdrawal: Money };
  stats: { cardsBought: number; spentOnCards: Money; wins: number; prizesWon: Money; deposited: Money; withdrawn: Money };
  history: { id: string; at: string; description: string; wallet: string; amount: Money }[];
}

export function Players({ openId, setOpenId }: { openId: string | null; setOpenId: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const list = useApi<Row[]>(`/admin/players?q=${encodeURIComponent(query)}&filter=${filter}`);

  if (openId) return <PlayerDetail id={openId} onBack={() => setOpenId(null)} onChanged={list.reload} />;

  return (
    <Panel title="Players">
      <form
        className="flex flex-wrap gap-2 border-b border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
        }}
      >
        <label className="sr-only" htmlFor="player-search">
          Search players
        </label>
        <input id="player-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, @username or Telegram id" className={`${field} min-w-0 flex-1`} />
        <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} className={`${field} w-auto`}>
          <option value="">Everyone</option>
          <option value="blocked">Blocked</option>
          <option value="staff">Staff</option>
        </select>
        <Button tone="primary" type="submit">
          Search
        </Button>
      </form>
      <ErrorLine error={list.error} />
      {list.data?.length === 0 && <Empty>No players found.</Empty>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-2 font-semibold">Player</th>
              <th className="px-4 py-2 font-semibold">Telegram id</th>
              <th className="px-4 py-2 text-right font-semibold">Main</th>
              <th className="px-4 py-2 text-right font-semibold">Bonus</th>
              <th className="px-4 py-2 font-semibold">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.data?.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-panel-2" onClick={() => setOpenId(p.id)}>
                <td className="px-4 py-2.5">
                  <button type="button" className="text-left font-semibold" onClick={() => setOpenId(p.id)}>
                    {p.name}
                  </button>
                  {p.username && <span className="text-muted"> @{p.username}</span>} {p.isBlocked && <Badge value="BLOCKED" />} {p.role === 'ADMIN' && <Badge value="ADMIN" label="staff" />}
                </td>
                <td className="num px-4 py-2.5 text-muted">{p.telegramId}</td>
                <td className="px-4 py-2.5 text-right">
                  <Birr m={p.main} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Birr m={p.play} />
                </td>
                <td className="px-4 py-2.5 text-muted">{fmtDate(p.joinedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function PlayerDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const p = useApi<Detail>(`/admin/players/${id}`);
  const [wallet, setWallet] = useState<'main' | 'play'>('main');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = p.data;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      await p.reload();
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={onBack}>← All players</Button>
      </div>
      <ErrorLine error={p.error} />
      {d && (
        <>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <h2 className="text-lg font-bold">
                  {d.name} {d.isBlocked && <Badge value="BLOCKED" />} {d.role === 'ADMIN' && <Badge value="ADMIN" label="staff" />}
                </h2>
                <p className="text-xs text-muted">
                  {d.username ? `@${d.username} · ` : ''}Telegram id <span className="num select-all">{d.telegramId}</span> · joined {fmtDate(d.joinedAt)}
                  {d.invitedBy ? ` · invited by ${d.invitedBy}` : ''} · invited {d.invited}
                </p>
              </div>
              {!confirmBlock ? (
                <Button tone={d.isBlocked ? 'plain' : 'bad'} onClick={() => setConfirmBlock(true)}>
                  {d.isBlocked ? 'Unblock' : 'Block player'}
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{d.isBlocked ? 'Let them play again?' : 'Stop them buying cards and withdrawing?'}</span>
                  <Button
                    tone={d.isBlocked ? 'good' : 'bad'}
                    disabled={busy}
                    onClick={() => void run(() => api(`/admin/players/${id}/block`, { body: { blocked: !d.isBlocked } }), d.isBlocked ? 'Unblocked' : 'Blocked').then(() => setConfirmBlock(false))}
                  >
                    Yes
                  </Button>
                  <Button onClick={() => setConfirmBlock(false)}>No</Button>
                </div>
              )}
            </div>
          </Panel>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Main wallet" value={<Birr m={d.balances.main} />} tone="gold" />
            <Stat label="Bonus wallet" value={<Birr m={d.balances.play} />} />
            <Stat label="Deposited" value={<Birr m={d.stats.deposited} />} hint={`withdrawn ${d.stats.withdrawn.birr} birr`} />
            <Stat label="Prizes won" value={<Birr m={d.stats.prizesWon} />} hint={`${d.stats.wins} wins · ${d.stats.cardsBought} cards (${d.stats.spentOnCards.birr} birr)`} />
          </div>

          <Panel title="Correct the balance">
            <form
              className="flex flex-wrap items-end gap-2 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => api(`/admin/players/${id}/adjust`, { body: { wallet, amountBirr: amount, reason } }), `Balance corrected by ${amount} birr`).then(() => {
                  setAmount('');
                  setReason('');
                });
              }}
            >
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="adj-wallet">
                Wallet
                <select id="adj-wallet" value={wallet} onChange={(e) => setWallet(e.target.value as 'main' | 'play')} className={`${field} w-auto`}>
                  <option value="main">Main</option>
                  <option value="play">Bonus</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="adj-amount">
                Birr (minus to take away)
                <input id="adj-amount" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))} placeholder="50 or -50" className={`${field} w-36`} />
              </label>
              <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-semibold text-muted" htmlFor="adj-reason">
                Reason (kept in the history)
                <input id="adj-reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
              </label>
              <Button tone="primary" type="submit" disabled={busy || !amount || reason.length < 3}>
                Apply
              </Button>
            </form>
          </Panel>

          <Panel title="Wallet history">
            {d.history.length === 0 && <Empty>No money movements yet.</Empty>}
            <ul className="divide-y divide-line">
              {d.history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{h.description}</span>
                    <span className="text-xs text-muted">
                      {fmtDate(h.at)} · {h.wallet === 'play' ? 'bonus' : 'main'}
                    </span>
                  </span>
                  <Birr m={h.amount} signed />
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
