/**
 * Singapore Mahjong Game Engine
 *
 * Core game state machine with turn flow, claiming logic, kong mechanics,
 * win detection, and event system. Always 4 seats — AI fills empty ones.
 */

import { Tile, Wind, tileKey, tilesMatch } from './tiles';
import { MeldedSet, WinningHand, scoreHand } from './scoring';
import { dealGame, drawFromDeadWall } from './wall';
import { parseHand } from './hand-parser';
import { getAIDecision } from './ai';
import {
  TurnPhase,
  PlayerType,
  PlayerState,
  GameState,
  GameResult,
  PlayerAction,
  GameEvent,
  EventListener,
} from './game-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEATS: Wind[] = ['east', 'south', 'west', 'north'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shallow-clone a GameState for immutable updates. */
function cloneState(state: GameState): GameState {
  return {
    ...state,
    wall: [...state.wall],
    deadWall: [...state.deadWall],
    players: state.players.map(p => ({
      ...p,
      handTiles: [...p.handTiles],
      openMelds: p.openMelds.map(m => ({ ...m, tiles: [...m.tiles] })),
      bonusTiles: [...p.bonusTiles],
      discards: [...p.discards],
    })) as [PlayerState, PlayerState, PlayerState, PlayerState],
  };
}

/** Next player index (wrapping 0-3). */
function nextPlayer(index: number): number {
  return (index + 1) % 4;
}

/** Check if playerIndex is the "left player" (next in turn) of discardedBy. */
function isLeftOf(playerIndex: number, discardedBy: number): boolean {
  return nextPlayer(discardedBy) === playerIndex;
}

/**
 * Count how many copies of a tile key exist in a tile array.
 */
function countInHand(tiles: Tile[], key: string): number {
  return tiles.filter(t => tileKey(t) === key).length;
}

/**
 * Remove specific tiles from an array by id. Returns removed tiles.
 */
function removeTilesById(hand: Tile[], ids: string[]): Tile[] {
  const removed: Tile[] = [];
  const idSet = new Set(ids);
  for (let i = hand.length - 1; i >= 0; i--) {
    if (idSet.has(hand[i].id)) {
      removed.push(hand.splice(i, 1)[0]);
      idSet.delete(hand[i]?.id); // avoid double removal
    }
  }
  return removed;
}

/**
 * Remove one tile matching a key from the hand. Returns the removed tile.
 */
function removeOneTile(hand: Tile[], key: string): Tile | null {
  const idx = hand.findIndex(t => tileKey(t) === key);
  if (idx === -1) return null;
  return hand.splice(idx, 1)[0];
}

/**
 * Build a full 14-tile array for a player by combining concealed hand + open meld tiles.
 * This is needed because parseHand() expects exactly 14 tiles.
 */
