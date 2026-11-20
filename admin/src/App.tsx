import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, session, whenSignedOut } from './api';
import { Overview } from './pages/Overview';
import { Deposits, Withdrawals } from './pages/Payments';
import { Players } from './pages/Players';
import { Rounds, Settings } from './pages/GamePages';
import { Button, field, useApi } from './ui';

const PAGES = [
  ['overview', 'Overview'],
  ['deposits', 'Deposits'],
  ['withdrawals', 'Withdrawals'],
  ['players', 'Players'],
  ['rounds', 'Rounds'],
  ['settings', 'Game settings'],
] as const;
type Page = (typeof PAGES)[number][0];

const pageFromHash = (): Page => {
  const h = location.hash.slice(1);
  return (PAGES.find(([k]) => k === h)?.[0] ?? 'overview') as Page;
};

export default function App() {
  const [signedIn, setSignedIn] = useState(Boolean(session.token));
  useEffect(() => whenSignedOut(() => setSignedIn(false)), []);
  return signedIn ? <Shell onSignOut={() => (session.clear(), setSignedIn(false))} /> : <SignIn onDone={() => setSignedIn(true)} />;
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const counts = useApi<{ pendingDeposits: number; pendingWithdrawals: number }>('/admin/summary?days=1', 5_000);
  const me = useApi<{ user: { firstName: string } }>('/me');

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (p: string) => {
    location.hash = p;
    setPage(p as Page);
    if (p !== 'players') setPlayerId(null);
  };
  const openPlayer = (id: string) => {
    setPlayerId(id);
    go('players');
  };
  const badge = (k: Page) => (k === 'deposits' ? counts.data?.pendingDeposits : k === 'withdrawals' ? counts.data?.pendingWithdrawals : 0) || 0;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <nav className="bg-nav text-nav-ink md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0">
        <div className="flex items-center justify-between px-4 py-3 md:block md:py-5">
          <p className="font-display text-lg tracking-wide text-[var(--gold)]">BINGO</p>
          <p className="text-xs opacity-70">Staff dashboard</p>
        </div>
        <ul className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-0">
          {PAGES.map(([k, label]) => (
            <li key={k} className="shrink-0">
              <button
                type="button"
                onClick={() => go(k)}
                aria-current={page === k ? 'page' : undefined}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold ${page === k ? 'bg-white/12 text-white' : 'opacity-75 hover:opacity-100'}`}
              >
                {label}
                {badge(k) > 0 && <span className="rounded-full bg-[var(--gold)] px-1.5 text-xs font-bold text-black">{badge(k)}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden px-4 py-4 text-xs opacity-80 md:absolute md:bottom-0 md:block">
          {me.data?.user.firstName}
          <button type="button" onClick={onSignOut} className="ml-2 underline">
            Sign out
          </button>
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-bold">{PAGES.find(([k]) => k === page)?.[1]}</h1>
            <button type="button" onClick={onSignOut} className="text-xs text-muted underline md:hidden">
              Sign out
            </button>
          </div>
          {page === 'overview' && <Overview go={go} />}
          {page === 'deposits' && <Deposits openPlayer={openPlayer} />}
          {page === 'withdrawals' && <Withdrawals openPlayer={openPlayer} />}
          {page === 'players' && <Players openId={playerId} setOpenId={setPlayerId} />}
          {page === 'rounds' && <Rounds />}
          {page === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [telegramId, setTelegramId] = useState(() => {
    try {
      return localStorage.getItem('bingo.staffId') ?? '';
    } catch {
      return '';
    }
  });
  const [step, setStep] = useState<'id' | 'code'>('id');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ via: string }>('/auth/staff/code', { body: { telegramId } });
      try {
        localStorage.setItem('bingo.staffId', telegramId);
      } catch {
        /* ignore */
      }
      setStep('code');
      setMsg({
        ok: true,
        text:
          r.via === 'server-log'
            ? 'The bot is off, so the code was written in the server window.'
            : 'If this id is staff, the bot has sent you a 6-digit code in Telegram.',
      });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ token: string }>('/auth/staff/verify', { body: { telegramId, code } });
      session.set(r.token);
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-sm">
        <p className="font-display text-xl text-[var(--gold)]">BINGO</p>
        <h1 className="mt-1 text-lg font-bold">Staff sign-in</h1>
        {step === 'id' ? (
          <form onSubmit={sendCode} className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="tg-id">
              Your Telegram id
              <input id="tg-id" inputMode="numeric" required value={telegramId} onChange={(e) => setTelegramId(e.target.value.replace(/\D/g, ''))} className={`${field} num`} />
              <span className="font-normal">Send /myid to the bot if you don't know it.</span>
            </label>
            <Button tone="primary" type="submit" disabled={busy || !telegramId} className="py-2.5">
              Send me a code
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="code">
              6-digit code
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={`${field} num text-center text-2xl tracking-[0.4em]`}
                autoFocus
              />
            </label>
            <Button tone="primary" type="submit" disabled={busy || code.length !== 6} className="py-2.5">
              Sign in
            </Button>
            <button type="button" onClick={() => (setStep('id'), setCode(''), setMsg(null))} className="text-xs text-muted underline">
              Use another id or send a new code
            </button>
          </form>
        )}
        {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-good' : 'text-bad'}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
