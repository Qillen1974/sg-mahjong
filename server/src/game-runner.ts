/**
 * GameRunner — server-side game orchestrator.
 *
 * Wraps the pure game engine functions for server use:
 * - Validates and applies player actions
 * - Auto-plays AI-standby seats
 * - Manages claim window with timeout
 * - Broadcasts filtered state/events to connected clients
 */

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
  getValidActions,
} from '../../src/game';
import { getAIDecision } from '../../src/ai';
import type { GameState, GameEvent, PlayerAction, PlayerType } from '../../src/game-types';
import type { Tile } from '../../src/tiles';
import { tilesMatch } from '../../src/tiles';
import { filterStateForPlayer, filterEventForPlayer } from './state-filter.js';
import { CLAIM_TIMEOUT_MS, TURN_TIMEOUT_MS } from './config.js';
import type { Room } from './room-manager.js';

export type BroadcastFn = (seatIndex: number, type: string, data: unknown) => void;

export class GameRunner {
  state: GameState;
  private broadcast: BroadcastFn;
  private room: Room;
  private claimTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingClaims: Map<number, PlayerAction> = new Map();
  private claimResolve: (() => void) | null = null;
  /** Track consecutive timeouts per seat — auto-promote to AI after threshold. */
  private timeoutCount: [number, number, number, number] = [0, 0, 0, 0];
  private static readonly AUTO_AI_THRESHOLD = 2;

  constructor(room: Room, broadcast: BroadcastFn) {
    this.room = room;
    this.broadcast = broadcast;

    // Map room seat types to engine player types
    const playerTypes: [PlayerType, PlayerType, PlayerType, PlayerType] = room.seats.map(
      s => (s.type === 'ai-standby' ? 'ai' : 'human'),
    ) as [PlayerType, PlayerType, PlayerType, PlayerType];

    this.state = createGame(playerTypes);
    this.broadcastState();
    this.broadcastAllEvent({ type: 'gameStarted', state: this.state });
  }

  /** Broadcast filtered state to each connected player. */
  private broadcastState(): void {
    for (let i = 0; i < 4; i++) {
      if (this.room.seats[i].type === 'human') {
        this.broadcast(i, 'gameState', filterStateForPlayer(this.state, i));
      }
    }
  }

  /** Broadcast a filtered event to each connected player. */
  private broadcastAllEvent(event: GameEvent): void {
    for (let i = 0; i < 4; i++) {
      if (this.room.seats[i].type === 'human') {
        this.broadcast(i, 'gameEvent', filterEventForPlayer(event, i));
      }
    }
  }

  /** Notify a specific player it's their turn. */
  private notifyTurn(seatIndex: number): void {
    const actions = getValidActions(this.state, seatIndex);
    this.broadcast(seatIndex, 'turnNotify', {
      seatIndex,
      phase: this.state.phase,
      validActions: actions,
    });
  }

  /**
   * Run the game loop. Called once after construction.
   * Handles the full game flow until roundOver.
   */
  async run(): Promise<void> {
    console.log(`[GameRunner] Game loop started. Dealer=${this.state.dealerIndex}, Phase=${this.state.phase}`);
    // The game starts with dealer in postDraw phase (they already have 14 tiles)
    while (this.state.phase !== 'roundOver') {
      await this.processTurn();
    }

    console.log('[GameRunner] Game loop ended — roundOver');
    // Game over — broadcast final state
    this.broadcastState();
  }