function reconstructFullHand(player: PlayerState, extraTile?: Tile): Tile[] {
  const tiles: Tile[] = [...player.handTiles];
  if (extraTile) tiles.push(extraTile);
  for (const meld of player.openMelds) {
    // For kongs, only add 3 tiles (parseHand doesn't handle kong in 14 tiles)
    if (meld.type === 'kong') {
      tiles.push(...meld.tiles.slice(0, 3));
    } else {
      tiles.push(...meld.tiles);
    }
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Game Creation
// ---------------------------------------------------------------------------

/**
 * Create a new game. Deals tiles and sets up initial state.
 * @param playerTypes - Player types for each seat [East, South, West, North]. Defaults to all AI.
 * @param prevailingWind - Round wind. Defaults to 'east'.
 * @param dealerIndex - Which player index (0-3) is dealer. Defaults to 0.
 */
export function createGame(
  playerTypes: [PlayerType, PlayerType, PlayerType, PlayerType] = ['ai', 'ai', 'ai', 'ai'],
  prevailingWind: Wind = 'east',
  dealerIndex: number = 0,
): GameState {
  const setup = dealGame(dealerIndex);

  const players = setup.players.map((hand, i) => ({
    seat: hand.seat,
    type: playerTypes[i],
    handTiles: hand.handTiles,
    openMelds: [] as MeldedSet[],
    bonusTiles: hand.bonusTiles,
    discards: [] as Tile[],
  })) as [PlayerState, PlayerState, PlayerState, PlayerState];

  return {
    players,
    wall: setup.wall,
    deadWall: setup.deadWall,
    currentPlayerIndex: dealerIndex,
    phase: 'postDraw',     // Dealer already has 14 tiles, skip draw
    turnNumber: 0,
    firstTurnComplete: false,
    prevailingWind,
    dealerIndex,
    lastDiscard: null,
    lastDiscardPlayerIndex: null,
    result: null,
  };
}

// ---------------------------------------------------------------------------
// Core Turn Actions
// ---------------------------------------------------------------------------

/**
 * Draw a tile from the wall for the current player.
 * Bonus tiles are automatically set aside and replaced.
 * Phase: draw → postDraw
 */
export function drawTile(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'draw') {
    throw new Error(`Cannot draw in phase: ${state.phase}`);
  }
  if (state.wall.length === 0) {
    // Wall exhausted — game is a draw
    const s = cloneState(state);
    s.phase = 'roundOver';
    s.result = { type: 'draw' };
    return { state: s, events: [{ type: 'gameOver', result: s.result }] };
  }

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const pi = s.currentPlayerIndex;
  const player = s.players[pi];

  // Draw from wall
  let tile = s.wall.shift()!;
  events.push({ type: 'tileDrawn', playerIndex: pi, tile });

  // Replace bonus tiles
  while (tile.isBonus && s.wall.length > 0) {
    player.bonusTiles.push(tile);
    events.push({ type: 'bonusTileDrawn', playerIndex: pi, tile });
    tile = s.wall.shift()!;
    events.push({ type: 'tileDrawn', playerIndex: pi, tile });
  }

  if (tile.isBonus) {
    // Last tile was also a bonus — very rare edge case
    player.bonusTiles.push(tile);
    events.push({ type: 'bonusTileDrawn', playerIndex: pi, tile });
    if (s.wall.length === 0) {
      s.phase = 'roundOver';
      s.result = { type: 'draw' };
      events.push({ type: 'gameOver', result: s.result });
      return { state: s, events };
    }
  } else {
    player.handTiles.push(tile);
  }

  s.phase = 'postDraw';
  events.push({ type: 'turnChanged', playerIndex: pi, phase: 'postDraw' });

  return { state: s, events };
}

/**
 * Current player discards a tile.
 * Phase: postDraw/discard → claimWindow
 */
export function discardTile(
  state: GameState,
  tile: Tile,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'postDraw' && state.phase !== 'discard') {
    throw new Error(`Cannot discard in phase: ${state.phase}`);
  }

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const pi = s.currentPlayerIndex;
  const player = s.players[pi];

  // Remove tile from hand
  const idx = player.handTiles.findIndex(t => t.id === tile.id);
  if (idx === -1) {
    throw new Error(`Tile ${tile.id} not in player ${pi}'s hand`);
  }
  player.handTiles.splice(idx, 1);
  player.discards.push(tile);

  s.lastDiscard = tile;
  s.lastDiscardPlayerIndex = pi;
  s.phase = 'claimWindow';

  if (!s.firstTurnComplete) {
    s.firstTurnComplete = true;
  }

  events.push({ type: 'tileDiscarded', playerIndex: pi, tile });
  events.push({ type: 'claimWindowOpen', discard: tile, discardedBy: pi });

  return { state: s, events };
}

// ---------------------------------------------------------------------------
// Claim Actions (during claimWindow)
// ---------------------------------------------------------------------------

/**
 * A player claims the last discard to form a pong.
 */
export function claimPong(
  state: GameState,
  claimingPlayerIndex: number,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'claimWindow' || !state.lastDiscard) {
    throw new Error('Cannot claim pong outside claimWindow');
  }
  if (claimingPlayerIndex === state.lastDiscardPlayerIndex) {
    throw new Error('Cannot pong your own discard');
  }

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const player = s.players[claimingPlayerIndex];
  const discardKey = tileKey(state.lastDiscard);

  // Need 2 matching tiles in hand
  const matching = player.handTiles.filter(t => tileKey(t) === discardKey);
  if (matching.length < 2) {
    throw new Error('Not enough matching tiles for pong');
  }

  // Remove 2 tiles from hand
  const meldTiles: Tile[] = [s.lastDiscard!];
  for (let i = 0; i < 2; i++) {
    const removed = removeOneTile(player.handTiles, discardKey);
    if (removed) meldTiles.push(removed);
  }

  const meld: MeldedSet = { type: 'pung', tiles: meldTiles, concealed: false };
  player.openMelds.push(meld);

  // Remove discard from the discarder's discard pile (it was claimed)
  const discarder = s.players[s.lastDiscardPlayerIndex!];
  discarder.discards.pop();

  s.lastDiscard = null;
  s.lastDiscardPlayerIndex = null;
  s.currentPlayerIndex = claimingPlayerIndex;
  s.phase = 'discard'; // Claimer must now discard

  events.push({ type: 'meldDeclared', playerIndex: claimingPlayerIndex, meld });
  events.push({ type: 'turnChanged', playerIndex: claimingPlayerIndex, phase: 'discard' });

  return { state: s, events };
}

/**
 * A player claims the last discard to form a chow.
 * Chow is only allowed for the player to the left (next in turn order).
 * @param chowTiles - The 2 tiles from hand that complete the chow with the discard.
 */
