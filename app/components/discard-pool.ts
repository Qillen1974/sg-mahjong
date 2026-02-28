import type { PlayerState } from '@lib/game-types';
import type { Tile } from '@lib/tiles';
import { createTileView } from './tile-view';

export function createDiscardPool(players: readonly PlayerState[], lastDiscard: Tile | null): HTMLElement {
  const el = document.createElement('div');
  el.className = 'discard-pool';

  for (let i = 0; i < 4; i++) {
    const section = document.createElement('div');
    section.className = `discard-section discard-p${i}`;

    for (const tile of players[i].discards) {
      const tileEl = createTileView(tile, { small: true });
      // Highlight the last discard
      if (lastDiscard && tile.id === lastDiscard.id) {
        tileEl.classList.add('last-discard');
      }
      section.appendChild(tileEl);
    }

    el.appendChild(section);
  }

  return el;
}
