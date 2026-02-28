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
  bubbles: Map<number, string>;
  onTileClick: (tile: Tile) => void;
  onAction: (action: PlayerAction) => void;
}

export function createGameBoard(opts: GameBoardOptions): HTMLElement {
  const { state, validActions, selectedTile, bubbles, onTileClick, onAction } = opts;
  const el = document.createElement('div');
  el.className = 'game-board';

  const human = state.players[0];
  const canDiscard = validActions.some(a => a.type === 'discard');

  // Info bar (top) — round info
  const topInfo = document.createElement('div');
  topInfo.className = 'board-info';
  topInfo.innerHTML = `
    <span>Wind: ${state.prevailingWind[0].toUpperCase()}</span>
    <span>Turn: ${state.turnNumber}</span>
    <span>Wall: ${state.wall.length}</span>
  `;
  el.appendChild(topInfo);

  // Top opponent (player 2)
  const topOpp = createOpponentArea({
    player: state.players[2],
    position: 'top',
    isDealer: state.dealerIndex === 2,
    name: PLAYER_CONFIG[2].name,
    avatar: PLAYER_CONFIG[2].avatar,
    bubble: bubbles.get(2),
  });
  el.appendChild(topOpp);

  // Middle row: left opponent + discard pool + right opponent
  const midRow = document.createElement('div');
  midRow.className = 'board-middle';

  const leftOpp = createOpponentArea({
    player: state.players[3],
    position: 'left',
    isDealer: state.dealerIndex === 3,
    name: PLAYER_CONFIG[3].name,
    avatar: PLAYER_CONFIG[3].avatar,
    bubble: bubbles.get(3),
  });
  midRow.appendChild(leftOpp);

  const discards = createDiscardPool(state.players, state.lastDiscard);
  midRow.appendChild(discards);

  const rightOpp = createOpponentArea({
    player: state.players[1],
    position: 'right',
    isDealer: state.dealerIndex === 1,
    name: PLAYER_CONFIG[1].name,
    avatar: PLAYER_CONFIG[1].avatar,
    bubble: bubbles.get(1),
  });
  midRow.appendChild(rightOpp);

  el.appendChild(midRow);

  // Human melds + bonus
  const myMelds = document.createElement('div');
  myMelds.className = 'my-melds-area';
  if (human.openMelds.length > 0) {
    myMelds.appendChild(createMeldsRow(human.openMelds));
  }
  if (human.bonusTiles.length > 0) {
    myMelds.appendChild(createBonusDisplay(human.bonusTiles));
  }
  el.appendChild(myMelds);

  // Human info row: avatar + wind + name + bubble
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

  // Human speech bubble
  const humanBubble = bubbles.get(0);
  if (humanBubble) {
    const bubble = document.createElement('span');
    bubble.className = 'speech-bubble speech-bubble-above';
    bubble.textContent = humanBubble;
    myInfo.appendChild(bubble);
  }

  el.appendChild(myInfo);

  // Human hand (bottom)
  const hand = createPlayerHand({
    tiles: human.handTiles,
    selectedTile,
    canDiscard,
    onTileClick,
  });
  el.appendChild(hand);

  // Action bar
  const actions = createActionBar({
    actions: validActions,
    selectedTile,
    onAction,
  });
  el.appendChild(actions);

  return el;
}
