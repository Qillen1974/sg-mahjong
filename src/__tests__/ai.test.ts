import { describe, it, expect, vi } from 'vitest';
import { fallbackDecision } from '../ai';
import { GameState, PlayerState, PlayerAction } from '../game-types';
import { Tile, createAllTiles, Wind } from '../tiles';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL = createAllTiles();

function findTile(suit: string, value: string | number, copy = 1): Tile {
  const id = `${suit}_${value}_${copy}`;
  const tile = ALL.find(t => t.id === id);
  if (!tile) throw new Error(`Tile not found: ${id}`);
  return { ...tile };
}

function makePlayer(seat: Wind, handTiles: Tile[], overrides?: Partial<PlayerState>): PlayerState {
  return {
    seat,
    type: 'ai',
    handTiles,
    openMelds: [],
    bonusTiles: [],
    discards: [],
    ...overrides,
  };
}

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

// ---------------------------------------------------------------------------
// Fallback AI Strategy
// ---------------------------------------------------------------------------

describe('fallbackDecision', () => {
  it('should always choose win when available', () => {
    const state = makeTestState({
      players: [
        makePlayer('east', [findTile('dots', 1)]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
    });

    const actions: PlayerAction[] = [
      { type: 'pass' },
      { type: 'claimPong' },
      { type: 'claimWin' },
    ];

    const decision = fallbackDecision(state, 0, actions);
    expect(decision.action.type).toBe('claimWin');
  });

  it('should always choose self-win when available', () => {
    const state = makeTestState({
      players: [
        makePlayer('east', [findTile('dots', 1), findTile('dots', 2)]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
    });

    const actions: PlayerAction[] = [
      { type: 'discard', tile: findTile('dots', 1) },
      { type: 'declareSelfWin' },
    ];

    const decision = fallbackDecision(state, 0, actions);
    expect(decision.action.type).toBe('declareSelfWin');
  });

  it('should prefer discarding isolated tiles over pairs', () => {
    const state = makeTestState({
      players: [
        makePlayer('east', [
          findTile('dots', 1, 1),
          findTile('dots', 1, 2), // pair
          findTile('bamboo', 9, 1), // isolated
        ]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
    });

    const actions: PlayerAction[] = [
      { type: 'discard', tile: findTile('dots', 1, 1) },
      { type: 'discard', tile: findTile('dots', 1, 2) },
      { type: 'discard', tile: findTile('bamboo', 9, 1) },
    ];

    const decision = fallbackDecision(state, 0, actions);
    expect(decision.action.type).toBe('discard');
    // Should discard the isolated bamboo 9 rather than breaking the pair
    if (decision.action.type === 'discard') {
      expect(decision.action.tile.suit).toBe('bamboo');
    }
  });

  it('should claim pong for dragon tiles', () => {
    const discard = findTile('dragons', 'red', 1);
    const state = makeTestState({
      players: [
        makePlayer('east', []),
        makePlayer('south', [findTile('dragons', 'red', 2), findTile('dragons', 'red', 3)]),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
      phase: 'claimWindow',
    });

    const actions: PlayerAction[] = [
      { type: 'pass' },
      { type: 'claimPong' },
    ];

    const decision = fallbackDecision(state, 1, actions);
    expect(decision.action.type).toBe('claimPong');
  });

  it('should pass on non-scoring pong', () => {
    const discard = findTile('bamboo', 3, 1);
    const state = makeTestState({
      players: [
        makePlayer('east', []),
        makePlayer('south', [findTile('bamboo', 3, 2), findTile('bamboo', 3, 3)]),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
      lastDiscard: discard,
      lastDiscardPlayerIndex: 0,
      phase: 'claimWindow',
    });

    const actions: PlayerAction[] = [
      { type: 'pass' },
      { type: 'claimPong' },
    ];

    const decision = fallbackDecision(state, 1, actions);
    // Should pass since bamboo 3 is not a scoring tile
    expect(decision.action.type).toBe('pass');
  });

  it('should declare kong when available', () => {
    const state = makeTestState({
      players: [
        makePlayer('east', [findTile('dots', 1)]),
        makePlayer('south', []),
        makePlayer('west', []),
        makePlayer('north', []),
      ],
    });

    const kongTiles = [
      findTile('dots', 5, 1),
      findTile('dots', 5, 2),
      findTile('dots', 5, 3),
      findTile('dots', 5, 4),
    ];

    const actions: PlayerAction[] = [
      { type: 'discard', tile: findTile('dots', 1) },
      { type: 'declareKong', tiles: kongTiles },
    ];

    const decision = fallbackDecision(state, 0, actions);
    expect(decision.action.type).toBe('declareKong');
  });
});
