import type { PlayerState } from '@lib/game-types';
import type { Wind } from '@lib/tiles';
import { createTileBack } from './tile-view';
import { createMeldsRow } from './meld-display';
import { createBonusDisplay } from './bonus-display';

export interface OpponentAreaOptions {
  player: PlayerState;
  position: 'top' | 'left' | 'right';
  isDealer: boolean;
  name: string;
  avatar: string;
  bubble?: string;
}

function windChar(w: Wind): string {
  return w[0].toUpperCase();
}

export function createOpponentArea(opts: OpponentAreaOptions): HTMLElement {
  const { player, position, isDealer, name, avatar, bubble } = opts;
  const el = document.createElement('div');
  el.className = `opponent-area opponent-${position}`;

  // Info bar: avatar + wind + name + tile count
  const info = document.createElement('div');
  info.className = 'opponent-info';

  const avatarEl = document.createElement('span');
  avatarEl.className = 'avatar';
  avatarEl.textContent = avatar;
  info.appendChild(avatarEl);

  const wind = document.createElement('span');
  wind.className = `wind-label${isDealer ? ' dealer' : ''}`;
  wind.textContent = windChar(player.seat);
  info.appendChild(wind);

  const nameEl = document.createElement('span');
  nameEl.className = 'player-name';
  nameEl.textContent = name;
  info.appendChild(nameEl);

  const count = document.createElement('span');
  count.className = 'tile-count';
  count.textContent = `${player.handTiles.length}`;
  info.appendChild(count);

  el.appendChild(info);

  // Speech bubble
  if (bubble) {
    const bubbleEl = document.createElement('div');
    const bubblePos =
      position === 'top' ? 'speech-bubble-below' :
      position === 'left' ? 'speech-bubble-right' :
      'speech-bubble-left';
    bubbleEl.className = `speech-bubble ${bubblePos}`;
    bubbleEl.textContent = bubble;
    el.appendChild(bubbleEl);
  }

  // Concealed tiles (face-down)
  const hand = document.createElement('div');
  hand.className = 'opponent-hand';
  const isVertical = position === 'left' || position === 'right';

  for (let i = 0; i < player.handTiles.length; i++) {
    const back = createTileBack(true);
    if (isVertical) back.classList.add('tile-rotated');
    hand.appendChild(back);
  }
  el.appendChild(hand);

  // Open melds
  if (player.openMelds.length > 0) {
    el.appendChild(createMeldsRow(player.openMelds, true));
  }

  // Bonus tiles
  if (player.bonusTiles.length > 0) {
    el.appendChild(createBonusDisplay(player.bonusTiles, true));
  }

  return el;
}
