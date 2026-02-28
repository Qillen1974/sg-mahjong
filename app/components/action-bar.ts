import type { PlayerAction } from '@lib/game-types';
import type { Tile } from '@lib/tiles';
import { canChow } from '@lib/game';

export interface ActionBarOptions {
  actions: PlayerAction[];
  selectedTile: Tile | null;
  onAction: (action: PlayerAction) => void;
}

function actionLabel(action: PlayerAction): string {
  switch (action.type) {
    case 'discard': return 'Discard';
    case 'declareKong': return 'Kong';
    case 'promotePungToKong': return 'Kong';
    case 'declareSelfWin': return 'Win!';
    case 'claimPong': return 'Pong';
    case 'claimChow': return 'Chow';
    case 'claimKong': return 'Kong';
    case 'claimWin': return 'Win!';
    case 'pass': return 'Pass';
    default: return '?';
  }
}

function actionButtonClass(action: PlayerAction): string {
  switch (action.type) {
    case 'declareSelfWin':
    case 'claimWin':
      return 'btn btn-accent';
    case 'pass':
      return 'btn btn-secondary';
    default:
      return 'btn btn-primary';
  }
}

export function createActionBar(opts: ActionBarOptions): HTMLElement {
  const el = document.createElement('div');
  el.className = 'action-bar';

  if (opts.actions.length === 0) {
    const waiting = document.createElement('span');
    waiting.className = 'waiting-label';
    waiting.textContent = 'Waiting...';
    el.appendChild(waiting);
    return el;
  }

  // Group/deduplicate actions for display
  const seen = new Set<string>();

  for (const action of opts.actions) {
    // Skip individual discard actions — handled by tile tap + discard button
    if (action.type === 'discard') continue;

    // Deduplicate chow options into one button (selection handled separately)
    const key = action.type;
    if (seen.has(key)) continue;
    seen.add(key);

    const btn = document.createElement('button');
    btn.className = actionButtonClass(action);
    btn.textContent = actionLabel(action);
    btn.addEventListener('click', () => opts.onAction(action));
    el.appendChild(btn);
  }

  // Add discard button if the player has discard actions and a tile selected
  const hasDiscard = opts.actions.some(a => a.type === 'discard');
  if (hasDiscard) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Discard';
    btn.disabled = !opts.selectedTile;
    btn.addEventListener('click', () => {
      if (opts.selectedTile) {
        opts.onAction({ type: 'discard', tile: opts.selectedTile });
      }
    });
    el.appendChild(btn);
  }

  return el;
}
