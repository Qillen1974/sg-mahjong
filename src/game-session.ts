/**
 * Multi-Round Game Session for Singapore Mahjong
 *
 * Manages multiple rounds with dealer rotation, wind changes,
 * cumulative scoring, and payment tracking.
 *
 * Default: 4 rounds (1 East wind cycle).
 * Dealer stays if they win, rotates if they lose.
 * Once all 4 players have lost as dealer, the session ends.
 */

import { Wind } from './tiles';
import {
  PlayerType,
  GameState,
  GameResult,
  GameEvent,
  EventListener,
  SessionConfig,
  SessionState,
  SessionEvent,
  SessionEventListener,
  RoundRecord,
  PaymentConfig,
} from './game-types';
import { createGame, advanceGame, GameController } from './game';
import { calculatePayments, DEFAULT_PAYMENT_CONFIG } from './payments';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WINDS: Wind[] = ['east', 'south', 'west', 'north'];

const DEFAULT_SESSION_CONFIG: SessionConfig = {
  playerTypes: ['human', 'ai', 'ai', 'ai'],
  payment: DEFAULT_PAYMENT_CONFIG,
  windRounds: 1,
};

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Create a new session state.
 */
export function createSession(config: Partial<SessionConfig> = {}): SessionState {
  const fullConfig: SessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    ...config,
    payment: { ...DEFAULT_PAYMENT_CONFIG, ...config.payment },
  };

  return {
    config: fullConfig,
    scores: [0, 0, 0, 0],
    rounds: [],
    dealerIndex: 0,
    prevailingWind: 'east',
    dealerRotationCount: 0,
    completedWindCycles: 0,
    currentRound: null,
    finished: false,
  };
}

/**
 * Start the next round. Creates a new GameState for the current dealer/wind.
 */
export function startNextRound(session: SessionState): {
  session: SessionState;
  gameState: GameState;
  events: SessionEvent[];
} {
  if (session.finished) {
    throw new Error('Session is already finished');
  }
  if (session.currentRound !== null) {
    throw new Error('A round is already in progress');
  }

  const gameState = createGame(
    session.config.playerTypes,
    session.prevailingWind,
    session.dealerIndex,
  );

  const roundNumber = session.rounds.length + 1;

  const newSession: SessionState = {
    ...session,
    currentRound: gameState,
  };

  const events: SessionEvent[] = [
    {
      type: 'roundStarted',
      roundNumber,
      dealerIndex: session.dealerIndex,
      prevailingWind: session.prevailingWind,
    },
  ];

  return { session: newSession, gameState, events };
}

/**
 * Process a completed round's result. Updates scores, determines dealer rotation,
 * checks if session is over.
 */
export function processRoundResult(
  session: SessionState,
  result: GameResult,
): {
  session: SessionState;
  events: SessionEvent[];
} {
  const events: SessionEvent[] = [];

  // Calculate payments
  const payments = calculatePayments(result, session.config.payment);

  // Update cumulative scores
  const scores: [number, number, number, number] = [...session.scores];
  for (let i = 0; i < 4; i++) {
    scores[i] = Math.round((scores[i] + payments.deltas[i]) * 100) / 100;
  }

  // Create round record
  const record: RoundRecord = {
    roundNumber: session.rounds.length + 1,
    result,
    payments,
    dealerIndex: session.dealerIndex,
    prevailingWind: session.prevailingWind,
  };

  events.push({ type: 'roundCompleted', record });
  events.push({ type: 'scoresUpdated', scores: [...scores] });

  // Determine dealer rotation
  let newDealerIndex = session.dealerIndex;
  let newRotationCount = session.dealerRotationCount;
  let newCompletedCycles = session.completedWindCycles;
  let newPrevailingWind = session.prevailingWind;
  let finished = false;

  const dealerWon = result.type === 'win' && result.winnerIndex === session.dealerIndex;

  if (!dealerWon) {
    // Dealer rotates to next player
    newDealerIndex = (session.dealerIndex + 1) % 4;
    newRotationCount++;
    events.push({ type: 'dealerRotated', newDealerIndex });

    // Check if a full wind cycle completed
    if (newRotationCount >= 4) {
      newCompletedCycles++;
      newRotationCount = 0;

      if (newCompletedCycles < session.config.windRounds) {
        // Advance prevailing wind for next cycle
        const windIdx = WINDS.indexOf(newPrevailingWind);
        newPrevailingWind = WINDS[(windIdx + 1) % 4];
      } else {
        finished = true;
      }
    }
  }

  if (finished) {
    events.push({
      type: 'sessionCompleted',
      finalScores: [...scores] as [number, number, number, number],
      rounds: [...session.rounds, record],
    });
  }

  const newSession: SessionState = {
    ...session,
    scores,
    rounds: [...session.rounds, record],
    dealerIndex: newDealerIndex,
    prevailingWind: newPrevailingWind,
    dealerRotationCount: newRotationCount,
    completedWindCycles: newCompletedCycles,
    currentRound: null,
    finished,
  };

  return { session: newSession, events };
}

