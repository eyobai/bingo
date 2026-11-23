/**
 * Bottom-bar tab icons. Outlined when inactive; filled with the brand gold and a soft glow when selected.
 * Drawn on a 24×24 grid and coloured with `currentColor`, so they follow the tab's text colour.
 */
type Props = { active: boolean };

const base = 'h-6 w-6 transition-transform duration-200';
const glow = (active: boolean) => (active ? 'scale-110 drop-shadow-[0_0_6px_rgba(246,185,59,0.55)]' : '');

/** Game: a game controller. */
export function GameIcon({ active }: Props) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${glow(active)}`} aria-hidden="true">
      <path
        d="M7.2 6.5h9.6a4.7 4.7 0 0 1 4.6 3.8l1 5.2a2.9 2.9 0 0 1-5 2.5l-1.9-2.1H8.5L6.6 18a2.9 2.9 0 0 1-5-2.5l1-5.2a4.7 4.7 0 0 1 4.6-3.8Z"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      {/* D-pad */}
      <path d="M7.5 9.6v3.6M5.7 11.4h3.6" stroke={active ? 'var(--color-bg)' : 'currentColor'} strokeWidth="1.7" strokeLinecap="round" />
      {/* Buttons */}
      <circle cx="15.6" cy="10.3" r="1.05" fill={active ? 'var(--color-bg)' : 'currentColor'} />
      <circle cx="17.8" cy="12.5" r="1.05" fill={active ? 'var(--color-bg)' : 'currentColor'} />
    </svg>
  );
}

/** Wallet: a wallet with a coin clasp. */
export function WalletIcon({ active }: Props) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${glow(active)}`} aria-hidden="true">
      <path
        d="M4.5 7.2 15.8 3.9a1.6 1.6 0 0 1 2 1.5v1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="2.8"
        y="7"
        width="18.4"
        height="13.2"
        rx="3"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M21.2 11.2h-4.1a2.4 2.4 0 0 0 0 4.8h4.1"
        fill={active ? 'var(--color-bg)' : 'none'}
        stroke={active ? 'var(--color-bg)' : 'currentColor'}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="17.3" cy="13.6" r="1" fill={active ? 'currentColor' : 'currentColor'} />
    </svg>
  );
}

/** Profile: a player avatar in a badge. */
export function ProfileIcon({ active }: Props) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${glow(active)}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9.6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="9.6" r="3.2" fill="none" stroke={active ? 'var(--color-bg)' : 'currentColor'} strokeWidth="1.7" />
      <path
        d="M6.4 18.3a6.4 6.4 0 0 1 11.2 0"
        fill="none"
        stroke={active ? 'var(--color-bg)' : 'currentColor'}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
