import { useState, type ReactNode } from 'react';
import { ApiError, api, fmtDate, type Money } from '../api';
import { Badge, Birr, Button, Empty, ErrorLine, Panel, Stat, field, useApi, useToast } from '../ui';

interface Row {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  phone: string | null;
  language: string;
  role: string;
  isBlocked: boolean;
  invited: boolean;
  joinedAt: string;
  lastActive: string;
  main: Money;
  play: Money;
  deposited: Money;
  deposits: number;
  withdrawn: Money;
  cards: number;
  wins: number;
  prizes: Money;
}
interface List {
  total: number;
  shown: number;
  players: Row[];
}
interface Counts {
  all: number;
  withPhone: number;
  depositors: number;
  blocked: number;
  staff: number;
  new1: number;
  new7: number;
  active7: number;
}
interface Detail {
  id: string;
  telegramId: string;
  name: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  role: string;
  isBlocked: boolean;
  joinedAt: string;
  lastActive: string;
  language: string;
  referralCode: string;
  referralRewardPaid: boolean;
  invitedBy: { id: string; name: string; username: string | null } | null;
  invited: number;
  invitedList: { id: string; name: string; username: string | null; registered: boolean; joinedAt: string; deposited: Money }[];
  balances: { main: Money; play: Money; pendingWithdrawal: Money };
  stats: {
    cardsBought: number;
    spentOnCards: Money;
    spentFromMain: Money;
    spentFromBonus: Money;
    wins: number;
    prizesWon: Money;
    resultFromGames: Money;
    roundsPlayed: number;
    deposited: Money;
    depositCount: number;
    firstDepositAt: string | null;
    lastDepositAt: string | null;
    withdrawn: Money;
    withdrawalCount: number;
    pendingDeposits: number;
    pendingWithdrawals: number;
    promoCodesUsed: number;
  };
  games: { round: number; room: string; stake: Money; status: string; at: string; cards: number[]; paid: Money; won: Money }[];
  promos: { code: string; amount: Money; at: string }[];
  history: { id: string; at: string; description: string; wallet: string; amount: Money }[];
  deposits: { id: string; method: string; amount: Money; bonus: Money; txRef: string; status: string; note: string | null; createdAt: string }[];
  withdrawals: { id: string; method: string; accountNumber: string; accountName: string; amount: Money; status: string; payoutRef: string | null; note: string | null; createdAt: string }[];
}

const FILTERS: [string, string][] = [
  ['', 'Everyone'],
  ['phone', 'Registered (phone shared)'],
  ['nophone', 'Not registered (no phone)'],
  ['depositors', 'Have deposited'],
  ['nodeposit', 'Registered, never deposited'],
  ['invited', 'Joined through an invite'],
  ['active7', 'Active in the last 7 days'],
  ['new7', 'Joined in the last 7 days'],
  ['blocked', 'Blocked'],
  ['staff', 'Staff'],
];
const LANG: Record<string, string> = { am: 'Amharic', om: 'Afaan Oromoo', en: 'English' };
const METHOD: Record<string, string> = { TELEBIRR: 'Telebirr', CBE_BIRR: 'CBE Birr' };

