/**
 * Game Engine Types for Singapore Mahjong
 *
 * Separated from game.ts to avoid circular imports between
 * game.ts and ai.ts.
 */

import { Tile, Wind } from './tiles';
import { MeldedSet, ScoringResult, WinningHand } from './scoring';

// ---------------------------------------------------------------------------
// Turn Phase State Machine
// ---------------------------------------------------------------------------

export type TurnPhase =
  | 'draw'          // Current player needs to draw a tile
  | 'postDraw'      // Player just drew; may declare concealed kong or win (zi mo)
  | 'discard'       // Player must discard a tile
  | 'claimWindow'   // A discard was made; other players may claim
  | 'roundOver';    // Someone won or wall exhausted

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export type PlayerType = 'human' | 'ai';

export interface PlayerState {
  seat: Wind;
  type: PlayerType;
  /** Concealed tiles in hand. */
  handTiles: Tile[];
  /** Declared melds (open pungs, chows, kongs; or concealed kongs). */
  openMelds: MeldedSet[];
  /** Flowers, seasons, animals set aside. */
  bonusTiles: Tile[];
  /** Tiles this player has discarded. */
  discards: Tile[];
}

// ---------------------------------------------------------------------------
// Game State
// ---------------------------------------------------------------------------

export interface GameState {
  /** Always 4 players, indexed 0-3 for East/South/West/North. */
  players: [PlayerState, PlayerState, PlayerState, PlayerState];

  /** Live wall (drawable tiles). */
  wall: Tile[];
  /** Dead wall for kong replacements. */
  deadWall: Tile[];

  /** Index (0-3) of the player whose turn it is. */
  currentPlayerIndex: number;
  /** Current phase of the turn. */
  phase: TurnPhase;
  /** Increments each full turn cycle. */
  turnNumber: number;
  /** False until the first discard has been made — for heavenly/earthly hand. */
  firstTurnComplete: boolean;

  /** Round wind. */
  prevailingWind: Wind;
  /** Who is East (dealer) this round. */
  dealerIndex: number;

  /** The tile just discarded (active during claimWindow). */
  lastDiscard: Tile | null;
  /** Who discarded it. */
  lastDiscardPlayerIndex: number | null;

  /** Set when the round ends (win or draw). */
  result: GameResult | null;
}

// ---------------------------------------------------------------------------
// Game Result
// ---------------------------------------------------------------------------

export interface GameResult {
  type: 'win' | 'draw';
  winnerIndex?: number;
  winningHand?: WinningHand;
  scoring?: ScoringResult;
  /** Who discarded the winning tile (undefined if self-drawn). */
  loserIndex?: number;
}

// ---------------------------------------------------------------------------
// Player Actions
// ---------------------------------------------------------------------------

export type PlayerAction =
  | { type: 'discard'; tile: Tile }
  | { type: 'declareKong'; tiles: Tile[] }
  | { type: 'promotePungToKong'; tile: Tile }
  | { type: 'declareSelfWin' }
  | { type: 'claimPong' }
  | { type: 'claimChow'; chowTiles: [Tile, Tile] }
  | { type: 'claimKong' }
  | { type: 'claimWin' }
  | { type: 'pass' };

// ---------------------------------------------------------------------------
// Events (for UI integration)
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'gameStarted'; state: GameState }
  | { type: 'tileDrawn'; playerIndex: number; tile: Tile }
  | { type: 'tileDiscarded'; playerIndex: number; tile: Tile }
  | { type: 'meldDeclared'; playerIndex: number; meld: MeldedSet }
  | { type: 'bonusTileDrawn'; playerIndex: number; tile: Tile }
  | { type: 'kongReplacement'; playerIndex: number; tile: Tile }
  | { type: 'claimWindowOpen'; discard: Tile; discardedBy: number }
  | { type: 'turnChanged'; playerIndex: number; phase: TurnPhase }
  | { type: 'gameOver'; result: GameResult };

export type EventListener = (event: GameEvent) => void;

// ---------------------------------------------------------------------------
// Payment Types
// ---------------------------------------------------------------------------

export interface PaymentConfig {
  /** Base payment amount per tai (e.g. 0.20 for $0.20). */
  base: number;
  /** Maximum tai before capping. Payment doubles stop here. */
  taiCap: number;
  /** If true, discarder pays full amount for all 3 losers (shooter-pays rule). */
  shooterPays: boolean;
}

/**
 * Payment result for a single round.
 * Positive = player receives money, negative = player pays.
 * Always sums to zero.
 */
export interface PaymentResult {
  /** Net payment per player index (0-3). */
  deltas: [number, number, number, number];
  /** Amount a single loser owes. */
  perLoserAmount: number;
  /** Total the winner receives. */
  winnerTotal: number;
}

// ---------------------------------------------------------------------------
// Session Types
// ---------------------------------------------------------------------------

export interface RoundRecord {
  /** 1-based round number. */
  roundNumber: number;
  /** The GameResult from the completed round. */
  result: GameResult;
  /** Payment deltas for this round. */
  payments: PaymentResult;
  /** Who was dealer this round. */
  dealerIndex: number;
  /** The prevailing wind for this round. */
  prevailingWind: Wind;
}

export interface SessionConfig {
  /** Player types for each seat. */
  playerTypes: [PlayerType, PlayerType, PlayerType, PlayerType];
  /** Payment configuration. */
  payment: PaymentConfig;
  /** Number of full wind rotations (1 = East round only = 4 rounds min). */
  windRounds: number;
}

export interface SessionState {
  /** Configuration for this session. */
  config: SessionConfig;
  /** Cumulative score per player (net payments). */
  scores: [number, number, number, number];
  /** History of completed rounds. */
  rounds: RoundRecord[];
  /** Current dealer index (0-3). */
  dealerIndex: number;
  /** Current prevailing wind. */
  prevailingWind: Wind;
  /** How many times the dealer has rotated in the current wind cycle. */
  dealerRotationCount: number;
  /** How many full wind cycles have completed. */
  completedWindCycles: number;
  /** The current round's GameState, if a round is in progress. */
  currentRound: GameState | null;
  /** Whether the session is finished. */
  finished: boolean;
}

// ---------------------------------------------------------------------------
// Session Events
// ---------------------------------------------------------------------------

export type SessionEvent =
  | { type: 'sessionStarted'; config: SessionConfig }
  | { type: 'roundStarted'; roundNumber: number; dealerIndex: number; prevailingWind: Wind }
  | { type: 'roundCompleted'; record: RoundRecord }
  | { type: 'scoresUpdated'; scores: [number, number, number, number] }
  | { type: 'dealerRotated'; newDealerIndex: number }
  | { type: 'sessionCompleted'; finalScores: [number, number, number, number]; rounds: RoundRecord[] };

export type SessionEventListener = (event: SessionEvent) => void;
