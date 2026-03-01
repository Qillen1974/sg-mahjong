/**
 * NetworkBridge — same interface as GameBridge but sends actions over WebSocket.
 *
 * Used in online multiplayer mode. No local game engine — the server
 * is authoritative. This bridge sends actions to the server and receives
 * state updates via WebSocket.
 */

import type { PlayerAction, GameEvent, GameState } from '@lib/game-types';
import type { Tile } from '@lib/tiles';
import type { FilteredGameState } from '../../server/src/state-filter';

export type NetworkUpdateCallback = (state: FilteredGameState) => void;
export type BubbleCallback = (playerIndex: number, text: string) => void;

interface WSMessage {
  type: string;
  data: unknown;
}

export class NetworkBridge {
  state: FilteredGameState | null = null;
  validActions: PlayerAction[] = [];
  onUpdate: NetworkUpdateCallback = () => {};
  onBubble: BubbleCallback = () => {};

  private ws: WebSocket | null = null;
  private serverUrl: string;
  private token: string;
  private seatIndex: number;
  private roomId: string;
  private connected = false;

  constructor(serverUrl: string, roomId: string, token: string, seatIndex: number) {
    this.serverUrl = serverUrl;
    this.roomId = roomId;
    this.token = token;
    this.seatIndex = seatIndex;
  }

  /** Connect to the game server WebSocket. */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/ws';
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Authenticate immediately
        this.send({ type: 'auth', token: this.token });
      };

      this.ws.onmessage = (event: MessageEvent) => {
        const msg: WSMessage = JSON.parse(event.data);
        this.handleMessage(msg);

        // Resolve connect promise on successful auth
        if (msg.type === 'authOk') {
          this.connected = true;
          resolve();
        }
      };

      this.ws.onerror = () => {
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        this.connected = false;
      };

      // Timeout
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 10_000);
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: WSMessage): void {
    switch (msg.type) {
      case 'gameState':
        this.state = msg.data as FilteredGameState;
        this.onUpdate(this.state);
        break;

      case 'turnNotify': {
        const data = msg.data as { seatIndex: number; phase: string; validActions: PlayerAction[] };
        if (data.seatIndex === this.seatIndex) {
          this.validActions = data.validActions;
        }
        this.onUpdate(this.state!);
        break;
      }

      case 'gameEvent': {
        const event = msg.data as GameEvent;
        this.emitBubble(event);
        break;
      }

      case 'error': {
        const data = msg.data as { message: string };
        console.error('Server error:', data.message);
        break;
      }
    }
  }

  private emitBubble(event: GameEvent): void {
    switch (event.type) {
      case 'tileDiscarded':
        this.onBubble(event.playerIndex, event.tile?.name ?? '');
        break;
      case 'meldDeclared': {
        const labels: Record<string, string> = {
          pung: 'Pong!', chow: 'Chow!', kong: 'Kong!',
        };
        this.onBubble(event.playerIndex, labels[event.meld.type] ?? 'Meld!');
        break;
      }
      case 'gameOver':
        if (event.result.type === 'win' && event.result.winnerIndex !== undefined) {
          this.onBubble(event.result.winnerIndex, 'Hu!');
        }
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Action methods — match GameBridge interface
  // -----------------------------------------------------------------------

  private sendAction(action: PlayerAction): void {
    this.validActions = []; // Clear until next turnNotify
    this.send({ type: 'action', action });
  }

  async discard(tile: Tile): Promise<void> {
    this.sendAction({ type: 'discard', tile });
  }

  async claimPong(): Promise<void> {
    this.sendAction({ type: 'claimPong' });
  }

  async claimChow(chowTiles: [Tile, Tile]): Promise<void> {
    this.sendAction({ type: 'claimChow', chowTiles });
  }

  async claimKong(): Promise<void> {
    this.sendAction({ type: 'claimKong' });
  }

  async claimWin(): Promise<void> {
    this.sendAction({ type: 'claimWin' });
  }

  async pass(): Promise<void> {
    this.sendAction({ type: 'pass' });
  }

  async declareSelfWin(): Promise<void> {
    this.sendAction({ type: 'declareSelfWin' });
  }

  async declareKong(kongTiles: Tile[]): Promise<void> {
    this.sendAction({ type: 'declareKong', tiles: kongTiles });
  }

  async promotePungToKong(tile: Tile): Promise<void> {
    this.sendAction({ type: 'promotePungToKong', tile });
  }

  /** Get valid actions for this player. */
  getValidActions(): PlayerAction[] {
    return this.validActions;
  }

  /** Get this player's seat index. */
  get mySeat(): number {
    return this.seatIndex;
  }
}
