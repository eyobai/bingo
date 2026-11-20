import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api } from './api';

/** Loads `path`, reloads every `everyMs` (when given) and on demand. */
export function useApi<T>(path: string | null, everyMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    setLoading(true);
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    void reload();
    if (!everyMs) return;
    const id = setInterval(() => void reload(), everyMs);
    return () => clearInterval(id);
  }, [path, everyMs, reload]);

  return { data, error, loading, reload };
}

// ─── Toasts ───

const ToastCtx = createContext<(msg: string, tone?: 'good' | 'bad') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; tone: 'good' | 'bad' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((msg: string, tone: 'good' | 'bad' = 'good') => {
    setToast({ msg, tone });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-semibold shadow-xl ${toast.tone === 'good' ? 'bg-good text-white' : 'bg-bad text-white'}`}
        >
          {toast.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ─── Pieces ───

export function Panel({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line bg-panel ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-bold">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'gold' | 'good' | 'bad' }) {
  const color = tone === 'gold' ? 'text-gold' : tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink';
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-line bg-panel px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <span className={`num truncate text-xl font-bold ${color}`}>{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  PENDING: 'bg-gold-soft text-gold',
  APPROVED: 'bg-good-soft text-good',
  PAID: 'bg-good-soft text-good',
  FINISHED: 'bg-good-soft text-good',
  REJECTED: 'bg-bad-soft text-bad',
  CANCELLED: 'bg-bad-soft text-bad',
  BLOCKED: 'bg-bad-soft text-bad',
  SELECTING: 'bg-info-soft text-ink',
  DRAWING: 'bg-gold-soft text-gold',
  ADMIN: 'bg-info-soft text-ink',
};
export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${BADGE[value] ?? 'bg-panel-2 text-muted'}`}>{label ?? value.toLowerCase()}</span>;
}

export function Birr({ m, signed }: { m: { birr: string }; signed?: boolean }) {
  const neg = m.birr.startsWith('-');
  return (
    <span className={`num whitespace-nowrap ${signed ? (neg ? 'text-bad' : 'text-good') : ''}`}>
      {signed && !neg ? '+' : ''}
      {Number(m.birr).toLocaleString('en-US', { maximumFractionDigits: 2 })} <span className="text-muted">birr</span>
    </span>
  );
}

export function Button({
  children,
  tone = 'plain',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'plain' | 'good' | 'bad' | 'primary' }) {
  const look = {
    plain: 'border border-line bg-panel text-ink hover:bg-panel-2',
    good: 'bg-good text-white hover:brightness-110',
    bad: 'bg-bad text-white hover:brightness-110',
    primary: 'bg-nav text-nav-ink hover:brightness-125',
  }[tone];
  return (
    <button type="button" {...rest} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${look} ${rest.className ?? ''}`}>
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-muted">{children}</p>;
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="px-4 py-3 text-sm text-bad">{error}</p> : null;
}

export const field = 'w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-gold';
