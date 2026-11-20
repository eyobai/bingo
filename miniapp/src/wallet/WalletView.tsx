import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type Balances, type Money } from '../api';
import { useI18n } from '../i18n';

interface Options {
  methods: { method: 'TELEBIRR' | 'CBE_BIRR'; label: string; accountNumber: string; accountName: string }[];
  depositMin: Money;
  withdrawMin: Money;
  firstDepositBonusPercent: number;
}
interface HistoryRow {
  id: string;
  at: string;
  label: string;
  description: string;
  wallet: 'main' | 'play';
  amount: Money;
}
interface Request {
  id: string;
  amount: Money;
  status: string;
  createdAt: string;
  txRef?: string;
  accountNumber?: string;
}

export function WalletView({ wallet, initialTab = 'deposit' }: { wallet: Balances | null; initialTab?: 'deposit' | 'withdraw' }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'deposit' | 'withdraw'>(initialTab);
  const [options, setOptions] = useState<Options | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [requests, setRequests] = useState<(Request & { kind: 'in' | 'out' })[]>([]);

  const load = () => {
    void api<{ history: HistoryRow[] }>('/me/wallet').then((r) => setHistory(r.history));
    void Promise.all([api<Request[]>('/payments/deposits'), api<Request[]>('/payments/withdrawals')]).then(([d, w]) =>
      setRequests(
        [...d.map((x) => ({ ...x, kind: 'in' as const })), ...w.map((x) => ({ ...x, kind: 'out' as const }))]
          .filter((x) => x.status === 'PENDING')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      ),
    );
  };
  useEffect(() => {
    void api<Options>('/payments/options').then(setOptions);
  }, []);
  useEffect(load, [wallet?.total.minor, wallet?.pendingWithdrawal.minor]);

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <section className="rounded-2xl border border-line bg-gradient-to-br from-panel-2 to-panel p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{t('total')}</p>
        <p className="font-display text-3xl tabular-nums">
          {wallet?.total.birr ?? '–'} <span className="text-base text-muted">ETB</span>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Stat label={t('mainWallet')} value={wallet?.main.birr} tone="text-gold" />
          <Stat label={t('playWallet')} value={wallet?.play.birr} tone="text-sky-400" />
        </div>
        {wallet && wallet.pendingWithdrawal.minor !== '0' && (
          <p className="mt-2 text-xs text-muted">
            {t('pendingWithdrawal')}: <b className="text-ink">{wallet.pendingWithdrawal.birr} ETB</b>
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 rounded-xl border border-line bg-panel p-1 text-sm font-bold">
        {(['deposit', 'withdraw'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-lg py-2 ${tab === k ? 'bg-gold text-gold-ink' : 'text-muted'}`}>
            {t(k)}
          </button>
        ))}
      </div>

      {options && tab === 'deposit' && <DepositForm options={options} onDone={load} />}
      {options && tab === 'withdraw' && <WithdrawForm options={options} onDone={load} />}

      {requests.length > 0 && (
        <section className="flex flex-col gap-1.5">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-xl border border-gold/40 bg-gold/5 px-3 py-2 text-xs">
              <span>
                {r.kind === 'in' ? t('deposit') : t('withdraw')} · {r.amount.birr} ETB
              </span>
              <span className="font-bold text-gold">{t('pending')}…</span>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-1">
        <h2 className="px-1 pb-1 font-display text-xs uppercase tracking-wider text-muted">{t('history')}</h2>
        {history.length === 0 && <p className="px-1 text-xs text-muted">{t('noHistory')}</p>}
        {history.map((h) => {
          const plus = !h.amount.birr.startsWith('-');
          return (
            <div key={h.id} className="flex items-center justify-between gap-3 border-b border-line/60 px-1 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold">{h.description}</p>
                <p className="text-[10px] text-muted">
                  {new Date(h.at).toLocaleString()} · {h.wallet === 'play' ? t('playWallet') : t('mainWallet')}
                </p>
              </div>
              <span className={`shrink-0 font-bold tabular-nums ${plus ? 'text-win' : 'text-ink'}`}>
                {plus ? '+' : ''}
                {h.amount.birr}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value?: string; tone: string }) {
  return (
    <div className="rounded-xl bg-bg/60 px-3 py-2">
      <p className={`text-[10px] font-bold uppercase tracking-wide ${tone}`}>{label}</p>
      <p className="font-bold tabular-nums">{value ?? '–'} ETB</p>
    </div>
  );
}

function DepositForm({ options, onDone }: { options: Options; onDone: () => void }) {
  const { t } = useI18n();
  const [method, setMethod] = useState(options.methods[0]?.method);
  const [sms, setSms] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const m = options.methods.find((x) => x.method === method);
  if (!m) return <p className="text-sm text-muted">—</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setMsg(null);
    try {
      await api('/payments/deposits', { body: { method, smsText: sms } });
      setSms('');
      setMsg({ ok: true, text: t('depositSent') });
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
      <div className="flex gap-2">
        {options.methods.map((x) => (
          <button
            key={x.method}
            type="button"
            onClick={() => setMethod(x.method)}
            aria-pressed={method === x.method}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-bold ${method === x.method ? 'border-gold bg-gold/10 text-gold' : 'border-line text-muted'}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{t('depositHow')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-bg/60 p-3 text-sm">
        <dt className="text-muted">{t('account')}</dt>
        <dd className="flex items-center gap-2 font-bold tabular-nums">
          <span className="select-all">{m.accountNumber}</span>
          <button type="button" className="rounded-md border border-line px-2 py-0.5 text-[10px] text-muted" onClick={() => void navigator.clipboard?.writeText(m.accountNumber).catch(() => undefined)}>
            Copy
          </button>
        </dd>
        <dt className="text-muted">{t('name')}</dt>
        <dd className="font-bold">{m.accountName}</dd>
        <dt className="text-muted">{t('minimum')}</dt>
        <dd className="font-bold">{options.depositMin.birr} ETB</dd>
      </dl>
      {options.firstDepositBonusPercent > 0 && <p className="text-xs font-bold text-gold">🎁 {t('firstBonus', { p: options.firstDepositBonusPercent })}</p>}
      <label className="flex flex-col gap-1 text-xs font-bold text-muted" htmlFor="sms">
        {t('pasteSms')}
        <textarea
          id="sms"
          value={sms}
          onChange={(e) => setSms(e.target.value)}
          rows={5}
          required
          minLength={20}
          className="rounded-xl border border-line bg-bg p-3 text-sm font-normal text-ink outline-none focus:border-gold"
          placeholder="Dear … You have transferred ETB 200.00 to … Your transaction number is …"
        />
      </label>
      {msg && <p className={`text-sm ${msg.ok ? 'text-win' : 'text-danger'}`}>{msg.text}</p>}
      <button type="submit" disabled={sending || sms.trim().length < 20} className="rounded-xl bg-gold py-3 font-black text-gold-ink disabled:opacity-50">
        {t('submit')}
      </button>
    </form>
  );
}

function WithdrawForm({ options, onDone }: { options: Options; onDone: () => void }) {
  const { t } = useI18n();
  const [method, setMethod] = useState(options.methods[0]?.method ?? 'TELEBIRR');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setMsg(null);
    try {
      await api('/payments/withdrawals', { body: { method, accountNumber, accountName, amountBirr: amount } });
      setAmount('');
      setMsg({ ok: true, text: t('withdrawSent') });
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setSending(false);
    }
  };
  const field = 'rounded-xl border border-line bg-bg px-3 py-2.5 text-sm font-normal text-ink outline-none focus:border-gold';

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
      <div className="flex gap-2">
        {(['TELEBIRR', 'CBE_BIRR'] as const).map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => setMethod(x)}
            aria-pressed={method === x}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-bold ${method === x ? 'border-gold bg-gold/10 text-gold' : 'border-line text-muted'}`}
          >
            {x === 'TELEBIRR' ? 'Telebirr' : 'CBE Birr'}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs font-bold text-muted" htmlFor="w-phone">
        {t('phoneNumber')}
        <input id="w-phone" inputMode="tel" required minLength={9} maxLength={20} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className={field} placeholder="09…" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-bold text-muted" htmlFor="w-name">
        {t('accountName')}
        <input id="w-name" required minLength={2} maxLength={80} value={accountName} onChange={(e) => setAccountName(e.target.value)} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-bold text-muted" htmlFor="w-amount">
        {t('amountBirr')} · {t('minimum')} {options.withdrawMin.birr}
        <input id="w-amount" inputMode="numeric" pattern="[0-9]*" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} className={field} />
      </label>
      {msg && <p className={`text-sm ${msg.ok ? 'text-win' : 'text-danger'}`}>{msg.text}</p>}
      <button type="submit" disabled={sending || !amount} className="rounded-xl bg-gold py-3 font-black text-gold-ink disabled:opacity-50">
        {t('withdraw')}
      </button>
    </form>
  );
}
