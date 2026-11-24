import { useEffect, useState } from 'react';
import { api, fmtDate, type Money } from '../api';
import { Birr, Button, Empty, ErrorLine, Panel, Stat, field, useApi, useToast } from '../ui';

interface RocketSettings {
  enabled: boolean;
  houseEdgePercent: number;
  minBetBirr: number;
  maxBetBirr: number;
  maxX: number;
  maxWinBirr: number;
  bettingSeconds: number;
}

interface RocketReport {
  settings: RocketSettings;
  houseResult: Money;
  period: { days: number; rounds: number; players: number; bets: Money; paid: Money; result: Money };
  rounds: { number: number; crashX: number; bets: number; totalBet: Money; totalPaid: Money; result: Money; seedHash: string; serverSeed: string; at: string }[];
}

const PERIODS = [1, 7, 30];

/** Leyu Rocket: switch the game on or off, set limits, and watch its result. */
export function Rocket() {
  const [days, setDays] = useState(7);
  const report = useApi<RocketReport>(`/admin/rocket?days=${days}`, 10_000);
  const r = report.data;
  return (
    <div className="flex flex-col gap-4">
      <ErrorLine error={report.error} />
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((d) => (
          <Button key={d} tone={d === days ? 'primary' : 'plain'} onClick={() => setDays(d)}>
            {d === 1 ? 'Today' : `${d} days`}
          </Button>
        ))}
      </div>
      {r && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Rounds" value={r.period.rounds.toLocaleString()} hint={`${r.period.players} players`} />
          <Stat label="Bets" value={<Birr m={r.period.bets} />} />
          <Stat label="Paid to players" value={<Birr m={r.period.paid} />} />
          <Stat label="House result" value={<Birr m={r.period.result} signed />} tone={r.period.result.birr.startsWith('-') ? 'bad' : 'good'} hint={`last ${r.period.days} day(s)`} />
          <Stat label="House result, all time" value={<Birr m={r.houseResult} signed />} hint="Rocket house account" />
        </div>
      )}
      {r && <SettingsForm settings={r.settings} onSaved={report.reload} />}
      <Panel title="Last 50 rounds">
        {r?.rounds.length === 0 && <Empty>No rounds played yet.</Empty>}
        {!!r?.rounds.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2">Round</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2 text-right">Crash</th>
                  <th className="px-4 py-2 text-right">Bets</th>
                  <th className="px-4 py-2 text-right">Staked</th>
                  <th className="px-4 py-2 text-right">Paid</th>
                  <th className="px-4 py-2 text-right">House</th>
                  <th className="px-4 py-2">Seed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.rounds.map((x) => (
                  <tr key={x.number}>
                    <td className="num px-4 py-2">#{x.number}</td>
                    <td className="px-4 py-2 text-muted">{fmtDate(x.at)}</td>
                    <td className={`num px-4 py-2 text-right font-bold ${x.crashX >= 2 ? 'text-good' : ''}`}>{x.crashX.toFixed(2)}×</td>
                    <td className="num px-4 py-2 text-right">{x.bets}</td>
                    <td className="px-4 py-2 text-right"><Birr m={x.totalBet} /></td>
                    <td className="px-4 py-2 text-right"><Birr m={x.totalPaid} /></td>
                    <td className="px-4 py-2 text-right"><Birr m={x.result} signed /></td>
                    <td className="num max-w-[10rem] truncate px-4 py-2 text-xs text-muted" title={`hash ${x.seedHash}\nseed ${x.serverSeed}`}>
                      {x.serverSeed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function SettingsForm({ settings, onSaved }: { settings: RocketSettings; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(settings);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(settings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setF(settings), [key]);
  const set = <K extends keyof RocketSettings>(k: K, v: RocketSettings[K]) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== key;

  const save = async (body: Partial<RocketSettings>, ok: string) => {
    setBusy(true);
    try {
      await api('/admin/rocket/settings', { method: 'PATCH', body });
      toast(ok);
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const num = (k: Exclude<keyof RocketSettings, 'enabled'>, label: string, hint: string, step = 1) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      <input type="number" step={step} min={0} className={field} value={f[k]} onChange={(e) => set(k, Number(e.target.value))} />
      <span className="text-xs text-muted">{hint}</span>
    </label>
  );

  return (
    <Panel
      title="Leyu Rocket settings"
      action={
        <Button
          tone={settings.enabled ? 'bad' : 'good'}
          disabled={busy}
          onClick={() => save({ enabled: !settings.enabled }, settings.enabled ? 'Rocket switched off' : 'Rocket switched on')}
        >
          {settings.enabled ? 'Switch off' : 'Switch on'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm">
          Status:{' '}
          <span className={`font-bold ${settings.enabled ? 'text-good' : 'text-bad'}`}>{settings.enabled ? 'open to players' : 'closed'}</span>
          <span className="text-muted"> · switching off lets the current round finish; no new round opens.</span>
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {num('houseEdgePercent', 'House edge (%)', 'Players get back about (100 − edge)% over time. 0–20.', 0.1)}
          {num('minBetBirr', 'Lowest bet (birr)', 'Per bet slot.')}
          {num('maxBetBirr', 'Highest bet (birr)', 'Per bet slot.')}
          {num('maxX', 'Highest multiplier (×)', 'The rocket always crashes at or before this.', 0.01)}
          {num('maxWinBirr', 'Highest win per bet (birr)', 'A bet is paid out automatically when it reaches this.')}
          {num('bettingSeconds', 'Betting time (seconds)', 'Time to place bets before each take-off.')}
        </div>
        <p className="text-xs text-muted">
          With these settings the most one bet can win is <b>{Math.min(f.maxBetBirr * f.maxX, f.maxWinBirr).toLocaleString()} birr</b>. Keep enough money in the
          Telebirr account to pay several of those at once.
        </p>
        <div className="flex gap-2">
          <Button tone="primary" disabled={busy || !dirty} onClick={() => save({ ...f, enabled: undefined }, 'Rocket settings saved')}>
            Save settings
          </Button>
          {dirty && (
            <Button disabled={busy} onClick={() => setF(settings)}>
              Undo changes
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
