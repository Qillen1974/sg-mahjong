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
}

export function createGameBoard(opts: GameBoardOptions): HTMLElement {
  const { state, validActions, selectedTile, lastDrawnTileId, onTileClick, onAction } = opts;
  const el = document.createElement('div');
  el.className = 'game-board';

  const human = state.players[0];
  const canDiscard = validActions.some(a => a.type === 'discard');

  // Info bar — grid-area: info
  const topInfo = document.createElement('div');
  topInfo.className = 'board-info area-info';
  topInfo.innerHTML = `
    <span>Wind: ${state.prevailingWind[0].toUpperCase()}</span>
    <span>Turn: ${state.turnNumber}</span>
    <span>Wall: ${state.wall.length}</span>
  `;
  el.appendChild(topInfo);

  // Top opponent (player 2) — grid-area: top
  const topOpp = createOpponentArea({
    player: state.players[2],
    position: 'top',
    isDealer: state.dealerIndex === 2,
    name: PLAYER_CONFIG[2].name,
    avatar: PLAYER_CONFIG[2].avatar,
  });
  topOpp.classList.add('area-top');
  el.appendChild(topOpp);

  // Left opponent (player 3) — grid-area: left
  const leftOpp = createOpponentArea({
    player: state.players[3],
    position: 'left',
    isDealer: state.dealerIndex === 3,
    name: PLAYER_CONFIG[3].name,
    avatar: PLAYER_CONFIG[3].avatar,
  });
  leftOpp.classList.add('area-left');
  el.appendChild(leftOpp);

  // Discard pool — grid-area: center
  const discards = createDiscardPool(state.players, state.lastDiscard);
  discards.classList.add('area-center');
  el.appendChild(discards);

  // Right opponent (player 1) — grid-area: right
  const rightOpp = createOpponentArea({
    player: state.players[1],
    position: 'right',
    isDealer: state.dealerIndex === 1,
    name: PLAYER_CONFIG[1].name,
    avatar: PLAYER_CONFIG[1].avatar,
  });
  rightOpp.classList.add('area-right');
  el.appendChild(rightOpp);

  // Bottom area: human melds + info + hand — grid-area: bottom
  const bottomArea = document.createElement('div');
  bottomArea.className = 'area-bottom';

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
  myAvatar.textContent = PLAYER_CONFIG[0].avatar;
  myInfo.appendChild(myAvatar);

  const myWind = document.createElement('span');
  myWind.className = `wind-label${state.dealerIndex === 0 ? ' dealer' : ''}`;
  myWind.textContent = human.seat[0].toUpperCase();
  myInfo.appendChild(myWind);

  const myName = document.createElement('span');
  myName.className = 'player-name';
  myName.textContent = PLAYER_CONFIG[0].name;
  myInfo.appendChild(myName);

  bottomArea.appendChild(myInfo);

  // Human hand
  const hand = createPlayerHand({
    tiles: human.handTiles,
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