export function claimChow(
  state: GameState,
  claimingPlayerIndex: number,
  chowTiles: [Tile, Tile],
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'claimWindow' || !state.lastDiscard) {
    throw new Error('Cannot claim chow outside claimWindow');
  }
  if (!isLeftOf(claimingPlayerIndex, state.lastDiscardPlayerIndex!)) {
    throw new Error('Chow can only be claimed by the next player in turn order');
  }

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const player = s.players[claimingPlayerIndex];

  // Validate the three tiles form a valid chow
  const allThree = [s.lastDiscard!, ...chowTiles].sort((a, b) => {
    if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
    return (a.value as number) - (b.value as number);
  });

  // Must be same numbered suit, consecutive values
  const suit = allThree[0].suit;
  if (suit !== 'bamboo' && suit !== 'dots' && suit !== 'characters') {
    throw new Error('Chow must be a numbered suit');
  }
  if (!allThree.every(t => t.suit === suit)) {
    throw new Error('Chow tiles must be the same suit');
  }
  const vals = allThree.map(t => t.value as number);
  if (vals[1] !== vals[0] + 1 || vals[2] !== vals[1] + 1) {
    throw new Error('Chow tiles must be consecutive');
  }

  // Remove the 2 tiles from hand
  for (const ct of chowTiles) {
    const idx = player.handTiles.findIndex(t => t.id === ct.id);
    if (idx === -1) throw new Error(`Chow tile ${ct.id} not in hand`);
    player.handTiles.splice(idx, 1);
  }

  const meld: MeldedSet = { type: 'chow', tiles: allThree, concealed: false };
  player.openMelds.push(meld);

  // Remove discard from discarder's pile
  const discarder = s.players[s.lastDiscardPlayerIndex!];
  discarder.discards.pop();

  s.lastDiscard = null;
  s.lastDiscardPlayerIndex = null;
  s.currentPlayerIndex = claimingPlayerIndex;
  s.phase = 'discard';

  events.push({ type: 'meldDeclared', playerIndex: claimingPlayerIndex, meld });
  events.push({ type: 'turnChanged', playerIndex: claimingPlayerIndex, phase: 'discard' });

  return { state: s, events };
}

/**
 * A player claims the last discard to form an open kong.
 */
export function claimKong(
  state: GameState,
  claimingPlayerIndex: number,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'claimWindow' || !state.lastDiscard) {
    throw new Error('Cannot claim kong outside claimWindow');
  }
  if (claimingPlayerIndex === state.lastDiscardPlayerIndex) {
    throw new Error('Cannot kong your own discard');
  }

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const player = s.players[claimingPlayerIndex];
  const discardKey = tileKey(state.lastDiscard);

  // Need 3 matching tiles in hand
  const matching = player.handTiles.filter(t => tileKey(t) === discardKey);
  if (matching.length < 3) {
    throw new Error('Not enough matching tiles for kong');
  }

  const meldTiles: Tile[] = [s.lastDiscard!];
  for (let i = 0; i < 3; i++) {
    const removed = removeOneTile(player.handTiles, discardKey);
    if (removed) meldTiles.push(removed);
  }

  const meld: MeldedSet = { type: 'kong', tiles: meldTiles, concealed: false };
  player.openMelds.push(meld);

  // Remove discard from discarder's pile
  const discarder = s.players[s.lastDiscardPlayerIndex!];
  discarder.discards.pop();

  s.lastDiscard = null;
  s.lastDiscardPlayerIndex = null;
  s.currentPlayerIndex = claimingPlayerIndex;

  // Kong replacement draw from dead wall
  const replacement = drawFromDeadWall(s.deadWall);
  if (replacement) {
    events.push({ type: 'meldDeclared', playerIndex: claimingPlayerIndex, meld });
    events.push({ type: 'kongReplacement', playerIndex: claimingPlayerIndex, tile: replacement });

    // Handle bonus tile replacement
    if (replacement.isBonus) {
      player.bonusTiles.push(replacement);
      events.push({ type: 'bonusTileDrawn', playerIndex: claimingPlayerIndex, tile: replacement });
      // Draw another replacement
      const next = drawFromDeadWall(s.deadWall);
      if (next && !next.isBonus) {
        player.handTiles.push(next);
        s.phase = 'postDraw';
      } else if (next) {
        player.bonusTiles.push(next);
        s.phase = 'postDraw'; // simplified: may need further replacement
      } else {
        s.phase = 'roundOver';
        s.result = { type: 'draw' };
        events.push({ type: 'gameOver', result: s.result });
        return { state: s, events };
      }
    } else {
      player.handTiles.push(replacement);
      s.phase = 'postDraw';
    }
  } else {
    // Dead wall exhausted
    events.push({ type: 'meldDeclared', playerIndex: claimingPlayerIndex, meld });
    s.phase = 'roundOver';
    s.result = { type: 'draw' };
    events.push({ type: 'gameOver', result: s.result });
  }

  return { state: s, events };
}

/**
 * A player claims the last discard to win.
 */