  private async processTurn(): Promise<void> {
    const { phase, currentPlayerIndex } = this.state;
    const seatType = this.room.seats[currentPlayerIndex].type;
    console.log(`[GameRunner] processTurn: phase=${phase}, player=${currentPlayerIndex}, seatType=${seatType}`);

    if (phase === 'draw') {
      // Draw phase — auto-draw for everyone (server-authoritative)
      const result = drawTile(this.state);
      this.state = result.state;
      for (const e of result.events) this.broadcastAllEvent(e);
      this.broadcastState();
      return;
    }

    if (phase === 'postDraw' || phase === 'discard') {
      if (seatType === 'ai-standby' || this.isAutoAI(currentPlayerIndex)) {
        await this.doAITurn(currentPlayerIndex);
      } else {
        // Human or agent — notify and wait
        this.notifyTurn(currentPlayerIndex);
        await this.waitForAction(currentPlayerIndex);
      }
      this.broadcastState();
      return;
    }

    if (phase === 'claimWindow') {
      await this.handleClaimWindow();
      this.broadcastState();
      return;
    }
  }

  /** Check if a human seat has been auto-promoted to AI due to inactivity. */
  private isAutoAI(seatIndex: number): boolean {
    return this.timeoutCount[seatIndex] >= GameRunner.AUTO_AI_THRESHOLD;
  }

  /** Execute AI turn for an ai-standby seat. */
  private async doAITurn(seatIndex: number): Promise<void> {
    const actions = getValidActions(this.state, seatIndex);
    if (actions.length === 0) return;

    const decision = await getAIDecision(this.state, seatIndex, actions);
    this.applyAction(seatIndex, decision.action);
  }

  /**
   * Collect claims during claim window.
   * AI claims instantly; human/agent players have CLAIM_TIMEOUT_MS.
   * Priority: win > pong/kong > chow. Chow only from left player.
   */
  private async handleClaimWindow(): Promise<void> {
    this.pendingClaims.clear();
    const lastDiscardPlayer = this.state.lastDiscardPlayerIndex!;

    // Collect AI claims instantly (including auto-AI promoted seats)
    for (let i = 0; i < 4; i++) {
      if (i === lastDiscardPlayer) continue;
      if (this.room.seats[i].type === 'ai-standby' || this.isAutoAI(i)) {
        const actions = getValidActions(this.state, i);
        if (actions.length > 0 && actions.some(a => a.type !== 'pass')) {
          const decision = await getAIDecision(this.state, i, actions);
          if (decision.action.type !== 'pass') {
            this.pendingClaims.set(i, decision.action);
          }
        }
      }
    }

    // Notify active human/agent players who can claim
    const humanClaimers: number[] = [];
    for (let i = 0; i < 4; i++) {
      if (i === lastDiscardPlayer) continue;
      if (this.room.seats[i].type === 'human' && !this.isAutoAI(i)) {
        const actions = getValidActions(this.state, i);
        if (actions.length > 0 && actions.some(a => a.type !== 'pass')) {
          humanClaimers.push(i);
          this.notifyTurn(i);
        }
      }
    }

    // Wait for all human claims or timeout
    if (humanClaimers.length > 0) {
      await this.waitForClaims(humanClaimers);
    }

    // Resolve claims by priority
    this.resolveClaimWindow();
  }

  /** Wait for all human claimers to submit or timeout. */
  private waitForClaims(claimers: number[]): Promise<void> {
    const remaining = new Set(claimers);

    return new Promise<void>(resolve => {
      this.claimResolve = () => {
        // Check if all humans have claimed
        for (const idx of remaining) {
          if (this.pendingClaims.has(idx)) {
            remaining.delete(idx);
          }
        }
        if (remaining.size === 0) {
          this.clearClaimTimer();
          resolve();
        }
      };

      // Start timeout
      this.claimTimer = setTimeout(() => {
        // Auto-pass for anyone who didn't respond
        for (const idx of remaining) {
          if (!this.pendingClaims.has(idx)) {
            this.pendingClaims.set(idx, { type: 'pass' });
          }
        }
        resolve();
      }, CLAIM_TIMEOUT_MS);

      // Check if already resolved (all AI claims counted)
      this.claimResolve();
    });
  }

