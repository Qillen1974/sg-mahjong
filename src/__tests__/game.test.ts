import { describe, it, expect, vi } from 'vitest';
import {
  createGame,
  drawTile,
  discardTile,
  claimPong,
  claimChow,
  claimKong,
  claimWin,
  passClaim,
  declareKong,
  promotePungToKong,
  declareSelfWin,
  canPlayerWin,
  canPong,
  canChow,
  canKongFromDiscard,
  canDeclareConcealedKong,
  canPromotePung,
  getValidActions,
  GameController,
  advanceGame,
} from '../game';
import { GameState, PlayerState } from '../game-types';
import { Tile, createAllTiles, tileKey, Wind } from '../tiles';
import { MeldedSet } from '../scoring';

// ---------------------------------------------------------------------------
// Helpers: create specific tiles for deterministic tests
// ---------------------------------------------------------------------------

const ALL = createAllTiles();

function findTile(suit: string, value: string | number, copy = 1): Tile {
  const id = `${suit}_${value}_${copy}`;
  const tile = ALL.find(t => t.id === id);
  if (!tile) throw new Error(`Tile not found: ${id}`);
  return { ...tile }; // clone to avoid shared state
}

function findTiles(suit: string, value: string | number, count: number): Tile[] {
  const tiles: Tile[] = [];
  for (let c = 1; c <= count; c++) {
    tiles.push(findTile(suit, value, c));
  }
  return tiles;
}

/**
 * Create a custom GameState with specific hands for deterministic testing.
 */
function makeTestState(overrides: Partial<GameState> & { players: [PlayerState, PlayerState, PlayerState, PlayerState] }): GameState {
  return {
    wall: [],
    deadWall: [],
    currentPlayerIndex: 0,
    phase: 'postDraw',
    turnNumber: 0,
    firstTurnComplete: false,
    prevailingWind: 'east',
    dealerIndex: 0,
    lastDiscard: null,
    lastDiscardPlayerIndex: null,
    result: null,
    ...overrides,
  };
}