export function Players({ openId, setOpenId }: { openId: string | null; setOpenId: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('newest');
  const counts = useApi<Counts>('/admin/players-stats', 30_000);
  const list = useApi<List>(`/admin/players?q=${encodeURIComponent(query)}&filter=${filter}&sort=${sort}`);

  if (openId) return <PlayerDetail id={openId} onOpen={setOpenId} onBack={() => setOpenId(null)} onChanged={list.reload} />;
  const c = counts.data;
  const tile = (label: string, value: number | undefined, f: string, hint?: string) => (
    <button type="button" onClick={() => setFilter(f)} className={`h-full rounded-2xl text-left [&>div]:h-full ${filter === f ? 'ring-2 ring-gold' : ''}`}>
      <Stat label={label} value={value ?? '…'} hint={hint} />
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tile('All players', c?.all, '')}
        {tile('Registered', c?.withPhone, 'phone', c ? `${pct(c.withPhone, c.all)} shared phone` : undefined)}
        {tile('Have deposited', c?.depositors, 'depositors', c ? `${pct(c.depositors, c.all)} of all players` : undefined)}
        {tile('New today', c?.new1, 'new7', c ? `${c.new7} in 7 days` : undefined)}
        {tile('Active (7 days)', c?.active7, 'active7')}
        {tile('Blocked', c?.blocked, 'blocked', c ? `${c.staff} staff` : undefined)}
      </div>

      <Panel title="Players">
        <form
          className="grid gap-2 border-b border-line p-3 md:grid-cols-[1fr_auto_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q);
          }}
        >
          <label className="sr-only" htmlFor="player-search">
            Search players
          </label>
          <input id="player-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, @username, phone or Telegram id" className={`${field} min-w-0`} />
          <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} className={`${field} w-auto`}>
            {FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className={`${field} w-auto`}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="active">Recently active</option>
          </select>
          <Button tone="primary" type="submit">
            Search
          </Button>
        </form>
        <ErrorLine error={list.error || counts.error} />
        {list.data && (
          <p className="px-4 pt-3 text-xs text-muted">
            {list.data.total} player{list.data.total === 1 ? '' : 's'}
            {list.data.total > list.data.shown ? ` · showing the first ${list.data.shown}; search or filter to narrow down` : ''}
          </p>
        )}
        {list.data?.players.length === 0 && <Empty>No players found.</Empty>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Player</th>
                <th className="px-4 py-2 font-semibold">Phone</th>
                <th className="px-4 py-2 font-semibold">Telegram id</th>
                <th className="px-4 py-2 text-right font-semibold">Main</th>
                <th className="px-4 py-2 text-right font-semibold">Bonus</th>
                <th className="px-4 py-2 text-right font-semibold">Deposited</th>
                <th className="px-4 py-2 text-right font-semibold">Withdrawn</th>
                <th className="px-4 py-2 text-right font-semibold">Cards / wins</th>
                <th className="px-4 py-2 font-semibold">Joined</th>
                <th className="px-4 py-2 font-semibold">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data?.players.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-panel-2" onClick={() => setOpenId(p.id)}>
                  <td className="px-4 py-2.5">
                    <button type="button" className="text-left font-semibold" onClick={() => setOpenId(p.id)}>
                      {p.name}
                    </button>
                    {p.username && <span className="text-muted"> @{p.username}</span>}{' '}
                    {p.isBlocked && <Badge value="BLOCKED" />} {p.role === 'ADMIN' && <Badge value="ADMIN" label="staff" />}{' '}
                    {p.invited && <Badge value="SELECTING" label="invited" />}
                    <span className="block text-[11px] text-muted">{LANG[p.language] ?? p.language}</span>
                  </td>
                  <td className="num px-4 py-2.5">{p.phone ?? <span className="text-muted">—</span>}</td>
                  <td className="num px-4 py-2.5 text-muted">{p.telegramId}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Birr m={p.main} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Birr m={p.play} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Birr m={p.deposited} />
                    {p.deposits > 0 && <span className="block text-[11px] text-muted">{p.deposits}×</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Birr m={p.withdrawn} />
                  </td>
                  <td className="num px-4 py-2.5 text-right">
                    {p.cards} / {p.wins}
                    {p.prizes.minor !== '0' && <span className="block text-[11px] text-muted">{p.prizes.birr} won</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{fmtDate(p.joinedAt)}</td>
                  <td className="px-4 py-2.5 text-muted">{fmtDate(p.lastActive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '0%');

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}

function PlayerDetail({ id, onBack, onOpen, onChanged }: { id: string; onBack: () => void; onOpen: (id: string) => void; onChanged: () => void }) {
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
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast('Copied'));
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
                  {d.name} {d.isBlocked && <Badge value="BLOCKED" />} {d.role === 'ADMIN' && <Badge value="ADMIN" label="staff" />}{' '}
                  {d.phone ? <Badge value="APPROVED" label="registered" /> : <Badge value="PENDING" label="no phone yet" />}
                </h2>
                <p className="text-xs text-muted">
                  {d.username ? `@${d.username} · ` : ''}joined {fmtDate(d.joinedAt)} · last active {fmtDate(d.lastActive)}
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

          <Panel title="Profile">
            <dl className="grid grid-cols-2 gap-4 p-4 md:grid-cols-3 xl:grid-cols-4">
              <Field label="First name">{d.firstName}</Field>
              <Field label="Last name">{d.lastName ?? '—'}</Field>
              <Field label="Telegram username">
                {d.username ? (
                  <a className="text-gold underline" href={`https://t.me/${d.username}`} target="_blank" rel="noreferrer">
                    @{d.username}
                  </a>
                ) : (
                  '—'
                )}
              </Field>
              <Field label="Phone">
                {d.phone ? (
                  <button type="button" className="num underline decoration-dotted" onClick={() => copy(d.phone!)} title="Copy">
                    {d.phone}
                  </button>
                ) : (
                  'Not shared yet'
                )}
              </Field>
              <Field label="Telegram id">
                <button type="button" className="num underline decoration-dotted" onClick={() => copy(d.telegramId)} title="Copy">
                  {d.telegramId}
                </button>
              </Field>
              <Field label="Language">{LANG[d.language] ?? d.language}</Field>
              <Field label="Joined">{fmtDate(d.joinedAt)}</Field>
              <Field label="Last active">{fmtDate(d.lastActive)}</Field>
              <Field label="Invite code">
                <span className="num">{d.referralCode}</span>
              </Field>
              <Field label="Invited by">
                {d.invitedBy ? (
                  <button type="button" className="text-gold underline" onClick={() => onOpen(d.invitedBy!.id)}>
                    {d.invitedBy.name}
                    {d.invitedBy.username ? ` @${d.invitedBy.username}` : ''}
                  </button>
                ) : (
                  '—'
                )}
              </Field>
              <Field label="Friends invited">{d.invited}</Field>
              <Field label="Invite reward to inviter">{d.invitedBy ? (d.referralRewardPaid ? 'Paid' : 'Not yet (on first deposit)') : '—'}</Field>
            </dl>
          </Panel>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Main wallet" value={<Birr m={d.balances.main} />} tone="gold" hint="withdrawable" />
            <Stat label="Bonus wallet" value={<Birr m={d.balances.play} />} hint="cards only" />
            <Stat label="Waiting withdrawal" value={<Birr m={d.balances.pendingWithdrawal} />} hint={d.stats.pendingWithdrawals ? `${d.stats.pendingWithdrawals} pending` : undefined} />
            <Stat
              label="Deposited"
              value={<Birr m={d.stats.deposited} />}
              hint={d.stats.depositCount ? `${d.stats.depositCount}× · first ${fmtDate(d.stats.firstDepositAt!)}` : d.stats.pendingDeposits ? `${d.stats.pendingDeposits} pending` : 'never'}
            />
            <Stat label="Withdrawn" value={<Birr m={d.stats.withdrawn} />} hint={`${d.stats.withdrawalCount}×`} />
            <Stat label="Rounds played" value={d.stats.roundsPlayed} hint={`${d.stats.cardsBought} cards`} />
            <Stat label="Spent on cards" value={<Birr m={d.stats.spentOnCards} />} hint={`${d.stats.spentFromMain.birr} main · ${d.stats.spentFromBonus.birr} bonus`} />
            <Stat label="Prizes won" value={<Birr m={d.stats.prizesWon} />} hint={`${d.stats.wins} winning card${d.stats.wins === 1 ? '' : 's'}`} />
            <Stat
              label="Result from games"
              value={<Birr m={d.stats.resultFromGames} signed />}
              tone={d.stats.resultFromGames.minor.startsWith('-') ? 'bad' : d.stats.resultFromGames.minor === '0' ? undefined : 'good'}
              hint="prizes minus cards"
            />
            <Stat label="Promo codes used" value={d.stats.promoCodesUsed} />
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

          <Panel title={`Recent games (${d.games.length} of ${d.stats.roundsPlayed})`}>
            {d.games.length === 0 && <Empty>No games played yet.</Empty>}
            {d.games.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Round</th>
                      <th className="px-4 py-2 font-semibold">Room</th>
                      <th className="px-4 py-2 font-semibold">Cards</th>
                      <th className="px-4 py-2 text-right font-semibold">Paid</th>
                      <th className="px-4 py-2 text-right font-semibold">Won</th>
                      <th className="px-4 py-2 font-semibold">Status</th>
                      <th className="px-4 py-2 font-semibold">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.games.map((g) => (
                      <tr key={g.round}>
                        <td className="num px-4 py-2 font-semibold">#{g.round}</td>
                        <td className="px-4 py-2">
                          {g.room} <span className="text-muted">({g.stake.birr} ETB)</span>
                        </td>
                        <td className="num px-4 py-2 text-muted">{g.cards.map((c) => `#${c}`).join(', ')}</td>
                        <td className="px-4 py-2 text-right">
                          <Birr m={g.paid} />
                        </td>
                        <td className="px-4 py-2 text-right">{g.won.minor !== '0' ? <span className="font-bold text-good">{g.won.birr}</span> : <span className="text-muted">—</span>}</td>
                        <td className="px-4 py-2">
                          <Badge value={g.status} />
                        </td>
                        <td className="px-4 py-2 text-muted">{fmtDate(g.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title={`Deposits (${d.deposits.length})`}>
              {d.deposits.length === 0 && <Empty>No deposits.</Empty>}
              <ul className="divide-y divide-line">
                {d.deposits.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block">
                        {METHOD[x.method] ?? x.method} · <span className="num">ref {x.txRef}</span>
                      </span>
                      <span className="text-xs text-muted">
                        {fmtDate(x.createdAt)}
                        {x.bonus.minor !== '0' ? ` · +${x.bonus.birr} bonus` : ''}
                        {x.note ? ` · ${x.note}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Birr m={x.amount} /> <Badge value={x.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title={`Withdrawals (${d.withdrawals.length})`}>
              {d.withdrawals.length === 0 && <Empty>No withdrawals.</Empty>}
              <ul className="divide-y divide-line">
                {d.withdrawals.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">
                        {METHOD[x.method] ?? x.method} · <span className="num">{x.accountNumber}</span> ({x.accountName})
                      </span>
                      <span className="text-xs text-muted">
                        {fmtDate(x.createdAt)}
                        {x.payoutRef ? ` · paid ref ${x.payoutRef}` : ''}
                        {x.note ? ` · ${x.note}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Birr m={x.amount} /> <Badge value={x.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title={`Friends invited (${d.invited})`}>
              {d.invitedList.length === 0 && <Empty>Nobody joined through this player's link yet.</Empty>}
              <ul className="divide-y divide-line">
                {d.invitedList.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <button type="button" className="min-w-0 text-left" onClick={() => onOpen(f.id)}>
                      <span className="block truncate font-semibold text-gold underline">
                        {f.name}
                        {f.username ? ` @${f.username}` : ''}
                      </span>
                      <span className="text-xs text-muted">
                        joined {fmtDate(f.joinedAt)} · {f.registered ? 'registered' : 'no phone yet'}
                      </span>
                    </button>
                    <span className="shrink-0 text-xs text-muted">
                      deposited <Birr m={f.deposited} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title={`Promo codes used (${d.promos.length})`}>
              {d.promos.length === 0 && <Empty>No promo codes used.</Empty>}
              <ul className="divide-y divide-line">
                {d.promos.map((r) => (
                  <li key={r.code + r.at} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span>
                      <span className="font-bold tracking-wider">{r.code}</span> <span className="text-xs text-muted">· {fmtDate(r.at)}</span>
                    </span>
                    <Birr m={r.amount} />
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel title="Wallet history (latest 100)">
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
