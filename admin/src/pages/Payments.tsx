import { useState } from 'react';
import { ApiError, api, fmtDate, type Money } from '../api';
import { Badge, Birr, Button, Empty, ErrorLine, Panel, field, useApi, useToast } from '../ui';

interface Deposit {
  id: string;
  method: string;
  amount: Money;
  bonus: Money;
  txRef: string;
  status: string;
  note: string | null;
  createdAt: string;
  smsText: string;
  player: { id: string; name: string; username: string | null };
}
interface Withdrawal {
  id: string;
  method: string;
  accountNumber: string;
  accountName: string;
  amount: Money;
  status: string;
  payoutRef: string | null;
  note: string | null;
  createdAt: string;
  player: { id: string; name: string; username: string | null };
  stats?: {
    deposited: Money;
    deposits: number;
    won: Money;
    bonus: Money;
    paidOut: Money;
    withdrawalsPaid: number;
    neverDeposited: boolean;
    main: Money;
    held: Money;
  };
}

/**
 * Did the player have the money? The amount is taken from the main wallet into a hold the moment they ask,
 * so a pending request is covered when the hold holds at least that much.
 */
function BalanceCheck({ s, amount }: { s: NonNullable<Withdrawal['stats']>; amount: Money }) {
  const held = Number(s.held.birr);
  const asked = Number(amount.birr);
  const had = held + Number(s.main.birr);
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return held + 0.001 >= asked ? (
    <p className="rounded-lg border border-good/40 bg-good-soft px-3 py-1.5 text-sm">
      <b className="text-good">✓ Enough balance.</b> Had {fmt(had)} birr in the main wallet when asking; {fmt(asked)} birr is held for this payout, {fmt(Number(s.main.birr))}{' '}
      birr left.
    </p>
  ) : (
    <p className="rounded-lg border border-bad/50 bg-bad-soft px-3 py-1.5 text-sm">
      <b className="text-bad">✗ Not enough balance.</b> Asked {fmt(asked)} birr but only {fmt(held)} birr is held. Reject it and check the player's history.
    </p>
  );
}

