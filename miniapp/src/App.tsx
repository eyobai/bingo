import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, session, type Balances, type User } from './api';
import { GameScreen } from './game/GameScreen';
import { Lobby } from './game/Lobby';
import { ConnectionBanner } from './Connection';
import { Header } from './Header';
import { I18nProvider, useI18n, type Lang } from './i18n';
import { ProfileView } from './ProfileView';
import { telegram } from './telegram';
import { WalletView } from './wallet/WalletView';

// Browser sign-in for testing: on by default with `npm run dev`, off in builds unless VITE_DEV_LOGIN=true.
// The server must also allow it (DEV_LOGIN=true, refused in production).
const DEV_LOGIN = import.meta.env.VITE_DEV_LOGIN === 'true' || (import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN !== 'false');

type Boot = { kind: 'loading' } | { kind: 'ready'; user: User } | { kind: 'dev' } | { kind: 'error'; message: string };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });

  const signIn = useCallback(async () => {
    setBoot({ kind: 'loading' });
    const initData = telegram.initData();
    try {
      if (initData) {
        const r = await api<{ token: string; user: User }>('/auth/telegram', { body: { initData } });
        session.set(r.token);
        return setBoot({ kind: 'ready', user: r.user });
      }
      if (session.token) {
        const r = await api<{ user: User }>('/me');
        return setBoot({ kind: 'ready', user: r.user });
      }
      setBoot(DEV_LOGIN ? { kind: 'dev' } : { kind: 'error', message: '' });
    } catch (e) {
      session.clear();
      setBoot(DEV_LOGIN && !initData ? { kind: 'dev' } : { kind: 'error', message: e instanceof ApiError ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    telegram.init();
    void signIn();
  }, [signIn]);

  // Amharic unless the player chose another language.
  const fromUser = boot.kind === 'ready' ? boot.user.language : 'am';
  const lang: Lang = fromUser === 'en' || fromUser === 'om' ? fromUser : 'am';
  return (
    <I18nProvider key={boot.kind === 'ready' ? boot.user.id : 'anon'} initial={lang}>
      {boot.kind === 'ready' ? (
        <Shell user={boot.user} />
      ) : boot.kind === 'dev' ? (
        <DevLogin onDone={(user) => setBoot({ kind: 'ready', user })} />
      ) : boot.kind === 'error' ? (
        <ErrorScreen message={boot.message} onRetry={signIn} />
      ) : (
        <div className="flex h-full items-center justify-center font-display text-2xl text-gold">BINGO</div>
      )}
    </I18nProvider>
  );
}

type Tab = 'game' | 'wallet' | 'profile';

function Shell({ user }: { user: User }) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>('game');
  /** The room being played or watched; null shows the list of games. */
  const [roomId, setRoomId] = useState<string | null>(null);
  const backToGames = useCallback(() => setRoomId(null), []);
  // Telegram's back arrow returns from a room to the list of games.
  useEffect(() => telegram.backButton(tab === 'game' && roomId ? backToGames : null), [tab, roomId, backToGames]);
  const [wallet, setWallet] = useState<Balances | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    void api<{ wallet: Balances }>('/me').then((r) => setWallet(r.wallet));
  }, []);
  // Saves the language choice so the bot and next visit use it too.
  const firstLang = useRef(lang);
  useEffect(() => {
    if (lang !== firstLang.current) void api('/me/language', { body: { language: lang } }).catch(() => undefined);
  }, [lang]);

  const showToast = useCallback((m: string) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  return (
    <div className="mx-auto flex min-h-full max-w-[520px] flex-col">
      <Header user={user} wallet={wallet} />
      {/* Tells the player when the phone loses its connection, and refreshes the wallet when it is back. */}
      <ConnectionBanner onBack={() => void api<{ wallet: Balances }>('/me').then((r) => setWallet(r.wallet)).catch(() => undefined)} />
      <main className="flex-1 pb-20">
        {/* The game stays mounted so the live connection survives tab switches. */}
        <div hidden={tab !== 'game'}>
          {roomId ? (
            <>
              <button type="button" onClick={backToGames} className="flex w-full items-center gap-1.5 border-b border-line px-3 py-2 text-left text-xs font-bold text-muted active:text-ink">
                <span aria-hidden>‹</span> {t('allGames')}
              </button>
              <GameScreen key={roomId} roomId={roomId} onWallet={setWallet} onNeedMoney={() => setTab('wallet')} toast={showToast} />
            </>
          ) : (
            <Lobby onOpen={setRoomId} />
          )}
        </div>
        {tab === 'wallet' && <WalletView wallet={wallet} />}
        {tab === 'profile' && <ProfileView user={user} />}
      </main>
      {toast && (
        <div role="status" className="pop fixed inset-x-3 bottom-20 z-40 mx-auto max-w-[480px] rounded-xl border border-line bg-panel-2 px-4 py-3 text-center text-sm font-semibold shadow-2xl">
          {toast}
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-[520px] grid-cols-3">
          {(
            [
              ['game', '◉', t('game')],
              ['wallet', '▣', t('wallet')],
              ['profile', '☺', t('profile')],
            ] as const
          ).map(([k, icon, label]) => (
            <button key={k} type="button" onClick={() => (k === 'game' && tab === 'game' ? setRoomId(null) : setTab(k))} aria-current={tab === k} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold ${tab === k ? 'text-gold' : 'text-muted'}`}>
              <span className="text-lg leading-none">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function DevLogin({ onDone }: { onDone: (u: User) => void }) {
  const { t } = useI18n();
  const [id, setId] = useState('100');
  const [name, setName] = useState('Abebe');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ token: string; user: User }>('/auth/dev', { body: { telegramId: Number(id), firstName: name } });
      session.set(r.token);
      onDone(r.user);
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    }
  };
  const field = 'rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none focus:border-gold';
  return (
    <form onSubmit={submit} className="mx-auto flex max-w-sm flex-col gap-3 px-6 py-16">
      <p className="font-display text-2xl text-gold">BINGO</p>
      <h1 className="text-lg font-black">{t('signInDev')}</h1>
      <p className="text-xs text-muted">Outside Telegram, for testing only. Each Telegram id is a separate player; id 1 is staff.</p>
      <input aria-label="Telegram id" className={field} value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ''))} />
      <input aria-label="Name" className={field} value={name} onChange={(e) => setName(e.target.value)} />
      {err && <p className="text-sm text-danger">{err}</p>}
      <button type="submit" className="rounded-xl bg-gold py-3 font-black text-gold-ink">
        Sign in
      </button>
    </form>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="font-display text-2xl text-gold">BINGO</p>
      <p className="text-sm">{message || t('telegramOnly')}</p>
      <button type="button" onClick={onRetry} className="rounded-xl border border-line px-4 py-2 text-sm font-bold">
        {t('retry')}
      </button>
    </div>
  );
}
