import type { MeldedSet } from '@lib/scoring';
import { createTileView } from './tile-view';

export function createMeldDisplay(meld: MeldedSet, small = false): HTMLElement {
  const el = document.createElement('div');
  el.className = 'meld-group';
  if (meld.concealed) el.classList.add('meld-concealed');

  for (const tile of meld.tiles) {
    el.appendChild(createTileView(tile, {
      faceDown: meld.concealed,
      small,
    }));
  }

  return el;
}

export function createMeldsRow(melds: MeldedSet[], small = false): HTMLElement {
  const row = document.createElement('div');
  row.className = 'melds-row';
  for (const meld of melds) {
    row.appendChild(createMeldDisplay(meld, small));
  }
  return row;
}