function makePlayer(seat: Wind, handTiles: Tile[], overrides?: Partial<PlayerState>): PlayerState {
  return {
    seat,
    type: 'human',
    handTiles,
    openMelds: [],
    bonusTiles: [],
    discards: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Game Creation
// ---------------------------------------------------------------------------

describe('createGame', () => {
  it('should create a game with 4 players', () => {
    const state = createGame();
    expect(state.players).toHaveLength(4);
    expect(state.players[0].seat).toBe('east');
    expect(state.players[1].seat).toBe('south');
    expect(state.players[2].seat).toBe('west');
    expect(state.players[3].seat).toBe('north');
  });

  it('should assign player types correctly', () => {
    const state = createGame(['human', 'ai', 'human', 'ai']);
    expect(state.players[0].type).toBe('human');
    expect(state.players[1].type).toBe('ai');
    expect(state.players[2].type).toBe('human');
    expect(state.players[3].type).toBe('ai');
  });

  it('should start in postDraw phase with East as current player', () => {
    const state = createGame();
    expect(state.phase).toBe('postDraw');
    expect(state.currentPlayerIndex).toBe(0);
  });

  it('should deal correct tile counts', () => {
    const state = createGame();
    // East gets 14, others get 13. Bonus tiles are replaced from the wall,
    // so handTiles count stays the same (bonus tiles are set aside separately).
    // Each player's handTiles should have no bonus tiles.
    const east = state.players[0];
    expect(east.handTiles.length).toBe(14);
    for (let i = 1; i < 4; i++) {
      expect(state.players[i].handTiles.length).toBe(13);
    }
  });

  it('should have no bonus tiles in hand (all set aside)', () => {
    const state = createGame();
    for (const p of state.players) {
      expect(p.handTiles.every(t => !t.isBonus)).toBe(true);
    }
  });

  it('should have a dead wall of 14 tiles', () => {
    const state = createGame();
    expect(state.deadWall).toHaveLength(14);
  });

  it('should set prevailing wind', () => {
    const state = createGame(undefined, 'south');
    expect(state.prevailingWind).toBe('south');
  });
});

// ---------------------------------------------------------------------------
// Draw and Discard
// ---------------------------------------------------------------------------

describe('drawTile', () => {
  it('should draw a tile from the wall to hand', () => {
    const wallTile = findTile('bamboo', 1);
    const state = makeTestState({
      players: [
        makePlayer('east', [findTile('dots', 1)]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      wall: [wallTile, findTile('bamboo', 2)],
      phase: 'draw',
    });

    const { state: next, events } = drawTile(state);
    expect(next.phase).toBe('postDraw');
    expect(next.players[0].handTiles).toHaveLength(2);
    expect(events.some(e => e.type === 'tileDrawn')).toBe(true);
  });

  it('should end game when wall is exhausted', () => {
    const state = makeTestState({
      players: [
        makePlayer('east', [findTile('dots', 1)]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      wall: [],
      phase: 'draw',
    });

    const { state: next } = drawTile(state);
    expect(next.phase).toBe('roundOver');
    expect(next.result?.type).toBe('draw');
  });

  it('should throw when not in draw phase', () => {
    const state = makeTestState({
      players: [
        makePlayer('east', []),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'postDraw',
    });

    expect(() => drawTile(state)).toThrow();
  });
});

describe('discardTile', () => {
  it('should move tile from hand to discards', () => {
    const tile = findTile('bamboo', 5);
    const state = makeTestState({
      players: [
        makePlayer('east', [findTile('dots', 1), tile, findTile('dots', 3)]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'postDraw',
    });

    const { state: next, events } = discardTile(state, tile);
    expect(next.phase).toBe('claimWindow');
    expect(next.players[0].handTiles).toHaveLength(2);
    expect(next.players[0].discards).toHaveLength(1);
    expect(next.lastDiscard?.id).toBe(tile.id);
    expect(next.lastDiscardPlayerIndex).toBe(0);
    expect(events.some(e => e.type === 'tileDiscarded')).toBe(true);
  });

  it('should throw if tile not in hand', () => {
    const state = makeTestState({
      players: [
        makePlayer('east', [findTile('dots', 1)]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'postDraw',
    });

    expect(() => discardTile(state, findTile('bamboo', 9))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Claim Actions
// ---------------------------------------------------------------------------

describe('claimPong', () => {
  it('should form a pong from discard + 2 matching tiles', () => {
    const discard = findTile('dragons', 'red', 1);
    const state = makeTestState({
      players: [
        makePlayer('east', [findTile('dots', 1)], { discards: [discard] }),
        makePlayer('south', [
          findTile('dragons', 'red', 2),
          findTile('dragons', 'red', 3),
          findTile('dots', 5),
        ]),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'claimWindow',
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
    });

    const { state: next } = claimPong(state, 1);
    expect(next.phase).toBe('discard');
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.players[1].openMelds).toHaveLength(1);
    expect(next.players[1].openMelds[0].type).toBe('pung');
    expect(next.players[1].handTiles).toHaveLength(1); // 3 - 2 = 1
  });

  it('should throw if not enough matching tiles', () => {
    const discard = findTile('dragons', 'red', 1);
    const state = makeTestState({
      players: [
        makePlayer('east', [], { discards: [discard] }),
        makePlayer('south', [findTile('dragons', 'red', 2), findTile('dots', 5)]),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'claimWindow',
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
    });

    expect(() => claimPong(state, 1)).toThrow();
  });
});

describe('claimChow', () => {
  it('should form a chow from discard + 2 consecutive tiles', () => {
    const discard = findTile('bamboo', 5, 1);
    const t4 = findTile('bamboo', 4, 1);
    const t6 = findTile('bamboo', 6, 1);
    const state = makeTestState({
      players: [
        makePlayer('east', [], { discards: [discard] }),
        makePlayer('south', [t4, t6, findTile('dots', 1)]),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'claimWindow',
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
    });

    const { state: next } = claimChow(state, 1, [t4, t6]);
    expect(next.phase).toBe('discard');
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.players[1].openMelds).toHaveLength(1);
    expect(next.players[1].openMelds[0].type).toBe('chow');
    expect(next.players[1].handTiles).toHaveLength(1);
  });

  it('should throw if not the left player', () => {
    const discard = findTile('bamboo', 5, 1);
    const state = makeTestState({
      players: [
        makePlayer('east', [], { discards: [discard] }),
        makePlayer('south', []),
        makePlayer('west', [findTile('bamboo', 4, 1), findTile('bamboo', 6, 1)]),
        makePlayer('north', []),
      ],
      phase: 'claimWindow',
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
    });

    // West (index 2) is not left of East (index 0); South (index 1) is
    expect(() => claimChow(state, 2, [findTile('bamboo', 4, 1), findTile('bamboo', 6, 1)])).toThrow();
  });
});

describe('passClaim', () => {
  it('should advance to next player draw', () => {
    const discard = findTile('bamboo', 1);
    const state = makeTestState({
      players: [
        makePlayer('east', []),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'claimWindow',
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
    });

    const { state: next } = passClaim(state);
    expect(next.phase).toBe('draw');
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.lastDiscard).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

describe('canPong', () => {
  it('should return true when player has 2 matching tiles', () => {
    const discard = findTile('dots', 7, 1);
    const state = makeTestState({
      players: [
        makePlayer('east', []),
        makePlayer('south', [findTile('dots', 7, 2), findTile('dots', 7, 3)]),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'claimWindow',
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
    });

    expect(canPong(state, 1)).toBe(true);
    expect(canPong(state, 0)).toBe(false); // can't pong own discard
  });
});

describe('canChow', () => {
  it('should return chow options for left player', () => {
    const discard = findTile('bamboo', 5, 1);
    const state = makeTestState({
      players: [
        makePlayer('east', []),
        makePlayer('south', [
          findTile('bamboo', 3, 1),
          findTile('bamboo', 4, 1),
          findTile('bamboo', 6, 1),
          findTile('bamboo', 7, 1),
        ]),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'claimWindow',
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
    });

    const options = canChow(state, 1);
    expect(options).not.toBe(false);
    if (options) {
      // Should have [3,4], [4,6], [6,7] as possible chow pairs
      expect(options.length).toBe(3);
    }
  });

  it('should return false for non-left player', () => {
    const discard = findTile('bamboo', 5, 1);
    const state = makeTestState({
      players: [
        makePlayer('east', []),
        makePlayer('south', []),
        makePlayer('west', [findTile('bamboo', 4, 1), findTile('bamboo', 6, 1)]),
        makePlayer('north', []),
      ],
      phase: 'claimWindow',
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
    });

    expect(canChow(state, 2)).toBe(false);
  });
});

describe('getValidActions', () => {
  it('should return discard actions during postDraw', () => {
    const state = makeTestState({
      players: [
        makePlayer('east', [findTile('dots', 1), findTile('dots', 2)]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'postDraw',
      currentPlayerIndex: 0,
    });

    const actions = getValidActions(state, 0);
    const discards = actions.filter(a => a.type === 'discard');
    expect(discards).toHaveLength(2);
  });

  it('should return claim actions during claimWindow', () => {
    const discard = findTile('dots', 7, 1);
    const state = makeTestState({
      players: [
        makePlayer('east', []),
        makePlayer('south', [findTile('dots', 7, 2), findTile('dots', 7, 3)]),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'claimWindow',
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
    });

    const actions = getValidActions(state, 1);
    expect(actions.some(a => a.type === 'claimPong')).toBe(true);
    expect(actions.some(a => a.type === 'pass')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GameController
// ---------------------------------------------------------------------------

describe('GameController', () => {
  it('should create a game and emit gameStarted', () => {
    const events: string[] = [];
    const ctrl = new GameController(['human', 'ai', 'ai', 'ai']);
    ctrl.on(e => events.push(e.type));

    // gameStarted was emitted before we subscribed (in constructor)
    // but the state should be valid
    expect(ctrl.state.players).toHaveLength(4);
    expect(ctrl.phase).toBe('postDraw');
    expect(ctrl.currentPlayer).toBe(0);
    expect(ctrl.isOver).toBe(false);
  });

  it('should track events through discard', () => {
    const ctrl = new GameController(['human', 'ai', 'ai', 'ai']);
    const events: string[] = [];
    ctrl.on(e => events.push(e.type));

    // East (human) discards first tile
    const tile = ctrl.state.players[0].handTiles[0];
    ctrl.discardTile(tile);

    expect(events).toContain('tileDiscarded');
    expect(events).toContain('claimWindowOpen');
    expect(ctrl.phase).toBe('claimWindow');
  });
});

// ---------------------------------------------------------------------------
// Kong and Self-Win
// ---------------------------------------------------------------------------

describe('declareKong', () => {
  it('should declare a concealed kong and draw replacement', () => {
    const kongTiles = findTiles('dots', 5, 4);
    const replacement = findTile('bamboo', 1);
    const state = makeTestState({
      players: [
        makePlayer('east', [...kongTiles, findTile('dots', 1)]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      deadWall: [replacement],
      phase: 'postDraw',
    });

    const { state: next, events } = declareKong(state, kongTiles);
    expect(next.players[0].openMelds).toHaveLength(1);
    expect(next.players[0].openMelds[0].type).toBe('kong');
    expect(next.players[0].openMelds[0].concealed).toBe(true);
    expect(next.phase).toBe('postDraw');
    // Hand should have dots_1 + replacement
    expect(next.players[0].handTiles).toHaveLength(2);
  });
});

describe('canDeclareConcealedKong', () => {
  it('should detect 4 identical tiles in hand', () => {
    const state = makeTestState({
      players: [
        makePlayer('east', [...findTiles('dots', 5, 4), findTile('bamboo', 1)]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      phase: 'postDraw',
    });

    const result = canDeclareConcealedKong(state);
    expect(result).not.toBe(false);
    if (result) expect(result).toContain('dots_5');
  });
});
