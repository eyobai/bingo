import { useEffect, useState } from 'react';
import { api, type Money, type User } from './api';
import { useI18n } from './i18n';
import { telegram } from './telegram';

interface Game {
  roundNumber: number;
  status: string;
  at: string;
  cards: number[];
  cost: Money;
  prize: Money;
}

export function ProfileView({ user }: { user: User }) {
  const { t } = useI18n();
  const [invited, setInvited] = useState<number | null>(null);
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    void api<{ invited: number }>('/me').then((r) => setInvited(r.invited));
    void api<Game[]>('/me/games').then(setGames);
  }, []);

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <section className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white font-display text-xl text-gray-900">{user.firstName.slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0">
          <p className="truncate text-lg font-black">{user.firstName}</p>
          <p className="text-xs text-muted">
            {user.username ? `@${user.username} · ` : ''}
            {t('memberSince')} {new Date(user.memberSince).toLocaleDateString()}
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-gold/40 bg-gold/5 p-4">
        <h2 className="font-display text-sm uppercase tracking-wider text-gold">{t('inviteTitle')}</h2>
        <p className="text-xs text-muted">{t('inviteBody')}</p>
        {user.inviteLink && <p className="select-all break-all rounded-lg bg-bg/60 px-3 py-2 text-xs">{user.inviteLink}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {t('invited')}: <b className="text-ink">{invited ?? '–'}</b>
          </span>
          {user.inviteLink && (
            <button type="button" onClick={() => telegram.share(user.inviteLink!, '🎱 Bingo')} className="rounded-xl bg-gold px-4 py-2 text-sm font-black text-gold-ink">
              {t('share')}
            </button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="px-1 pb-1 font-display text-xs uppercase tracking-wider text-muted">{t('myGames')}</h2>
        {games.length === 0 && <p className="px-1 text-xs text-muted">{t('noHistory')}</p>}
        {games.map((g) => {
          const won = g.prize.minor !== '0';
          const label = g.status === 'CANCELLED' ? t('cancelledShort') : won ? `${t('won')} +${g.prize.birr}` : g.status === 'FINISHED' ? `${t('lost')} −${g.cost.birr}` : '…';
          return (
            <div key={g.roundNumber} className="flex items-center justify-between gap-2 border-b border-line/60 px-1 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">#{g.roundNumber}</p>
                <p className="truncate text-[10px] text-muted">
                  {new Date(g.at).toLocaleString()} · {g.cards.map((c) => '#' + c).join(' ')}
                </p>
              </div>
              <span className={`shrink-0 text-xs font-bold ${won ? 'text-win' : 'text-muted'}`}>{label}</span>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="pb-1 font-display text-sm uppercase tracking-wider">{t('rules')}</h2>
        <p className="text-sm leading-relaxed text-muted">{t('rulesBody')}</p>
      </section>
    </div>
  );
}