export function claimWin(
  state: GameState,
  claimingPlayerIndex: number,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'claimWindow' || !state.lastDiscard) {
    throw new Error('Cannot claim win outside claimWindow');
  }

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const player = s.players[claimingPlayerIndex];

  // Add discard to hand for validation
  const fullHand = reconstructFullHand(player, state.lastDiscard);

  const parseResult = parseHand(fullHand);
  if (!parseResult.valid) {
    throw new Error('Not a winning hand');
  }

  // Pick the best-scoring decomposition
  const result = buildBestWinResult(
    s, claimingPlayerIndex, parseResult, state.lastDiscard, false,
  );

  // Remove discard from discarder's pile
  const discarder = s.players[s.lastDiscardPlayerIndex!];
  discarder.discards.pop();

  s.phase = 'roundOver';
  s.result = result;

  events.push({ type: 'gameOver', result });

  return { state: s, events };
}

/**
 * All players pass on the discard. Advances to next player's draw.
 */
export function passClaim(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'claimWindow') {
    throw new Error('Cannot pass outside claimWindow');
  }

  const s = cloneState(state);
  const events: GameEvent[] = [];

  s.lastDiscard = null;
  s.lastDiscardPlayerIndex = null;
  s.currentPlayerIndex = nextPlayer(state.lastDiscardPlayerIndex!);
  s.phase = 'draw';
  s.turnNumber++;

  events.push({ type: 'turnChanged', playerIndex: s.currentPlayerIndex, phase: 'draw' });

  return { state: s, events };
}

// ---------------------------------------------------------------------------
// Kong and Self-Win Declarations (during postDraw)
// ---------------------------------------------------------------------------

/**
 * Declare a concealed kong (4 identical tiles in hand).
 * Phase: postDraw → (replacement draw) → postDraw
 */
export function declareKong(
  state: GameState,
  kongTiles: Tile[],
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'postDraw') {
    throw new Error('Cannot declare kong outside postDraw');
  }

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const pi = s.currentPlayerIndex;
  const player = s.players[pi];

  if (kongTiles.length !== 4) {
    throw new Error('Kong must be exactly 4 tiles');
  }

  // All tiles must match
  const key = tileKey(kongTiles[0]);
  if (!kongTiles.every(t => tileKey(t) === key)) {
    throw new Error('Kong tiles must all be the same');
  }

  // Remove tiles from hand
  for (const kt of kongTiles) {
    const idx = player.handTiles.findIndex(t => t.id === kt.id);
    if (idx === -1) throw new Error(`Kong tile ${kt.id} not in hand`);
    player.handTiles.splice(idx, 1);
  }

  const meld: MeldedSet = { type: 'kong', tiles: kongTiles, concealed: true };
  player.openMelds.push(meld);

  events.push({ type: 'meldDeclared', playerIndex: pi, meld });

  // Draw replacement from dead wall
  return drawKongReplacement(s, pi, events);
}

/**
 * Promote an open pung to a kong with a matching tile from hand.
 * Other players may "rob the kong" to win.
 * Phase: postDraw → (replacement draw) → postDraw
 */
export function promotePungToKong(
  state: GameState,
  tile: Tile,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'postDraw') {
    throw new Error('Cannot promote pung outside postDraw');
  }

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const pi = s.currentPlayerIndex;
  const player = s.players[pi];

  // Find matching open pung
  const key = tileKey(tile);
  const pungIdx = player.openMelds.findIndex(
    m => m.type === 'pung' && !m.concealed && tileKey(m.tiles[0]) === key,
  );
  if (pungIdx === -1) {
    throw new Error('No matching open pung to promote');
  }

  // Remove tile from hand
  const handIdx = player.handTiles.findIndex(t => t.id === tile.id);
  if (handIdx === -1) {
    throw new Error(`Tile ${tile.id} not in hand`);
  }
  player.handTiles.splice(handIdx, 1);

  // Upgrade pung to kong
  player.openMelds[pungIdx].type = 'kong';
  player.openMelds[pungIdx].tiles.push(tile);

  events.push({ type: 'meldDeclared', playerIndex: pi, meld: player.openMelds[pungIdx] });

  // Note: In a full implementation, we'd check if other players can "rob the kong"
  // by claiming a win on this tile before drawing replacement.
  // For now, proceed directly to replacement draw.

  return drawKongReplacement(s, pi, events);
}

/**
 * Current player declares self-drawn win (zi mo).
 * Phase: postDraw → roundOver
 */
export function declareSelfWin(
  state: GameState,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'postDraw') {
    throw new Error('Cannot declare self-win outside postDraw');
  }

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const pi = s.currentPlayerIndex;
  const player = s.players[pi];

  const fullHand = reconstructFullHand(player);
  const parseResult = parseHand(fullHand);
  if (!parseResult.valid) {
    throw new Error('Not a winning hand');
  }

  const result = buildBestWinResult(s, pi, parseResult, undefined, true);

  s.phase = 'roundOver';
  s.result = result;

  events.push({ type: 'gameOver', result });

  return { state: s, events };
}

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