// ---------------------------------------------------------------------------
// Session Controller
// ---------------------------------------------------------------------------

export class SessionController {
  session: SessionState;
  currentGame: GameController | null = null;
  private sessionListeners: SessionEventListener[] = [];
  private gameListeners: EventListener[] = [];

  constructor(config: Partial<SessionConfig> = {}) {
    this.session = createSession(config);
    this.emitSession({ type: 'sessionStarted', config: this.session.config });
  }

  /** Subscribe to session-level events. Returns an unsubscribe function. */
  onSession(listener: SessionEventListener): () => void {
    this.sessionListeners.push(listener);
    return () => {
      const idx = this.sessionListeners.indexOf(listener);
      if (idx >= 0) this.sessionListeners.splice(idx, 1);
    };
  }

  /** Subscribe to game-level events (forwarded from current round). */
  onGame(listener: EventListener): () => void {
    this.gameListeners.push(listener);
    return () => {
      const idx = this.gameListeners.indexOf(listener);
      if (idx >= 0) this.gameListeners.splice(idx, 1);
    };
  }

  private emitSession(event: SessionEvent): void {
    for (const fn of this.sessionListeners) fn(event);
  }

  /** Start the next round. Creates a GameController for the round. */
  startRound(): GameController {
    const { session, gameState, events } = startNextRound(this.session);
    this.session = session;

    // Create GameController with pre-built state (avoids double dealing)
    this.currentGame = new GameController(
      this.session.config.playerTypes,
      this.session.prevailingWind,
      gameState,
    );

    // Forward game events to session-level listeners
    this.currentGame.on((event: GameEvent) => {
      for (const fn of this.gameListeners) fn(event);

      // Auto-process round completion
      if (event.type === 'gameOver') {
        this.completeRound(event.result);
      }
    });

    for (const e of events) this.emitSession(e);
    return this.currentGame;
  }

  private completeRound(result: GameResult): void {
    const { session, events } = processRoundResult(this.session, result);
    this.session = session;
    this.currentGame = null;
    for (const e of events) this.emitSession(e);
  }

  /** Advance the current round — auto-plays AI turns. */
  async advanceRound(): Promise<void> {
    if (!this.currentGame) throw new Error('No round in progress');
    await this.currentGame.advance();
  }

  /** Run an entire session automatically (best with all-AI players). */
  async runFullSession(): Promise<SessionState> {
    while (!this.session.finished) {
      this.startRound();
      await this.advanceRound();
    }
    return this.session;
  }

  get isFinished(): boolean {
    return this.session.finished;
  }

  get scores(): [number, number, number, number] {
    return [...this.session.scores] as [number, number, number, number];
  }

  get roundNumber(): number {
    return this.session.rounds.length + (this.currentGame ? 1 : 0);
  }
}
