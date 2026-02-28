import type { Tile } from '@lib/tiles';
import { createTileView } from './tile-view';

export function createBonusDisplay(bonusTiles: Tile[], small = false): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bonus-tiles';

  if (bonusTiles.length === 0) return el;

  for (const tile of bonusTiles) {
    el.appendChild(createTileView(tile, { small }));
  }

  return el;
}