/** Check if a player can win with their current hand (+ optional extra tile). */
export function canPlayerWin(state: GameState, playerIndex: number, extraTile?: Tile): boolean {
  const player = state.players[playerIndex];
  const fullHand = reconstructFullHand(player, extraTile);
  if (fullHand.length !== 14) return false;
  return parseHand(fullHand).valid;
}

/** Check if a player can pong the last discard. */
export function canPong(state: GameState, playerIndex: number): boolean {
  if (!state.lastDiscard || playerIndex === state.lastDiscardPlayerIndex) return false;
  const player = state.players[playerIndex];
  const key = tileKey(state.lastDiscard);
  return countInHand(player.handTiles, key) >= 2;
}

/**
 * Check if a player can chow the last discard.
 * Returns an array of possible chow combinations (pairs of tiles from hand),
 * or false if no chow is possible.
 */
export function canChow(state: GameState, playerIndex: number): [Tile, Tile][] | false {
  if (!state.lastDiscard || !isLeftOf(playerIndex, state.lastDiscardPlayerIndex!)) return false;

  const player = state.players[playerIndex];
  const discard = state.lastDiscard;
  const suit = discard.suit;
  if (suit !== 'bamboo' && suit !== 'dots' && suit !== 'characters') return false;

  const val = discard.value as number;
  const results: [Tile, Tile][] = [];

  // Three possible sequences containing this tile: [val-2,val-1,val], [val-1,val,val+1], [val,val+1,val+2]
  const sequences: [number, number][] = [];
  if (val >= 3) sequences.push([val - 2, val - 1]);
  if (val >= 2 && val <= 8) sequences.push([val - 1, val + 1]);
  if (val <= 7) sequences.push([val + 1, val + 2]);

  for (const [v1, v2] of sequences) {
    const k1 = `${suit}_${v1}`;
    const k2 = `${suit}_${v2}`;
    const t1 = player.handTiles.find(t => tileKey(t) === k1);
    const t2 = player.handTiles.find(t => tileKey(t) === k2);
    if (t1 && t2) {
      results.push([t1, t2]);
    }
  }

  return results.length > 0 ? results : false;
}

/** Check if a player can kong the last discard. */
export function canKongFromDiscard(state: GameState, playerIndex: number): boolean {
  if (!state.lastDiscard || playerIndex === state.lastDiscardPlayerIndex) return false;
  const player = state.players[playerIndex];
  const key = tileKey(state.lastDiscard);
  return countInHand(player.handTiles, key) >= 3;
}

/**
 * Check if the current player can declare a concealed kong.
 * Returns tile keys of possible kongs, or false.
 */
