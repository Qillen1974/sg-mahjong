import type { GameState, PlayerAction } from '@lib/game-types';
import type { Tile } from '@lib/tiles';
import { createPlayerHand } from './player-hand';
import { createOpponentArea } from './opponent-area';
import { createDiscardPool } from './discard-pool';
import { createMeldsRow } from './meld-display';
import { createBonusDisplay } from './bonus-display';
import { createActionBar } from './action-bar';

/** Player avatar/name config per seat index. */
export const PLAYER_CONFIG = [
  { name: 'You',       avatar: '\u{1F004}' }, // 🀄
  { name: 'Ah Huat',   avatar: '\u{1F474}' }, // 👴
  { name: 'Mei Ling',  avatar: '\u{1F475}' }, // 👵
  { name: 'Uncle Koh',  avatar: '\u{1F9D3}' }, // 🧓
] as const;

export interface GameBoardOptions {
  state: GameState;
  validActions: PlayerAction[];
  selectedTile: Tile | null;
  lastDrawnTileId?: string | null;
  onTileClick: (tile: Tile) => void;
  onAction: (action: PlayerAction) => void;
  /** Which seat index is "you" (bottom of the board). Defaults to 0. */
  mySeat?: number;
  /** Player names per seat index. Falls back to PLAYER_CONFIG defaults. */
  playerNames?: string[];
  /** Avatars per seat index. Falls back to PLAYER_CONFIG defaults. */
  playerAvatars?: string[];
}

export function createGameBoard(opts: GameBoardOptions): HTMLElement {
  const { state, validActions, selectedTile, lastDrawnTileId, onTileClick, onAction } = opts;
  const mySeat = opts.mySeat ?? 0;
  const names = opts.playerNames ?? PLAYER_CONFIG.map(p => p.name);
  const avatars = opts.playerAvatars ?? PLAYER_CONFIG.map(p => p.avatar);
  const el = document.createElement('div');
  el.className = 'game-board';
  const currentPlayer = state.currentPlayerIndex;

  // Seat mapping: bottom=me, right=+1, top=+2, left=+3
  const bottomIdx = mySeat;
  const rightIdx = (mySeat + 1) % 4;
  const topIdx = (mySeat + 2) % 4;
  const leftIdx = (mySeat + 3) % 4;

  const human = state.players[bottomIdx];
  const canDiscard = validActions.some(a => a.type === 'discard');

  // Info bar — grid-area: info
  const topInfo = document.createElement('div');
  topInfo.className = 'board-info area-info';
  const wallCount = (state as any).wallCount ?? state.wall?.length ?? 0;
  topInfo.innerHTML = `
    <span>Wind: ${state.prevailingWind[0].toUpperCase()}</span>
    <span>Turn: ${state.turnNumber}</span>
    <span>Wall: ${wallCount}</span>
  `;
  el.appendChild(topInfo);

  // Top opponent — grid-area: top
  const topOpp = createOpponentArea({
    player: state.players[topIdx],
    position: 'top',
    isDealer: state.dealerIndex === topIdx,
    isCurrentTurn: currentPlayer === topIdx,
    name: names[topIdx],
    avatar: avatars[topIdx],
  });
  topOpp.classList.add('area-top');
  el.appendChild(topOpp);

  // Left opponent — grid-area: left
  const leftOpp = createOpponentArea({
    player: state.players[leftIdx],
    position: 'left',
    isDealer: state.dealerIndex === leftIdx,
    isCurrentTurn: currentPlayer === leftIdx,
    name: names[leftIdx],
    avatar: avatars[leftIdx],
  });
  leftOpp.classList.add('area-left');
  el.appendChild(leftOpp);

  // Discard pool — grid-area: center
  const discards = createDiscardPool(state.players, state.lastDiscard);
  discards.classList.add('area-center');
  el.appendChild(discards);

  // Right opponent — grid-area: right
  const rightOpp = createOpponentArea({
    player: state.players[rightIdx],
    position: 'right',
    isDealer: state.dealerIndex === rightIdx,
    isCurrentTurn: currentPlayer === rightIdx,
    name: names[rightIdx],
    avatar: avatars[rightIdx],
  });
  rightOpp.classList.add('area-right');
  el.appendChild(rightOpp);

  // Bottom area: human melds + info + hand — grid-area: bottom
  const bottomArea = document.createElement('div');
  bottomArea.className = `area-bottom${currentPlayer === bottomIdx ? ' active-turn' : ''}`;

  // Human melds + bonus
  const myMelds = document.createElement('div');
  myMelds.className = 'my-melds-area';
  if (human.openMelds.length > 0) {
    myMelds.appendChild(createMeldsRow(human.openMelds));
  }
  if (human.bonusTiles.length > 0) {
    myMelds.appendChild(createBonusDisplay(human.bonusTiles));
  }
  bottomArea.appendChild(myMelds);

  // Human info row: avatar + wind + name
  const myInfo = document.createElement('div');
  myInfo.className = 'my-info';

  const myAvatar = document.createElement('span');
  myAvatar.className = 'avatar';
  myAvatar.textContent = avatars[bottomIdx];
  myInfo.appendChild(myAvatar);

  const myWind = document.createElement('span');
  myWind.className = `wind-label${state.dealerIndex === bottomIdx ? ' dealer' : ''}`;
  myWind.textContent = human.seat[0].toUpperCase();
  myInfo.appendChild(myWind);

  const myName = document.createElement('span');
  myName.className = 'player-name';
  myName.textContent = names[bottomIdx];
  myInfo.appendChild(myName);

  bottomArea.appendChild(myInfo);

  // Human hand
  const handTiles = human.handTiles ?? (human as any).handTilesList ?? [];
  const hand = createPlayerHand({
    tiles: handTiles,
    selectedTile,
    canDiscard,
    onTileClick,
    lastDrawnTileId: lastDrawnTileId ?? undefined,
  });
  bottomArea.appendChild(hand);

  el.appendChild(bottomArea);

  // Action bar — grid-area: acts
  const actions = createActionBar({
    actions: validActions,
    selectedTile,
    onAction,
  });
  actions.classList.add('area-actions');
  el.appendChild(actions);

  return el;
}
