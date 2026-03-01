import type { Tile } from '@lib/tiles';
import { createTileView } from './tile-view';

const SUIT_ORDER: Record<string, number> = {
  characters: 0, dots: 1, bamboo: 2,
  winds: 3, dragons: 4,
  flowers: 5, seasons: 6, animals: 7,
};

const WIND_ORDER: Record<string, number> = {
  east: 1, south: 2, west: 3, north: 4,
};

const DRAGON_ORDER: Record<string, number> = {
  red: 1, green: 2, white: 3,
};

function tileSortKey(t: Tile): number {
  const suitVal = (SUIT_ORDER[t.suit] ?? 9) * 100;
  if (typeof t.value === 'number') return suitVal + t.value;
  if (t.suit === 'winds') return suitVal + (WIND_ORDER[t.value as string] ?? 0);
  if (t.suit === 'dragons') return suitVal + (DRAGON_ORDER[t.value as string] ?? 0);
  return suitVal;
}

function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => tileSortKey(a) - tileSortKey(b));
}

export interface PlayerHandOptions {
  tiles: Tile[];
  selectedTile: Tile | null;
  canDiscard: boolean;
  onTileClick: (tile: Tile) => void;
  lastDrawnTileId?: string;
}

export function createPlayerHand(opts: PlayerHandOptions): HTMLElement {
  const el = document.createElement('div');
  el.className = 'player-hand';

  const sorted = sortTiles(opts.tiles);

  // Separate drawn tile from the rest if specified
  let mainTiles: Tile[];
  let drawnTile: Tile | undefined;

  if (opts.lastDrawnTileId) {
    const idx = sorted.findIndex(t => t.id === opts.lastDrawnTileId);
    if (idx !== -1) {
      drawnTile = sorted[idx];
      mainTiles = [...sorted.slice(0, idx), ...sorted.slice(idx + 1)];
    } else {
      mainTiles = sorted;
    }
  } else {
    mainTiles = sorted;
  }

  for (const tile of mainTiles) {
    const isSelected = opts.selectedTile !== null && tile.id === opts.selectedTile.id;
    const tileEl = createTileView(tile, {
      selectable: opts.canDiscard,
      selected: isSelected,
      onClick: opts.onTileClick,
    });
    el.appendChild(tileEl);
  }

  if (drawnTile) {
    const gap = document.createElement('div');
    gap.className = 'drawn-tile-gap';
    el.appendChild(gap);

    const isSelected = opts.selectedTile !== null && drawnTile.id === opts.selectedTile.id;
    const tileEl = createTileView(drawnTile, {
      selectable: opts.canDiscard,
      selected: isSelected,
      onClick: opts.onTileClick,
    });
    el.appendChild(tileEl);
  }

  return el;
}
