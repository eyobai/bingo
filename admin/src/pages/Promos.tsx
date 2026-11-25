import { useState } from 'react';
import { ApiError, api, fmtDate, type Money } from '../api';
import { Badge, Birr, Button, Empty, ErrorLine, Panel, field, useApi, useToast } from '../ui';

interface Promo {
  id: string;
  code: string;
  amount: Money;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  requiresDeposit: boolean;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  state: 'ACTIVE' | 'OFF' | 'EXPIRED' | 'USED_UP';
}
interface Redemption {
  at: string;
  amount: Money;
  player: { id: string; name: string; username: string | null };
}

const STATE: Record<Promo['state'], [string, string]> = {
  ACTIVE: ['APPROVED', 'active'],
  OFF: ['REJECTED', 'switched off'],
  EXPIRED: ['CANCELLED', 'expired'],
  USED_UP: ['PENDING', 'used up'],
};

export function Promos({ openPlayer }: { openPlayer: (id: string) => void }) {
  const list = useApi<Promo[]>('/admin/promos', 10_000);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <ClearBonus openPlayer={openPlayer} />
      <CreatePromo onCreated={list.reload} />
      <Panel title="Promo codes">
        <ErrorLine error={list.error} />
        {list.data?.length === 0 && <Empty>No promo codes yet. Create one above.</Empty>}
        <ul className="divide-y divide-line">
          {list.data?.map((p) => (
            <PromoRow key={p.id} p={p} open={openId === p.id} onToggleOpen={() => setOpenId(openId === p.id ? null : p.id)} onChanged={list.reload} openPlayer={openPlayer} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}

interface NonDepositors {
  players: number;
  total: Money;
  top: { id: string; name: string; username: string | null; bonus: Money }[];
}

/** Takes back unused play-wallet bonus from players who never deposited. Main-wallet money is never touched. */
function ClearBonus({ openPlayer }: { openPlayer: (id: string) => void }) {
  const toast = useToast();
  const preview = useApi<NonDepositors>('/admin/bonus/non-depositors', 30_000);
  const [reason, setReason] = useState('Bonus is now for players who have deposited');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = preview.data;

  const run = async () => {
    if (!d) return;
    setBusy(true);
    try {
      const r = await api<{ players: number; total: Money }>('/admin/bonus/clear-non-depositors', { body: { expectedPlayers: d.players, reason } });
      toast(`Removed ${Number(r.total.birr).toLocaleString('en-US')} birr of unused bonus from ${r.players} player(s).`);
      setConfirm(false);
      preview.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
      preview.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Unused bonus of players who never deposited" action={d && <Birr m={d.total} />}>
      <ErrorLine error={preview.error} />
      <div className="flex flex-col gap-3 p-4 text-sm">
        <p className="text-xs text-muted">
          Players with no approved or pending deposit who still have money in their play wallet (bonus). Removing it sets their play wallet to 0. Their
          main wallet (winnings) is not touched, cards already bought are not affected, and each removal shows in the player's history as "Unused bonus
          removed". Players who deposit later get bonuses as usual.
        </p>
        {d && d.players === 0 && <p className="font-semibold text-good">✓ No player without a deposit holds bonus money.</p>}
        {d && d.players > 0 && (
          <>
            <p>
              <b>{d.players}</b> player(s) hold <b>{Number(d.total.birr).toLocaleString('en-US')} birr</b> of bonus.
              {d.players > d.top.length && ` Largest ${d.top.length} shown.`}
            </p>
            <ul className="flex flex-wrap gap-1.5 text-xs">
              {d.top.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => openPlayer(t.id)} className="rounded-full bg-panel-2 px-2 py-0.5 hover:underline">
                    {t.name}
                    {t.username ? ` @${t.username}` : ''} · {Number(t.bonus.birr).toLocaleString('en-US')} birr
                  </button>
                </li>
              ))}
            </ul>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Reason (kept in the history and audit trail)
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
            </label>
            {!confirm ? (
              <Button tone="bad" className="w-fit" disabled={reason.trim().length < 3} onClick={() => setConfirm(true)}>
                Remove unused bonus…
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-bad/50 bg-bad-soft px-3 py-2">
                <span>
                  Remove {Number(d.total.birr).toLocaleString('en-US')} birr from {d.players} player(s)? This cannot be undone from here.
                </span>
                <Button tone="bad" disabled={busy} onClick={() => void run()}>
                  {busy ? 'Removing…' : 'Yes, remove it'}
                </Button>
                <Button disabled={busy} onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function CreatePromo({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('20');
  const [maxUses, setMaxUses] = useState('100');
  const [expires, setExpires] = useState('');
  const [requiresDeposit, setRequiresDeposit] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const cost = Number(amount || 0) * Number(maxUses || 0);

  const create = async () => {
    setBusy(true);
    try {
      const p = await api<Promo>('/admin/promos', {
        body: {
          code: code.trim() || undefined,
          amountBirr: Number(amount),
          maxUses: maxUses ? Number(maxUses) : undefined,
          expiresAt: expires ? new Date(expires).toISOString() : undefined,
          requiresDeposit,
          note: note.trim() || undefined,
        },
      });
      toast(`Created ${p.code}. Share it with players.`);
      setCode('');
      setNote('');
      onCreated();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="New promo code">
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="pc-code">
            Code
            <input id="pc-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))} maxLength={32} placeholder="WELCOME50" className={`${field} font-bold uppercase tracking-wider`} />
            <span className="font-normal">Letters, digits, - or _. Leave empty for a random code.</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="pc-amount">
            Bonus (birr)
            <input id="pc-amount" type="number" min={1} max={100000} required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} num`} />
            <span className="font-normal">Goes to the play wallet: buys cards, cannot be withdrawn.</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="pc-max">
            How many players can use it
            <input id="pc-max" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="No limit" className={`${field} num`} />
            <span className="font-normal">{maxUses ? `Most it can cost you: ${cost.toLocaleString('en-US')} birr.` : 'Empty = no limit. Risky for public codes.'}</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="pc-expires">
            Ends at (optional)
            <input id="pc-expires" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} className={field} />
            <span className="font-normal">Your computer's time zone.</span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="pc-note">
            Note for staff (optional)
            <input id="pc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Weekend Telegram channel promo" className={field} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor="pc-deposit">
          <input id="pc-deposit" type="checkbox" checked={requiresDeposit} onChange={(e) => setRequiresDeposit(e.target.checked)} className="h-4 w-4 accent-[var(--gold)]" />
          Only for players who have made a deposit (stops new fake accounts collecting it)
        </label>
        <div>
          <Button tone="primary" type="submit" disabled={busy || !amount}>
            Create code
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function PromoRow({ p, open, onToggleOpen, onChanged, openPlayer }: { p: Promo; open: boolean; onToggleOpen: () => void; onChanged: () => void; openPlayer: (id: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const redemptions = useApi<Redemption[]>(open ? `/admin/promos/${p.id}/redemptions` : null);
  const [badgeValue, badgeLabel] = STATE[p.state];

  const patch = async (body: Record<string, boolean>, ok: string) => {
    setBusy(true);
    try {
      await api(`/admin/promos/${p.id}`, { method: 'PATCH', body });
      toast(ok);
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  const copy = () => void navigator.clipboard?.writeText(p.code).then(() => toast(`Copied ${p.code}`)).catch(() => undefined);

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button type="button" onClick={copy} title="Copy" className="num rounded-lg bg-panel-2 px-2.5 py-1 font-mono text-base font-bold tracking-wider">
            {p.code}
          </button>
          <Badge value={badgeValue} label={badgeLabel} />
          {p.requiresDeposit && <Badge value="ADMIN" label="depositors only" />}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-bold">
            <Birr m={p.amount} />
          </span>
          <span className="num text-muted">
            {p.usedCount}
            {p.maxUses !== null ? ` / ${p.maxUses}` : ''} used
          </span>
        </div>
      </div>
      <p className="text-xs text-muted">
        Created {fmtDate(p.createdAt)}
        {p.expiresAt ? ` · ends ${fmtDate(p.expiresAt)}` : ' · no end date'}
        {p.note ? ` · ${p.note}` : ''} · given so far {(Number(p.amount.birr) * p.usedCount).toLocaleString('en-US')} birr
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onToggleOpen} aria-expanded={open}>
          {open ? 'Hide players' : 'Who used it'}
        </Button>
        <Button tone={p.isActive ? 'bad' : 'good'} disabled={busy} onClick={() => void patch({ isActive: !p.isActive }, p.isActive ? `${p.code} switched off` : `${p.code} switched on`)}>
          {p.isActive ? 'Switch off' : 'Switch on'}
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void patch(
              { requiresDeposit: !p.requiresDeposit },
              p.requiresDeposit ? `${p.code} is now open to every player` : `${p.code} is now for players who have deposited`,
            )
          }
        >
          {p.requiresDeposit ? 'Open to everyone' : 'Depositors only'}
        </Button>
      </div>
      {open && (
        <div className="rounded-xl bg-panel-2 p-2">
          <ErrorLine error={redemptions.error} />
          {redemptions.data?.length === 0 && <p className="px-2 py-2 text-sm text-muted">Nobody has used it yet.</p>}
          <ul className="divide-y divide-line">
            {redemptions.data?.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <button type="button" onClick={() => openPlayer(r.player.id)} className="font-semibold underline-offset-2 hover:underline">
                  {r.player.name}
                  {r.player.username && <span className="font-normal text-muted"> @{r.player.username}</span>}
                </button>
                <span className="text-xs text-muted">{fmtDate(r.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
