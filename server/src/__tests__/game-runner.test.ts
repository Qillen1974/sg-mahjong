import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameRunner } from '../game-runner';
import type { Room } from '../room-manager';
import type { PlayerAction } from '@lib/game-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoom(seatTypes: Array<'human' | 'ai-standby'> = ['human', 'ai-standby', 'ai-standby', 'ai-standby']): Room {
  return {
    id: 'test-room',
    hostSeatIndex: 0,
    settings: {
      name: 'Test Room',
      base: 0.20,
      taiCap: 5,
      shooterPays: true,
      windRounds: 1,
    },
    seats: seatTypes.map((type, i) => ({
      type,
      playerName: type === 'human' ? `Player ${i}` : `AI ${i}`,
    })) as Room['seats'],
    status: 'playing' as const,
    createdAt: Date.now(),
  };
}

describe('GameRunner', () => {
  let broadcast: ReturnType<typeof vi.fn>;
  let room: Room;
  let runner: GameRunner;

  beforeEach(() => {
    broadcast = vi.fn();
    room = makeRoom();
    runner = new GameRunner(room, broadcast);
  });

  afterEach(() => {
    runner.destroy();
  });

  it('creates game from room config', () => {
    expect(runner.state).toBeDefined();
    expect(runner.state.players).toHaveLength(4);
    expect(runner.state.phase).toBeDefined();
  });

  it('broadcasts initial state on construction', () => {
    // Constructor calls broadcastState + broadcastAllEvent
    expect(broadcast).toHaveBeenCalled();
    // Seat 0 is human, should receive gameState
    const stateCall = broadcast.mock.calls.find(
      ([seat, type]) => seat === 0 && type === 'gameState',
    );
    expect(stateCall).toBeDefined();
  });

  it('AI-standby seats get playerType ai', () => {
    // Seats 1-3 are ai-standby → mapped to 'ai' in engine
    expect(runner.state.players[1].type).toBe('ai');
    expect(runner.state.players[2].type).toBe('ai');
    expect(runner.state.players[3].type).toBe('ai');
  });

  it('human seats get playerType human', () => {
    expect(runner.state.players[0].type).toBe('human');
  });

  it('state getter returns current game state', () => {
    const state = runner.state;
    expect(state.wall).toBeDefined();
    expect(state.players).toHaveLength(4);
    expect(state.turnNumber).toBeGreaterThanOrEqual(0);
  });

  it('getValidActions returns actions for current player', () => {
    const actions = runner.getValidActions(runner.state.currentPlayerIndex);
    expect(Array.isArray(actions)).toBe(true);
  });

  it('getStateForPlayer returns filtered state', () => {
    const filtered = runner.getStateForPlayer(0);
    // Filtered state has wallCount instead of wall array
    expect(filtered.wallCount).toBeDefined();
    expect((filtered as any).wall).toBeUndefined();
    // Own hand visible
    expect(filtered.players[0].handTiles).toBeDefined();
    // Other hands hidden
    expect(filtered.players[1].handTiles).toBeUndefined();
  });

  describe('submitAction', () => {
    it('rejects action from wrong seat', () => {
      // If it's not seat 3's turn, submitting from seat 3 should fail
      const currentSeat = runner.state.currentPlayerIndex;
      const wrongSeat = (currentSeat + 1) % 4;
      // Only test if wrong seat is human (otherwise no valid actions anyway)
      const result = runner.submitAction(wrongSeat, { type: 'pass' });
      expect(result.ok).toBe(false);
    });

    it('rejects invalid action type', () => {
      // Try submitting claimPong when it's not claim window
      if (runner.state.phase !== 'claimWindow') {
        const result = runner.submitAction(
          runner.state.currentPlayerIndex,
          { type: 'claimPong' },
        );
        expect(result.ok).toBe(false);
      }
    });

    it('validates discard tile ID exists in hand', () => {
      // Get to a state where seat 0 can discard
      // The game starts with dealer (seat 0) in postDraw with 14 tiles
      if (runner.state.currentPlayerIndex === 0 && runner.state.phase === 'postDraw') {
        const fakeTile = {
          id: 'fake_tile_999',
          suit: 'bamboo' as const,
          value: 1 as const,
        };
        // This should either fail validation or throw
        const result = runner.submitAction(0, { type: 'discard', tile: fakeTile });
        // Either the action is not in valid actions (ok: false) or it throws
        expect(result.ok).toBe(false);
      }
    });
  });

  it('destroy cleans up timers', () => {
    // Should not throw
    runner.destroy();
  });
});