/** Where the player's money came from, so a withdrawal can be judged at a glance. */
function MoneyTrail({ s, amount }: { s: NonNullable<Withdrawal['stats']>; amount: Money }) {
  const n = (m: Money) => Number(m.birr);
  // More out than in (deposits + prizes) is worth a closer look before paying.
  const outsized = n(amount) + n(s.paidOut) > n(s.deposited) + n(s.won) + 0.01;
  return (
    <div className="flex flex-col gap-1.5">
      {s.neverDeposited && (
        <p className="rounded-lg border border-bad/50 bg-bad-soft px-3 py-1.5 text-sm font-semibold">
          ⚠ Never deposited. Check in the player's history where this money came from before paying.
        </p>
      )}
      {outsized && (
        <p className="rounded-lg border border-bad/50 bg-bad-soft px-3 py-1.5 text-sm font-semibold">
          ⚠ Asks for more than they ever deposited plus won. Check the player's history before paying.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-lg border border-line px-3 py-2 text-xs sm:grid-cols-5">
        <div>
          <dt className="text-muted">Deposited</dt>
          <dd className="font-semibold">
            <Birr m={s.deposited} /> <span className="text-muted">({s.deposits})</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">Won (prizes)</dt>
          <dd className="font-semibold">
            <Birr m={s.won} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Bonus received</dt>
          <dd className="font-semibold">
            <Birr m={s.bonus} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Withdrawn before</dt>
          <dd className="font-semibold">
            <Birr m={s.paidOut} /> <span className="text-muted">({s.withdrawalsPaid})</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">Main wallet now</dt>
          <dd className="font-semibold">
            <Birr m={s.main} /> <span className="text-muted">(after hold)</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

const METHOD: Record<string, string> = { TELEBIRR: 'Telebirr', CBE_BIRR: 'CBE Birr' };

function StatusTabs({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap rounded-lg border border-line bg-panel-2 p-0.5 text-xs font-semibold" role="group" aria-label="Status">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v} className={`rounded-md px-3 py-1.5 ${value === v ? 'bg-nav text-nav-ink' : 'text-muted'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Player({ p, onOpen }: { p: { id: string; name: string; username: string | null }; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(p.id)} className="text-left font-semibold underline-offset-2 hover:underline">
      {p.name}
      {p.username && <span className="font-normal text-muted"> @{p.username}</span>}
    </button>
  );
}

export function Deposits({ openPlayer }: { openPlayer: (id: string) => void }) {
  const [status, setStatus] = useState('PENDING');
  const list = useApi<Deposit[]>(`/admin/deposits${status ? `?status=${status}` : ''}`, status === 'PENDING' ? 5000 : undefined);
  return (
    <Panel
      title="Deposits"
      action={
        <StatusTabs
          value={status}
          onChange={setStatus}
          options={[
            ['PENDING', 'Waiting'],
            ['APPROVED', 'Approved'],
            ['REJECTED', 'Rejected'],
            ['', 'All'],
          ]}
        />
      }
    >
      {status === 'PENDING' && (
        <p className="border-b border-line bg-gold-soft px-4 py-2 text-xs">
          Before approving, check in your {Object.values(METHOD).join(' / ')} app that this amount really arrived with this transaction number.
        </p>
      )}
      <ErrorLine error={list.error} />
      {list.data?.length === 0 && <Empty>{status === 'PENDING' ? 'Nothing waiting. New deposits appear here by themselves.' : 'No deposits.'}</Empty>}
      <ul className="divide-y divide-line">
        {list.data?.map((d) => <DepositRow key={d.id} d={d} onDone={list.reload} openPlayer={openPlayer} />)}
      </ul>
    </Panel>
  );
}

function DepositRow({ d, onDone, openPlayer }: { d: Deposit; onDone: () => void; openPlayer: (id: string) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'none' | 'approve' | 'reject'>('none');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('Payment not found');
  const [busy, setBusy] = useState(false);
  const [showSms, setShowSms] = useState(false);

  const act = async (kind: 'approve' | 'reject') => {
    setBusy(true);
    try {
      if (kind === 'approve') await api(`/admin/deposits/${d.id}/approve`, { body: amount ? { amountBirr: amount } : {} });
      else await api(`/admin/deposits/${d.id}/reject`, { body: { note } });
      toast(kind === 'approve' ? `Approved ${amount || d.amount.birr} birr for ${d.player.name}` : `Rejected deposit ${d.txRef}`);
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Player p={d.player} onOpen={openPlayer} />
          <p className="text-xs text-muted">
            {METHOD[d.method] ?? d.method} · ref <span className="num font-semibold text-ink">{d.txRef}</span> · {fmtDate(d.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">
            <Birr m={d.amount} />
          </span>
          <Badge value={d.status} />
        </div>
      </div>
      {d.bonus.minor !== '0' && <p className="text-xs text-muted">First-deposit bonus given: {d.bonus.birr} birr</p>}
      {d.note && <p className="text-xs text-muted">Note: {d.note}</p>}
      <button type="button" onClick={() => setShowSms((v) => !v)} className="w-fit text-xs font-semibold text-muted underline-offset-2 hover:underline" aria-expanded={showSms}>
        {showSms ? 'Hide SMS' : 'Show SMS'}
      </button>
      {showSms && <pre className="whitespace-pre-wrap break-words rounded-lg bg-panel-2 p-3 text-xs">{d.smsText}</pre>}

      {d.status === 'PENDING' && mode === 'none' && (
        <div className="flex flex-wrap gap-2">
          <Button tone="good" disabled={busy} onClick={() => void act('approve')}>
            Approve {d.amount.birr} birr
          </Button>
          <Button onClick={() => setMode('approve')}>Approve another amount</Button>
          <Button tone="bad" onClick={() => setMode('reject')}>
            Reject
          </Button>
        </div>
      )}
      {mode === 'approve' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act('approve');
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor={`amt-${d.id}`}>
            Amount that really arrived (birr)
            <input id={`amt-${d.id}`} inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} className={`${field} w-40`} />
          </label>
          <Button tone="good" type="submit" disabled={busy || !amount}>
            Approve
          </Button>
          <Button onClick={() => setMode('none')}>Cancel</Button>
        </form>
      )}
      {mode === 'reject' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act('reject');
          }}
        >
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-semibold text-muted" htmlFor={`note-${d.id}`}>
            Reason (the player sees it)
            <input id={`note-${d.id}`} required value={note} onChange={(e) => setNote(e.target.value)} className={field} />
          </label>
          <Button tone="bad" type="submit" disabled={busy}>
            Reject
          </Button>
          <Button onClick={() => setMode('none')}>Cancel</Button>
        </form>
      )}
    </li>
  );
}

export function Withdrawals({ openPlayer }: { openPlayer: (id: string) => void }) {
  const [status, setStatus] = useState('PENDING');
  const list = useApi<Withdrawal[]>(`/admin/withdrawals${status ? `?status=${status}` : ''}`, status === 'PENDING' ? 5000 : undefined);
  return (
    <Panel
      title="Withdrawals"
      action={
        <StatusTabs
          value={status}
          onChange={setStatus}
          options={[
            ['PENDING', 'To pay'],
            ['PAID', 'Paid'],
            ['REJECTED', 'Rejected'],
            ['', 'All'],
          ]}
        />
      }
    >
      {status === 'PENDING' && (
        <p className="border-b border-line bg-gold-soft px-4 py-2 text-xs">
          Send the money from your account first, then mark it paid. The money is already held from the player's wallet.
        </p>
      )}
      <ErrorLine error={list.error} />
      {list.data?.length === 0 && <Empty>{status === 'PENDING' ? 'Nothing to pay right now.' : 'No withdrawals.'}</Empty>}
      <ul className="divide-y divide-line">
        {list.data?.map((w) => <WithdrawalRow key={w.id} w={w} onDone={list.reload} openPlayer={openPlayer} />)}
      </ul>
    </Panel>
  );
}

function WithdrawalRow({ w, onDone, openPlayer }: { w: Withdrawal; onDone: () => void; openPlayer: (id: string) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'none' | 'paid' | 'reject'>('none');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async () => {
    setBusy(true);
    try {
      await api(`/admin/withdrawals/${w.id}/${mode === 'paid' ? 'paid' : 'reject'}`, { body: { note: text } });
      toast(mode === 'paid' ? `Marked ${w.amount.birr} birr to ${w.player.name} as paid` : 'Rejected; the money is back in the wallet');
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Player p={w.player} onOpen={openPlayer} />
          <p className="text-xs text-muted">{fmtDate(w.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">
            <Birr m={w.amount} />
          </span>
          <Badge value={w.status} />
        </div>
      </div>
      {w.stats && w.status === 'PENDING' && <BalanceCheck s={w.stats} amount={w.amount} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-panel-2 px-3 py-2 text-sm">
        <span>
          {METHOD[w.method] ?? w.method}: <b className="num select-all">{w.accountNumber}</b>
        </span>
        <span>
          Name: <b>{w.accountName}</b>
        </span>
        {w.payoutRef && <span className="text-muted">Payout ref: {w.payoutRef}</span>}
        {w.note && <span className="text-muted">Note: {w.note}</span>}
      </div>
      {w.stats && w.status === 'PENDING' && <MoneyTrail s={w.stats} amount={w.amount} />}
      {w.status === 'PENDING' && mode === 'none' && (
        <div className="flex flex-wrap gap-2">
          <Button tone="good" onClick={() => setMode('paid')}>
            I sent it: mark paid
          </Button>
          <Button tone="bad" onClick={() => setMode('reject')}>
            Reject
          </Button>
        </div>
      )}
      {mode !== 'none' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act();
          }}
        >
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-semibold text-muted" htmlFor={`w-${w.id}`}>
            {mode === 'paid' ? 'Your transaction number (optional)' : 'Reason (the player sees it)'}
            <input id={`w-${w.id}`} required={mode === 'reject'} value={text} onChange={(e) => setText(e.target.value)} className={field} />
          </label>
          <Button tone={mode === 'paid' ? 'good' : 'bad'} type="submit" disabled={busy}>
            {mode === 'paid' ? 'Mark paid' : 'Reject'}
          </Button>
          <Button onClick={() => setMode('none')}>Cancel</Button>
        </form>
      )}
    </li>
  );
}