  private clearClaimTimer(): void {
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }
  }

  /** Resolve the claim window by priority. */
  private resolveClaimWindow(): void {
    // Priority order: claimWin > claimKong/claimPong > claimChow
    const priority: Record<string, number> = {
      claimWin: 3,
      claimKong: 2,
      claimPong: 2,
      claimChow: 1,
      pass: 0,
    };

    let bestSeat = -1;
    let bestPriority = 0;
    let bestAction: PlayerAction | null = null;

    for (const [seat, action] of this.pendingClaims) {
      const p = priority[action.type] ?? 0;
      if (p > bestPriority) {
        bestPriority = p;
        bestSeat = seat;
        bestAction = action;
      }
    }

    if (bestAction && bestSeat >= 0 && bestAction.type !== 'pass') {
      this.applyAction(bestSeat, bestAction);
    } else {
      // Nobody claimed — pass
      const result = passClaim(this.state);
      this.state = result.state;
      for (const e of result.events) this.broadcastAllEvent(e);
    }
  }

  /** Wait for a human/agent player to submit an action. */
  private waitForAction(seatIndex: number): Promise<void> {
    return new Promise<void>(resolve => {
      // Store the resolve function so submitAction can call it
      this._actionResolve = resolve;
      this._actionSeat = seatIndex;

      this.turnTimer = setTimeout(async () => {
        this.timeoutCount[seatIndex]++;
        const isNowAutoAI = this.isAutoAI(seatIndex);
        console.log(`[GameRunner] Turn timeout for seat ${seatIndex} (count=${this.timeoutCount[seatIndex]}${isNowAutoAI ? ', now auto-AI' : ''}) — auto-playing with AI`);
        // Use AI decision as fallback when player doesn't respond
        try {
          const actions = getValidActions(this.state, seatIndex);
          if (actions.length > 0) {
            const decision = await getAIDecision(this.state, seatIndex, actions);
            this.applyAction(seatIndex, decision.action);
          }
        } catch (err) {
          // Fallback to simple auto-pass/discard if AI fails
          const actions = getValidActions(this.state, seatIndex);
          const passAction = actions.find(a => a.type === 'pass');
          const discardAction = actions.find(a => a.type === 'discard');
          if (passAction) {
            this.applyAction(seatIndex, passAction);
          } else if (discardAction) {
            this.applyAction(seatIndex, discardAction);
          }
        }
        resolve();
      }, TURN_TIMEOUT_MS);
    });
  }

  private _actionResolve: (() => void) | null = null;
  private _actionSeat: number = -1;

  /**
   * Called from WebSocket/REST when a player submits an action.
   * Validates and applies it.
   */
  submitAction(seatIndex: number, action: PlayerAction): { ok: boolean; error?: string } {
    // Validate it's this player's turn (or claim window)
    const validActions = getValidActions(this.state, seatIndex);
    if (validActions.length === 0) {
      return { ok: false, error: 'No valid actions for you right now' };
    }

    // Validate the submitted action matches a valid one
    const isValid = validActions.some(va => this.actionsMatch(va, action));
    if (!isValid) {
      return { ok: false, error: 'Invalid action' };
    }

    if (this.state.phase === 'claimWindow') {
      // Claim window — store the claim
      this.pendingClaims.set(seatIndex, action);
      if (this.claimResolve) this.claimResolve();
      return { ok: true };
    }

    // Regular turn — apply immediately
    if (seatIndex !== this._actionSeat) {
      return { ok: false, error: 'Not your turn' };
    }

    // Player is active — reset timeout counter
    this.timeoutCount[seatIndex] = 0;
    this.applyAction(seatIndex, action);

    // Clear turn timer and resolve the wait
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (this._actionResolve) {
      this._actionResolve();
      this._actionResolve = null;
    }

    return { ok: true };
  }

  /** Apply a validated action to the game state. */
  private applyAction(seatIndex: number, action: PlayerAction): void {
    let result: { state: GameState; events: GameEvent[] };

    switch (action.type) {
      case 'discard':
        // Validate tile.id against authoritative state
        result = this.applyDiscard(seatIndex, action.tile);
        break;
      case 'claimPong':
        result = claimPong(this.state, seatIndex);
        break;
      case 'claimChow':
        result = this.applyClaimChow(seatIndex, action.chowTiles);
        break;
      case 'claimKong':
        result = claimKong(this.state, seatIndex);
        break;
      case 'claimWin':
        result = claimWin(this.state, seatIndex);
        break;
      case 'pass':
        result = passClaim(this.state);
        break;
      case 'declareSelfWin':
        result = declareSelfWin(this.state);
        break;
      case 'declareKong':
        result = this.applyDeclareKong(action.tiles);
        break;
      case 'promotePungToKong':
        result = this.applyPromotePung(action.tile);
        break;
      default:
        return;
    }

    this.state = result.state;
    for (const e of result.events) this.broadcastAllEvent(e);
  }

  /**
   * Validate discard: look up tile by ID in the player's authoritative hand.
   * This prevents forged tiles from the client.
   */
  private applyDiscard(seatIndex: number, clientTile: Tile): { state: GameState; events: GameEvent[] } {
    const hand = this.state.players[seatIndex].handTiles;
    const realTile = hand.find(t => t.id === clientTile.id);
    if (!realTile) throw new Error('Tile not in hand');
    return discardTile(this.state, realTile);
  }

  /** Validate chow tiles against authoritative hand. */
  private applyClaimChow(seatIndex: number, clientTiles: [Tile, Tile]): { state: GameState; events: GameEvent[] } {
    const hand = this.state.players[seatIndex].handTiles;
    const realTiles: [Tile, Tile] = [
      hand.find(t => t.id === clientTiles[0].id)!,
      hand.find(t => t.id === clientTiles[1].id)!,
    ];
    if (!realTiles[0] || !realTiles[1]) throw new Error('Chow tiles not in hand');
    return claimChow(this.state, seatIndex, realTiles);
  }

  /** Validate kong tiles against authoritative hand. */
  private applyDeclareKong(clientTiles: Tile[]): { state: GameState; events: GameEvent[] } {
    const hand = this.state.players[this.state.currentPlayerIndex].handTiles;
    const realTiles = clientTiles.map(ct => hand.find(t => t.id === ct.id)!);
    if (realTiles.some(t => !t)) throw new Error('Kong tiles not in hand');
    return declareKong(this.state, realTiles);
  }

  /** Validate pung promotion tile against authoritative hand. */
  private applyPromotePung(clientTile: Tile): { state: GameState; events: GameEvent[] } {
    const hand = this.state.players[this.state.currentPlayerIndex].handTiles;
    const realTile = hand.find(t => t.id === clientTile.id);
    if (!realTile) throw new Error('Tile not in hand');
    return promotePungToKong(this.state, realTile);
  }

  /** Check if two actions match (by type and relevant fields). */
  private actionsMatch(a: PlayerAction, b: PlayerAction): boolean {
    if (a.type !== b.type) return false;
    if (a.type === 'discard' && b.type === 'discard') {
      return a.tile.id === b.tile.id;
    }
    if (a.type === 'claimChow' && b.type === 'claimChow') {
      return a.chowTiles[0].id === b.chowTiles[0].id &&
             a.chowTiles[1].id === b.chowTiles[1].id;
    }
    if (a.type === 'declareKong' && b.type === 'declareKong') {
      return a.tiles.length === b.tiles.length &&
             a.tiles.every((t, i) => t.id === b.tiles[i].id);
    }
    if (a.type === 'promotePungToKong' && b.type === 'promotePungToKong') {
      return a.tile.id === b.tile.id;
    }
    return true; // For pass, claimPong, claimKong, claimWin, declareSelfWin
  }

  /** Get current valid actions for a seat. */
  getValidActions(seatIndex: number): PlayerAction[] {
    return getValidActions(this.state, seatIndex);
  }

  /** Get filtered state for a specific seat. */
  getStateForPlayer(seatIndex: number) {
    return filterStateForPlayer(this.state, seatIndex);
  }

  /** Clean up timers on room destruction. */
  destroy(): void {
    this.clearClaimTimer();
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }
}
