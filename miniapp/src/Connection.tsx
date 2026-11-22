import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';

/** True while the phone has a network connection (the browser's own signal). */
export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/**
 * A bar under the header: red while the phone is offline, then green "back online" for a moment.
 * `onBack` runs when the connection returns (e.g. to refresh the wallet).
 */
export function ConnectionBanner({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const online = useOnline();
  const [justBack, setJustBack] = useState(false);
  const wasOffline = useRef(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setJustBack(false);
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setJustBack(true);
    onBackRef.current?.();
    const id = setTimeout(() => setJustBack(false), 2500);
    return () => clearTimeout(id);
  }, [online]);

  if (online && !justBack) return null;
  return (
    <div
      role={online ? 'status' : 'alert'}
      aria-live="assertive"
      className={`sticky top-0 z-30 px-3 py-2 text-center text-xs font-bold ${online ? 'bg-win text-white' : 'bg-danger text-white'}`}
    >
      {online ? t('backOnline') : t('offline')}
    </div>
  );
}

/** Online, but the live game connection dropped (server unreachable): shown inside the game. */
export function ReconnectingBar() {
  const { t } = useI18n();
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 bg-amber-400 px-3 py-1.5 text-center text-[11px] font-bold text-amber-950">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-950" aria-hidden />
      {t('reconnecting')}
    </div>
  );
}
