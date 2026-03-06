/**
 * State & Event Filtering — security-critical module.
 *
 * Ensures each player only sees their own hand tiles.
 * Other players' hands are replaced with tile counts.
 * Wall/dead wall are replaced with counts.
 */

import type { GameState, GameEvent, PlayerState, PlayerAction, SessionState } from '../../src/game-types';
import type { Tile } from '../../src/tiles';
import type { MeldedSet } from '../../src/scoring';

// ---------------------------------------------------------------------------
// Filtered Types (what clients receive)
// ---------------------------------------------------------------------------

export interface FilteredPlayerState {
  seat: string;
  type: string;
  /** Only present for the requesting player's own seat. */
  handTiles?: Tile[];
  /** Tile count — always present. */
  handTileCount: number;
  openMelds: MeldedSet[];
  bonusTiles: Tile[];
  discards: Tile[];
}

export interface SessionInfo {
  scores: [number, number, number, number];
  roundNumber: number;
  dealerIndex: number;
  prevailingWind: string;
  finished: boolean;
  windRounds: number;
}

export interface FilteredGameState {
  players: [FilteredPlayerState, FilteredPlayerState, FilteredPlayerState, FilteredPlayerState];
  wallCount: number;
  deadWallCount: number;
  currentPlayerIndex: number;
  phase: string;
  turnNumber: number;
  firstTurnComplete: boolean;
  prevailingWind: string;
  dealerIndex: number;
  lastDiscard: Tile | null;
  lastDiscardPlayerIndex: number | null;
  result: GameState['result'];
  /** Multi-round session info (present when room has a session). */
  sessionInfo?: SessionInfo;
  /** Recent player messages (trash talk) for HTTP polling clients. */
  recentMessages?: Array<{ playerIndex: number; message: string }>;
}

// ---------------------------------------------------------------------------
// State Filtering
// ---------------------------------------------------------------------------

function filterPlayer(player: PlayerState, isSelf: boolean): FilteredPlayerState {
  return {
    seat: player.seat,
    type: player.type,
    ...(isSelf ? { handTiles: player.handTiles } : {}),
    handTileCount: player.handTiles.length,
    openMelds: player.openMelds,
    bonusTiles: player.bonusTiles,
    discards: player.discards,
  };
}

/** Filter full GameState so the given seat only sees their own hand. */
export function filterStateForPlayer(state: GameState, seatIndex: number, sessionState?: SessionState): FilteredGameState {
  const filtered: FilteredGameState = {
    players: state.players.map((p, i) =>
      filterPlayer(p, i === seatIndex),
    ) as [FilteredPlayerState, FilteredPlayerState, FilteredPlayerState, FilteredPlayerState],
    wallCount: state.wall.length,
    deadWallCount: state.deadWall.length,
    currentPlayerIndex: state.currentPlayerIndex,
    phase: state.phase,
    turnNumber: state.turnNumber,
    firstTurnComplete: state.firstTurnComplete,
    prevailingWind: state.prevailingWind,
    dealerIndex: state.dealerIndex,
    lastDiscard: state.lastDiscard,
    lastDiscardPlayerIndex: state.lastDiscardPlayerIndex,
    result: state.result,
  };

  if (sessionState) {
    filtered.sessionInfo = {
      scores: [...sessionState.scores] as [number, number, number, number],
      roundNumber: sessionState.rounds.length + 1,
      dealerIndex: sessionState.dealerIndex,
      prevailingWind: sessionState.prevailingWind,
      finished: sessionState.finished,
      windRounds: sessionState.config.windRounds,
    };
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Event Filtering
// ---------------------------------------------------------------------------

/** Filter a GameEvent so hidden info is stripped for non-drawing players. */
export function filterEventForPlayer(event: GameEvent, seatIndex: number): GameEvent {
  switch (event.type) {
    case 'tileDrawn':
      // Only the drawing player sees the tile
      if (event.playerIndex !== seatIndex) {
        return { ...event, tile: null as unknown as Tile };
      }
      return event;

    case 'kongReplacement':
      if (event.playerIndex !== seatIndex) {
        return { ...event, tile: null as unknown as Tile };
      }
      return event;

    case 'bonusTileDrawn':
      // Bonus tiles are public (placed face-up), so we don't filter
      return event;

    case 'gameStarted':
      // Strip the full state — clients should use filtered state endpoint
      return { ...event, state: null as unknown as GameState };

    default:
      return event;
  }
}

// ---------------------------------------------------------------------------
// Agent-Friendly State
// ---------------------------------------------------------------------------

const SUIT_NAMES: Record<string, string> = {
  bamboo: 'Bamboo',
  dots: 'Dots',
  characters: 'Characters',
  winds: 'Wind',
  dragons: 'Dragon',
  flowers: 'Flower',
  seasons: 'Season',
  animals: 'Animal',
};

function tileToReadable(tile: Tile): string {
  const suitName = SUIT_NAMES[tile.suit] ?? tile.suit;
  const val = typeof tile.value === 'number' ? tile.value : String(tile.value);
  return `${suitName} ${val}`;
}

export interface AgentFriendlyState {
  yourSeat: number;
  yourSeatWind: string;
  yourHand: string[];
  yourHandTiles: Tile[];
  yourOpenMelds: MeldedSet[];
  yourBonusTiles: string[];
  yourDiscards: string[];
  phase: string;
  isYourTurn: boolean;
  validActions: PlayerAction[];
  otherPlayers: {
    seat: string;
    seatIndex: number;
    handCount: number;
    discards: string[];
    openMelds: MeldedSet[];
  }[];
  wallRemaining: number;
  lastDiscard: string | null;
  lastDiscardedBy: number | null;
  prevailingWind: string;
  dealerIndex: number;
  turnNumber: number;
}

/** Build a flattened, LLM-readable state for agent consumption. */
export function buildAgentState(
  state: GameState,
  seatIndex: number,
  validActions: PlayerAction[],
): AgentFriendlyState {
  const me = state.players[seatIndex];

  return {
    yourSeat: seatIndex,
    yourSeatWind: me.seat,
    yourHand: me.handTiles.map(tileToReadable),
    yourHandTiles: me.handTiles,
    yourOpenMelds: me.openMelds,
    yourBonusTiles: me.bonusTiles.map(tileToReadable),
    yourDiscards: me.discards.map(tileToReadable),
    phase: state.phase,
    isYourTurn: state.currentPlayerIndex === seatIndex,
    validActions,
    otherPlayers: state.players
      .map((p, i) => ({
        seat: p.seat,
        seatIndex: i,
        handCount: p.handTiles.length,
        discards: p.discards.map(tileToReadable),
        openMelds: p.openMelds,
      }))
      .filter((_, i) => i !== seatIndex),
    wallRemaining: state.wall.length,
    lastDiscard: state.lastDiscard ? tileToReadable(state.lastDiscard) : null,
    lastDiscardedBy: state.lastDiscardPlayerIndex,
    prevailingWind: state.prevailingWind,
    dealerIndex: state.dealerIndex,
    turnNumber: state.turnNumber,
  };
}
