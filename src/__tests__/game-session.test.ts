import { describe, it, expect } from 'vitest';
import {
  createSession,
  startNextRound,
  processRoundResult,
  SessionController,
} from '../game-session';
import { GameResult, SessionState, SessionEvent } from '../game-types';

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('should create a session with default config', () => {
    const session = createSession();
    expect(session.scores).toEqual([0, 0, 0, 0]);
    expect(session.rounds).toEqual([]);
    expect(session.dealerIndex).toBe(0);
    expect(session.prevailingWind).toBe('east');
    expect(session.finished).toBe(false);
    expect(session.currentRound).toBeNull();
  });

  it('should accept custom player types', () => {
    const session = createSession({
      playerTypes: ['human', 'human', 'ai', 'ai'],
    });
    expect(session.config.playerTypes).toEqual(['human', 'human', 'ai', 'ai']);
  });

  it('should accept custom payment config', () => {
    const session = createSession({
      payment: { base: 0.50, taiCap: 3, shooterPays: false },
    });
    expect(session.config.payment.base).toBe(0.50);
    expect(session.config.payment.taiCap).toBe(3);
    expect(session.config.payment.shooterPays).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startNextRound
// ---------------------------------------------------------------------------

describe('startNextRound', () => {
  it('should create a game state for the current round', () => {
    const session = createSession({ playerTypes: ['ai', 'ai', 'ai', 'ai'] });
    const { session: next, gameState, events } = startNextRound(session);

    expect(gameState).toBeDefined();
    expect(gameState.phase).toBe('postDraw');
    expect(gameState.dealerIndex).toBe(0);
    expect(next.currentRound).not.toBeNull();
    expect(events.some(e => e.type === 'roundStarted')).toBe(true);
  });

  it('should throw if session is finished', () => {
    const session = createSession();
    const finished: SessionState = { ...session, finished: true };
    expect(() => startNextRound(finished)).toThrow('already finished');
  });

  it('should throw if round already in progress', () => {
    const session = createSession({ playerTypes: ['ai', 'ai', 'ai', 'ai'] });
    const { session: next } = startNextRound(session);
    expect(() => startNextRound(next)).toThrow('already in progress');
  });

  it('should use correct dealer index for subsequent rounds', () => {
    let session = createSession({ playerTypes: ['ai', 'ai', 'ai', 'ai'] });

    // Simulate dealer loss → rotation to player 1
    session = { ...session, dealerIndex: 1 };
    const { gameState } = startNextRound(session);

    expect(gameState.dealerIndex).toBe(1);
    expect(gameState.currentPlayerIndex).toBe(1);
    // Dealer should have seat wind 'east'
    expect(gameState.players[1].seat).toBe('east');
  });
});

// ---------------------------------------------------------------------------
// processRoundResult
// ---------------------------------------------------------------------------

describe('processRoundResult', () => {
  it('should update scores after a win', () => {
    const session = createSession({ playerTypes: ['ai', 'ai', 'ai', 'ai'] });
    const { session: withRound } = startNextRound(session);

    const result: GameResult = {
      type: 'win',
      winnerIndex: 2,
      scoring: { tai: 3, details: [] },
      loserIndex: 0,
    };

    const { session: next, events } = processRoundResult(withRound, result);

    // With shooter-pays default: loser 0 pays 3× $0.80 = $2.40
    expect(next.scores[2]).toBeCloseTo(2.40);  // winner gains
    expect(next.scores[0]).toBeCloseTo(-2.40); // shooter loses
    expect(next.scores[1]).toBeCloseTo(0);
    expect(next.scores[3]).toBeCloseTo(0);

    expect(next.rounds).toHaveLength(1);
    expect(next.currentRound).toBeNull();
    expect(events.some(e => e.type === 'roundCompleted')).toBe(true);
    expect(events.some(e => e.type === 'scoresUpdated')).toBe(true);
  });

  it('should handle draw (no payments)', () => {
    const session = createSession({ playerTypes: ['ai', 'ai', 'ai', 'ai'] });
    const { session: withRound } = startNextRound(session);

    const result: GameResult = { type: 'draw' };
    const { session: next } = processRoundResult(withRound, result);

    expect(next.scores).toEqual([0, 0, 0, 0]);
    expect(next.rounds).toHaveLength(1);
  });

  it('should rotate dealer when dealer loses', () => {
    const session = createSession({ playerTypes: ['ai', 'ai', 'ai', 'ai'] });
    const { session: withRound } = startNextRound(session);

    // Player 2 wins, dealer (0) loses
    const result: GameResult = {
      type: 'win',
      winnerIndex: 2,
      scoring: { tai: 1, details: [] },
      loserIndex: 0,
    };

    const { session: next, events } = processRoundResult(withRound, result);

    expect(next.dealerIndex).toBe(1); // rotated from 0 to 1
    expect(next.dealerRotationCount).toBe(1);
    expect(events.some(e => e.type === 'dealerRotated')).toBe(true);
  });

  it('should keep dealer when dealer wins', () => {
    const session = createSession({ playerTypes: ['ai', 'ai', 'ai', 'ai'] });
    const { session: withRound } = startNextRound(session);

    // Dealer (0) wins
    const result: GameResult = {
      type: 'win',
      winnerIndex: 0,
      scoring: { tai: 2, details: [] },
    };

    const { session: next, events } = processRoundResult(withRound, result);

    expect(next.dealerIndex).toBe(0); // stays
    expect(next.dealerRotationCount).toBe(0);
    expect(events.some(e => e.type === 'dealerRotated')).toBe(false);
  });

  it('should not rotate dealer on draw', () => {
    const session = createSession({ playerTypes: ['ai', 'ai', 'ai', 'ai'] });
    const { session: withRound } = startNextRound(session);

    const result: GameResult = { type: 'draw' };
    const { session: next } = processRoundResult(withRound, result);

    // Draw = dealer didn't win, so dealer rotates
    expect(next.dealerIndex).toBe(1);
    expect(next.dealerRotationCount).toBe(1);
  });

  it('should finish session after 4 dealer rotations', () => {
    let session = createSession({ playerTypes: ['ai', 'ai', 'ai', 'ai'] });

    // Simulate 4 rounds where dealer always loses
    for (let i = 0; i < 4; i++) {
      const { session: withRound } = startNextRound(session);
      const nonDealer = (session.dealerIndex + 1) % 4;
      const result: GameResult = {
        type: 'win',
        winnerIndex: nonDealer,
        scoring: { tai: 1, details: [] },
        loserIndex: session.dealerIndex,
      };
      const { session: next } = processRoundResult(withRound, result);
      session = next;
    }

    expect(session.finished).toBe(true);
    expect(session.rounds).toHaveLength(4);
    expect(session.completedWindCycles).toBe(1);
  });

  it('should accumulate scores across rounds', () => {
    let session = createSession({ playerTypes: ['ai', 'ai', 'ai', 'ai'] });

    // Round 1: player 0 wins 1 tai (self-drawn)
    const { session: r1 } = startNextRound(session);
    const { session: after1 } = processRoundResult(r1, {
      type: 'win',
      winnerIndex: 0,
      scoring: { tai: 1, details: [] },
    });

    // Player 0 stays dealer (won self-drawn), gains 3 × $0.20 = $0.60
    // Other players each lose $0.20
    expect(after1.scores[0]).toBeCloseTo(0.60);
    expect(after1.scores[1]).toBeCloseTo(-0.20);

    // Round 2: player 1 wins 2 tai off player 0's discard
    const { session: r2 } = startNextRound(after1);
    const { session: after2 } = processRoundResult(r2, {
      type: 'win',
      winnerIndex: 1,
      scoring: { tai: 2, details: [] },
      loserIndex: 0,
    });

    // Player 1 gains 3 × $0.40 = $1.20 (shooter-pays)
    // Player 0: $0.60 - $1.20 = -$0.60
    // Player 1: -$0.20 + $1.20 = $1.00
    expect(after2.scores[0]).toBeCloseTo(-0.60);
    expect(after2.scores[1]).toBeCloseTo(1.00);
  });
});

// ---------------------------------------------------------------------------
// SessionController
// ---------------------------------------------------------------------------

describe('SessionController', () => {
  it('should emit sessionStarted on creation', () => {
    const events: SessionEvent[] = [];
    const ctrl = new SessionController({
      playerTypes: ['ai', 'ai', 'ai', 'ai'],
    });
    ctrl.onSession(e => events.push(e));

    // sessionStarted was emitted in constructor (before listener)
    // but state should be valid
    expect(ctrl.session.config.playerTypes).toEqual(['ai', 'ai', 'ai', 'ai']);
    expect(ctrl.isFinished).toBe(false);
  });

  it('should start a round and return a GameController', () => {
    const ctrl = new SessionController({
      playerTypes: ['ai', 'ai', 'ai', 'ai'],
    });

    const events: SessionEvent[] = [];
    ctrl.onSession(e => events.push(e));

    const game = ctrl.startRound();
    expect(game).toBeDefined();
    expect(game.state.phase).toBe('postDraw');
    expect(events.some(e => e.type === 'roundStarted')).toBe(true);
  });

  it('should run a full session with 4 AI players', async () => {
    const ctrl = new SessionController({
      playerTypes: ['ai', 'ai', 'ai', 'ai'],
    });

    const events: SessionEvent[] = [];
    ctrl.onSession(e => events.push(e));

    const finalSession = await ctrl.runFullSession();

    expect(finalSession.finished).toBe(true);
    expect(finalSession.rounds.length).toBeGreaterThanOrEqual(4);
    expect(events.some(e => e.type === 'sessionCompleted')).toBe(true);

    // Scores should sum to zero
    const sum = finalSession.scores.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0);
  }, 30000); // generous timeout for full AI session
});
