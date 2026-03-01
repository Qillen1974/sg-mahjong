import { describe, it, expect } from 'vitest';
import {
  filterStateForPlayer,
  filterEventForPlayer,
  buildAgentState,
} from '../state-filter';
import type { GameState, PlayerState, GameEvent, PlayerAction } from '@lib/game-types';
import type { Tile, Wind } from '@lib/tiles';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTile(suit: string, value: string | number, copy = 1): Tile {
  return {
    id: `${suit}_${value}_${copy}`,
    suit: suit as Tile['suit'],
    value: value as Tile['value'],
  };
}

function makePlayer(seat: Wind, tiles: Tile[]): PlayerState {
  return {
    seat,
    type: 'human',
    handTiles: tiles,
    openMelds: [],
    bonusTiles: [],
    discards: [],
  };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const p0Tiles = [makeTile('bamboo', 1), makeTile('bamboo', 2), makeTile('bamboo', 3)];
  const p1Tiles = [makeTile('dots', 4), makeTile('dots', 5)];
  const p2Tiles = [makeTile('characters', 7), makeTile('characters', 8)];
  const p3Tiles = [makeTile('winds', 'east'), makeTile('winds', 'south')];

  return {
    players: [
      makePlayer('east', p0Tiles),
      makePlayer('south', p1Tiles),
      makePlayer('west', p2Tiles),
      makePlayer('north', p3Tiles),
    ] as [PlayerState, PlayerState, PlayerState, PlayerState],
    wall: [makeTile('dots', 1), makeTile('dots', 2), makeTile('dots', 3)],
    deadWall: [makeTile('characters', 1)],
    currentPlayerIndex: 0,
    phase: 'postDraw',
    turnNumber: 1,
    firstTurnComplete: false,
    prevailingWind: 'east',
    dealerIndex: 0,
    lastDiscard: null,
    lastDiscardPlayerIndex: null,
    result: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// filterStateForPlayer
// ---------------------------------------------------------------------------

describe('filterStateForPlayer', () => {
  it('includes own handTiles', () => {
    const state = makeGameState();
    const filtered = filterStateForPlayer(state, 0);

    expect(filtered.players[0].handTiles).toBeDefined();
    expect(filtered.players[0].handTiles).toHaveLength(3);
    expect(filtered.players[0].handTiles![0].id).toBe('bamboo_1_1');
  });

  it('strips other players handTiles', () => {
    const state = makeGameState();
    const filtered = filterStateForPlayer(state, 0);

    expect(filtered.players[1].handTiles).toBeUndefined();
    expect(filtered.players[2].handTiles).toBeUndefined();
    expect(filtered.players[3].handTiles).toBeUndefined();
  });

  it('adds handTileCount for all players', () => {
    const state = makeGameState();
    const filtered = filterStateForPlayer(state, 0);

    expect(filtered.players[0].handTileCount).toBe(3);
    expect(filtered.players[1].handTileCount).toBe(2);
    expect(filtered.players[2].handTileCount).toBe(2);
    expect(filtered.players[3].handTileCount).toBe(2);
  });

  it('replaces wall with wallCount', () => {
    const state = makeGameState();
    const filtered = filterStateForPlayer(state, 0);

    expect(filtered.wallCount).toBe(3);
    expect((filtered as any).wall).toBeUndefined();
  });

  it('replaces deadWall with deadWallCount', () => {
    const state = makeGameState();
    const filtered = filterStateForPlayer(state, 0);

    expect(filtered.deadWallCount).toBe(1);
    expect((filtered as any).deadWall).toBeUndefined();
  });

  it('preserves discards for all players', () => {
    const state = makeGameState();
    const discardTile = makeTile('bamboo', 9);
    state.players[1].discards.push(discardTile);

    const filtered = filterStateForPlayer(state, 0);
    expect(filtered.players[1].discards).toHaveLength(1);
    expect(filtered.players[1].discards[0].id).toBe('bamboo_9_1');
  });

  it('preserves openMelds for all players', () => {
    const state = makeGameState();
    const meld = {
      type: 'pung' as const,
      tiles: [makeTile('dots', 1, 1), makeTile('dots', 1, 2), makeTile('dots', 1, 3)],
      isConcealed: false,
    };
    state.players[2].openMelds.push(meld);

    const filtered = filterStateForPlayer(state, 0);
    expect(filtered.players[2].openMelds).toHaveLength(1);
    expect(filtered.players[2].openMelds[0].type).toBe('pung');
  });

  it('seat 1 sees own hand but not seat 0', () => {
    const state = makeGameState();
    const filtered = filterStateForPlayer(state, 1);

    expect(filtered.players[1].handTiles).toBeDefined();
    expect(filtered.players[1].handTiles).toHaveLength(2);
    expect(filtered.players[0].handTiles).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// filterEventForPlayer
// ---------------------------------------------------------------------------

describe('filterEventForPlayer', () => {
  it('keeps tile for drawing player', () => {
    const tile = makeTile('bamboo', 5);
    const event: GameEvent = { type: 'tileDrawn', playerIndex: 2, tile };

    const filtered = filterEventForPlayer(event, 2);
    expect(filtered.type).toBe('tileDrawn');
    expect((filtered as any).tile).toBe(tile);
  });

  it('nulls tile for other players on tileDrawn', () => {
    const tile = makeTile('bamboo', 5);
    const event: GameEvent = { type: 'tileDrawn', playerIndex: 2, tile };

    const filtered = filterEventForPlayer(event, 0);
    expect(filtered.type).toBe('tileDrawn');
    expect((filtered as any).tile).toBeNull();
  });

  it('nulls tile for other players on kongReplacement', () => {
    const tile = makeTile('dots', 3);
    const event: GameEvent = { type: 'kongReplacement', playerIndex: 1, tile };

    const filtered = filterEventForPlayer(event, 0);
    expect((filtered as any).tile).toBeNull();
  });

  it('passes through discard events unchanged', () => {
    const tile = makeTile('characters', 9);
    const event: GameEvent = { type: 'tileDiscarded', playerIndex: 1, tile };

    const filtered = filterEventForPlayer(event, 0);
    expect(filtered).toBe(event); // exact same reference — not modified
  });

  it('strips state from gameStarted events', () => {
    const state = makeGameState();
    const event: GameEvent = { type: 'gameStarted', state };

    const filtered = filterEventForPlayer(event, 0);
    expect((filtered as any).state).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildAgentState
// ---------------------------------------------------------------------------

describe('buildAgentState', () => {
  it('produces flat readable format', () => {
    const state = makeGameState();
    const actions: PlayerAction[] = [{ type: 'discard', tile: makeTile('bamboo', 1) }];
    const agent = buildAgentState(state, 0, actions);

    expect(agent.yourSeat).toBe(0);
    expect(agent.yourSeatWind).toBe('east');
    expect(agent.phase).toBe('postDraw');
    expect(agent.isYourTurn).toBe(true);
    expect(agent.validActions).toBe(actions);
    expect(agent.wallRemaining).toBe(3);
    expect(agent.otherPlayers).toHaveLength(3);
    expect(agent.otherPlayers.every(p => p.seatIndex !== 0)).toBe(true);
  });

  it('includes human-readable tile names', () => {
    const state = makeGameState();
    const agent = buildAgentState(state, 0, []);

    expect(agent.yourHand).toContain('Bamboo 1');
    expect(agent.yourHand).toContain('Bamboo 2');
    expect(agent.yourHand).toContain('Bamboo 3');
    expect(agent.yourHandTiles).toHaveLength(3);
  });

  it('includes other players discards as readable names', () => {
    const state = makeGameState();
    state.players[1].discards.push(makeTile('dots', 9));
    const agent = buildAgentState(state, 0, []);

    const south = agent.otherPlayers.find(p => p.seat === 'south');
    expect(south).toBeDefined();
    expect(south!.discards).toContain('Dots 9');
  });

  it('reports isYourTurn false for non-current player', () => {
    const state = makeGameState({ currentPlayerIndex: 2 });
    const agent = buildAgentState(state, 0, []);

    expect(agent.isYourTurn).toBe(false);
  });
});