export function canDeclareConcealedKong(state: GameState): string[] | false {
  const player = state.players[state.currentPlayerIndex];
  const counts = new Map<string, number>();
  for (const t of player.handTiles) {
    const k = tileKey(t);
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  const kongs: string[] = [];
  for (const [k, count] of counts) {
    if (count === 4) kongs.push(k);
  }

  return kongs.length > 0 ? kongs : false;
}

/**
 * Check if the current player can promote an open pung to a kong.
 * Returns tile keys of promotable pungs, or false.
 */
export function canPromotePung(state: GameState): string[] | false {
  const player = state.players[state.currentPlayerIndex];
  const promotable: string[] = [];

  for (const meld of player.openMelds) {
    if (meld.type === 'pung' && !meld.concealed) {
      const key = tileKey(meld.tiles[0]);
      if (player.handTiles.some(t => tileKey(t) === key)) {
        promotable.push(key);
      }
    }
  }

  return promotable.length > 0 ? promotable : false;
}

/**
 * Get all valid actions for a player given the current game state.
 */
export function getValidActions(state: GameState, playerIndex: number): PlayerAction[] {
  const actions: PlayerAction[] = [];
  const player = state.players[playerIndex];

  if (state.phase === 'postDraw' && playerIndex === state.currentPlayerIndex) {
    // Can discard any tile
    for (const tile of player.handTiles) {
      actions.push({ type: 'discard', tile });
    }

    // Can declare self-win
    if (canPlayerWin(state, playerIndex)) {
      actions.push({ type: 'declareSelfWin' });
    }

    // Can declare concealed kong
    const concealedKongs = canDeclareConcealedKong(state);
    if (concealedKongs) {
      for (const key of concealedKongs) {
        const tiles = player.handTiles.filter(t => tileKey(t) === key);
        actions.push({ type: 'declareKong', tiles });
      }
    }

    // Can promote pung to kong
    const promotable = canPromotePung(state);
    if (promotable) {
      for (const key of promotable) {
        const tile = player.handTiles.find(t => tileKey(t) === key)!;
        actions.push({ type: 'promotePungToKong', tile });
      }
    }
  }

  if (state.phase === 'discard' && playerIndex === state.currentPlayerIndex) {
    for (const tile of player.handTiles) {
      actions.push({ type: 'discard', tile });
    }
  }

  if (state.phase === 'claimWindow' && playerIndex !== state.lastDiscardPlayerIndex) {
    // Can claim win
    if (canPlayerWin(state, playerIndex, state.lastDiscard!)) {
      actions.push({ type: 'claimWin' });
    }

    // Can claim pong
    if (canPong(state, playerIndex)) {
      actions.push({ type: 'claimPong' });
    }

    // Can claim kong
    if (canKongFromDiscard(state, playerIndex)) {
      actions.push({ type: 'claimKong' });
    }

    // Can claim chow (only left player)
    const chowOptions = canChow(state, playerIndex);
    if (chowOptions) {
      for (const pair of chowOptions) {
        actions.push({ type: 'claimChow', chowTiles: pair });
      }
    }

    // Can always pass
    actions.push({ type: 'pass' });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/** Draw kong replacement from dead wall, handling bonus tiles. */
function drawKongReplacement(
  state: GameState,
  playerIndex: number,
  events: GameEvent[],
): { state: GameState; events: GameEvent[] } {
  const player = state.players[playerIndex];

  let replacement = drawFromDeadWall(state.deadWall);
  if (!replacement) {
    state.phase = 'roundOver';
    state.result = { type: 'draw' };
    events.push({ type: 'gameOver', result: state.result });
    return { state, events };
  }

  events.push({ type: 'kongReplacement', playerIndex, tile: replacement });

  // Handle bonus tile replacement
  while (replacement.isBonus) {
    player.bonusTiles.push(replacement);
    events.push({ type: 'bonusTileDrawn', playerIndex, tile: replacement });
    replacement = drawFromDeadWall(state.deadWall);
    if (!replacement) {
      state.phase = 'roundOver';
      state.result = { type: 'draw' };
      events.push({ type: 'gameOver', result: state.result });
      return { state, events };
    }
    events.push({ type: 'kongReplacement', playerIndex, tile: replacement });
  }

  player.handTiles.push(replacement);
  state.phase = 'postDraw';
  events.push({ type: 'turnChanged', playerIndex, phase: 'postDraw' });

  return { state, events };
}

/**
 * Build the best-scoring GameResult from parse results.
 */
function buildBestWinResult(
  state: GameState,
  playerIndex: number,
  parseResult: ReturnType<typeof parseHand>,
  claimedTile: Tile | undefined,
  selfDrawn: boolean,
): GameResult {
  const player = state.players[playerIndex];
  const isFirstDraw = !state.firstTurnComplete;

  let bestScoring = { tai: 0, details: [] as any[] };
  let bestHand: WinningHand | null = null;

  // Try each decomposition and pick the highest-scoring one
  const decompositions = parseResult.decompositions;

  // Also handle seven pairs and thirteen orphans as special decompositions
  if (parseResult.sevenPairs || parseResult.thirteenOrphans || decompositions.length === 0) {
    // Build a hand for special patterns
    const fullTiles = reconstructFullHand(player, claimedTile);
    const hand: WinningHand = {
      handTiles: fullTiles,
      melds: [],
      pair: [],
      bonusTiles: player.bonusTiles,
      seatWind: player.seat,
      prevailingWind: state.prevailingWind,
      selfDrawn,
      firstDraw: isFirstDraw,
    };
    const scoring = scoreHand(hand);
    if (scoring.tai > bestScoring.tai) {
      bestScoring = scoring;
      bestHand = hand;
    }
  }

  for (const decomp of decompositions) {
    // Merge open melds with decomposition's concealed melds
    const melds: MeldedSet[] = [
      ...player.openMelds,
      ...decomp.melds.filter(m => {
        // Only include melds not already in openMelds
        return !player.openMelds.some(om =>
          om.tiles.some(t => m.tiles.some(mt => mt.id === t.id)),
        );
      }),
    ];

    const fullTiles = reconstructFullHand(player, claimedTile);
    const hand: WinningHand = {
      handTiles: fullTiles,
      melds,
      pair: decomp.pair,
      bonusTiles: player.bonusTiles,
      seatWind: player.seat,
      prevailingWind: state.prevailingWind,
      selfDrawn,
      firstDraw: isFirstDraw,
    };

    const scoring = scoreHand(hand);
    if (scoring.tai > bestScoring.tai || !bestHand) {
      bestScoring = scoring;
      bestHand = hand;
    }
  }

  return {
    type: 'win',
    winnerIndex: playerIndex,
    winningHand: bestHand!,
    scoring: bestScoring,
    loserIndex: selfDrawn ? undefined : state.lastDiscardPlayerIndex!,
  };
}

// ---------------------------------------------------------------------------
// Automated Game Loop
// ---------------------------------------------------------------------------

/**
 * Run a **single step** of the game loop (one AI action or one claim resolution).
 * Returns the updated state, events from this step, and whether the loop should stop
 * (i.e. a human must act or the round is over).
 *
 * This is the animation-friendly counterpart to `advanceGame()`, which runs the
 * entire loop in one call.
 */
export async function stepGame(state: GameState): Promise<{
  state: GameState;
  events: GameEvent[];
  done: boolean;
}> {
  if (state.phase === 'roundOver') {
    return { state, events: [], done: true };
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  // If it's a human player's turn (and not claimWindow), pause
  if (currentPlayer.type === 'human' && state.phase !== 'claimWindow') {
    return { state, events: [], done: true };
  }

  // During claim window, check if any human player has a non-pass option
  if (state.phase === 'claimWindow') {
    let humanCanAct = false;
    for (let i = 0; i < 4; i++) {
      if (i === state.lastDiscardPlayerIndex) continue;
      if (state.players[i].type !== 'human') continue;
      const actions = getValidActions(state, i);
      if (actions.some(a => a.type !== 'pass')) {
        humanCanAct = true;
        break;
      }
    }
    if (humanCanAct) {
      return { state, events: [], done: true };
    }

    // All humans can only pass — resolve AI claims
    const result = await resolveClaimWindow(state);
    return { state: result.state, events: result.events, done: false };
  }

  // AI turn: draw phase
  if (state.phase === 'draw') {
    const result = drawTile(state);
    return { state: result.state, events: result.events, done: false };
  }

  // AI turn: postDraw or discard
  if (state.phase === 'postDraw' || state.phase === 'discard') {
    const pi = state.currentPlayerIndex;
    const validActions = getValidActions(state, pi);
    const decision = await getAIDecision(state, pi, validActions);
    const action = decision.action;

    let result: { state: GameState; events: GameEvent[] };

    switch (action.type) {
      case 'discard':
        result = discardTile(state, action.tile);
        break;
      case 'declareSelfWin':
        result = declareSelfWin(state);
        break;
      case 'declareKong':
        result = declareKong(state, action.tiles);
        break;
      case 'promotePungToKong':
        result = promotePungToKong(state, action.tile);
        break;
      default:
        result = discardTile(state, state.players[pi].handTiles[0]);
        break;
    }

    return { state: result.state, events: result.events, done: false };
  }

  // Safety — shouldn't reach here
  return { state, events: [], done: true };
}

/**
 * Resolve the claim window: collect AI decisions, apply priority.
 * Priority: win > pong/kong > chow. Pass if no claims.
 */
async function resolveClaimWindow(
  state: GameState,
): Promise<{ state: GameState; events: GameEvent[] }> {
  if (state.phase !== 'claimWindow') {
    throw new Error('Not in claimWindow phase');
  }

  // Collect claims from all other players (AI only)
  interface Claim {
    playerIndex: number;
    action: PlayerAction;
    priority: number; // higher = better
  }

  const claims: Claim[] = [];
  const discarderIdx = state.lastDiscardPlayerIndex!;

  for (let i = 0; i < 4; i++) {
    if (i === discarderIdx) continue;
    const player = state.players[i];

    // Only auto-resolve for AI players
    if (player.type !== 'ai') continue;

    const validActions = getValidActions(state, i);
    if (validActions.length === 0) continue;

    // If only pass is available, skip
    if (validActions.length === 1 && validActions[0].type === 'pass') continue;

    const decision = await getAIDecision(state, i, validActions);
    if (decision.action.type === 'pass') continue;

    let priority = 0;
    switch (decision.action.type) {
      case 'claimWin': priority = 100; break;
      case 'claimPong': priority = 50; break;
      case 'claimKong': priority = 50; break;
      case 'claimChow': priority = 10; break;
    }

    // Tiebreaker: closer to discarder in turn order
    const distance = (i - discarderIdx + 4) % 4;
    priority += (4 - distance); // closer = higher

    claims.push({ playerIndex: i, action: decision.action, priority });
  }

  // No claims — pass
  if (claims.length === 0) {
    return passClaim(state);
  }

  // Apply highest priority claim
  claims.sort((a, b) => b.priority - a.priority);
  const best = claims[0];

  switch (best.action.type) {
    case 'claimWin':
      return claimWin(state, best.playerIndex);
    case 'claimPong':
      return claimPong(state, best.playerIndex);
    case 'claimKong':
      return claimKong(state, best.playerIndex);
    case 'claimChow': {
      const chowAction = best.action as { type: 'claimChow'; chowTiles: [Tile, Tile] };
      return claimChow(state, best.playerIndex, chowAction.chowTiles);
    }
    default:
      return passClaim(state);
  }
}

/**
 * Advance the game by processing AI turns automatically.
 * Pauses and returns when a human player needs to act, or when the game is over.
 */
export async function advanceGame(
  state: GameState,
): Promise<{ state: GameState; allEvents: GameEvent[] }> {
  let current = state;
  const allEvents: GameEvent[] = [];

  while (current.phase !== 'roundOver') {
    const currentPlayer = current.players[current.currentPlayerIndex];

    // If it's a human player's turn (and not claimWindow), pause
    if (currentPlayer.type === 'human' && current.phase !== 'claimWindow') {
      break;
    }

    // During claim window, check if any human player has a non-pass option
    if (current.phase === 'claimWindow') {
      let humanCanAct = false;
      for (let i = 0; i < 4; i++) {
        if (i === current.lastDiscardPlayerIndex) continue;
        if (current.players[i].type !== 'human') continue;
        const actions = getValidActions(current, i);
        if (actions.some(a => a.type !== 'pass')) {
          humanCanAct = true;
          break;
        }
      }
      if (humanCanAct) break;

      // All humans can only pass — resolve AI claims
      const result = await resolveClaimWindow(current);
      current = result.state;
      allEvents.push(...result.events);
      continue;
    }

    // AI turn: draw phase
    if (current.phase === 'draw') {
      const result = drawTile(current);
      current = result.state;
      allEvents.push(...result.events);
      continue;
    }

    // AI turn: postDraw or discard
    if (current.phase === 'postDraw' || current.phase === 'discard') {
      const pi = current.currentPlayerIndex;
      const validActions = getValidActions(current, pi);
      const decision = await getAIDecision(current, pi, validActions);
      const action = decision.action;

      let result: { state: GameState; events: GameEvent[] };

      switch (action.type) {
        case 'discard':
          result = discardTile(current, action.tile);
          break;
        case 'declareSelfWin':
          result = declareSelfWin(current);
          break;
        case 'declareKong':
          result = declareKong(current, action.tiles);
          break;
        case 'promotePungToKong':
          result = promotePungToKong(current, action.tile);
          break;
        default:
          // Shouldn't happen, but default to discarding first tile
          result = discardTile(current, current.players[pi].handTiles[0]);
          break;
      }

      current = result.state;
      allEvents.push(...result.events);
      continue;
    }

    // Safety break
    break;
  }

  return { state: current, allEvents };
}

// ---------------------------------------------------------------------------
// Game Controller (wraps state + events)
// ---------------------------------------------------------------------------

export class GameController {
  state: GameState;
  private listeners: EventListener[] = [];

  constructor(
    playerTypes: [PlayerType, PlayerType, PlayerType, PlayerType] = ['ai', 'ai', 'ai', 'ai'],
    prevailingWind: Wind = 'east',
    initialState?: GameState,
  ) {
    this.state = initialState ?? createGame(playerTypes, prevailingWind);
    this.emit({ type: 'gameStarted', state: this.state });
  }

  /** Subscribe to game events. Returns an unsubscribe function. */
  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: GameEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  private emitAll(events: GameEvent[]): void {
    for (const e of events) this.emit(e);
  }

  /** Apply an action result — update state and emit events. */
  private apply(result: { state: GameState; events: GameEvent[] }): void {
    this.state = result.state;
    this.emitAll(result.events);
  }

  drawTile(): void {
    this.apply(drawTile(this.state));
  }

  discardTile(tile: Tile): void {
    this.apply(discardTile(this.state, tile));
  }

  claimPong(playerIndex: number): void {
    this.apply(claimPong(this.state, playerIndex));
  }

  claimChow(playerIndex: number, chowTiles: [Tile, Tile]): void {
    this.apply(claimChow(this.state, playerIndex, chowTiles));
  }

  claimKong(playerIndex: number): void {
    this.apply(claimKong(this.state, playerIndex));
  }

  claimWin(playerIndex: number): void {
    this.apply(claimWin(this.state, playerIndex));
  }

  passClaim(): void {
    this.apply(passClaim(this.state));
  }

  declareKong(kongTiles: Tile[]): void {
    this.apply(declareKong(this.state, kongTiles));
  }

  promotePungToKong(tile: Tile): void {
    this.apply(promotePungToKong(this.state, tile));
  }

  declareSelfWin(): void {
    this.apply(declareSelfWin(this.state));
  }

  /** Get valid actions for a player. */
  getValidActions(playerIndex: number): PlayerAction[] {
    return getValidActions(this.state, playerIndex);
  }

  /** Check if the game is over. */
  get isOver(): boolean {
    return this.state.phase === 'roundOver';
  }

  /** Get current player index. */
  get currentPlayer(): number {
    return this.state.currentPlayerIndex;
  }

  /** Get current phase. */
  get phase(): TurnPhase {
    return this.state.phase;
  }

  /**
   * Advance the game — auto-plays AI turns.
   * Pauses when a human player needs to act, or the game is over.
   */
  async advance(): Promise<void> {
    const result = await advanceGame(this.state);
    this.state = result.state;
    this.emitAll(result.allEvents);
  }

  /**
   * Run a single step of the game loop.
   * Returns the events from this step and whether the loop is done.
   */
  async step(): Promise<{ events: GameEvent[]; done: boolean }> {
    const result = await stepGame(this.state);
    this.state = result.state;
    this.emitAll(result.events);
    return { events: result.events, done: result.done };
  }
}
