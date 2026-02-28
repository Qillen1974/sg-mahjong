import type { Tile } from '@lib/tiles';
import { createTileView } from './tile-view';

export interface PlayerHandOptions {
  tiles: Tile[];
  selectedTile: Tile | null;
  canDiscard: boolean;
  onTileClick: (tile: Tile) => void;
}

export function createPlayerHand(opts: PlayerHandOptions): HTMLElement {
  const el = document.createElement('div');
  el.className = 'player-hand';

  for (const tile of opts.tiles) {
    const isSelected = opts.selectedTile !== null && tile.id === opts.selectedTile.id;
    const tileEl = createTileView(tile, {
      selectable: opts.canDiscard,
      selected: isSelected,
      onClick: opts.onTileClick,
    });
    el.appendChild(tileEl);
  }

  return el;
}
