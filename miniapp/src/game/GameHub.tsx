import { useI18n } from '../i18n';
import { RocketTile } from '../rocket/Rocket';
import { ComingSoonTile } from './GameTile';
import { BingoTile } from './Lobby';

/** Every game in the app, in the order shown on the picker. To add a game, add its tile here and its screen in App. */
export type GameId = 'bingo' | 'rocket';

/** The first screen of the Games tab: pick a game. */
export function GameHub({ onOpen }: { onOpen: (game: GameId) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3 px-3 pb-4 pt-3">
      <div className="px-1">
        <h1 className="font-display text-2xl">{t('games')}</h1>
        <p className="text-xs text-muted">{t('hubSub')}</p>
      </div>
      <BingoTile onOpen={() => onOpen('bingo')} />
      <RocketTile onOpen={() => onOpen('rocket')} />
      <ComingSoonTile />
      <p className="px-1 text-center text-[11px] text-muted">{t('rocketResponsible')}</p>
    </div>
  );
}
