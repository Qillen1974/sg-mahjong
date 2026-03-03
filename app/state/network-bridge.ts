/**
 * NetworkBridge — same interface as GameBridge but sends actions over WebSocket.
 *
 * Used in online multiplayer mode. No local game engine — the server
 * is authoritative. This bridge sends actions to the server and receives
 * state updates via WebSocket.
 */

import type { PlayerAction, GameEvent, GameState } from '@lib/game-types';
import type { Tile } from '@lib/tiles';
import { tileKey } from '@lib/tiles';
import type { FilteredGameState } from '../../server/src/state-filter';

export type NetworkUpdateCallback = (state: FilteredGameState) => void;
export type BubbleCallback = (playerIndex: number, text: string) => void;

interface WSMessage {
  type: string;
  data: unknown;
}

/** Map tile keys to short Chinese names for speech bubbles. */
const CHINESE_NAMES: Record<string, string> = {
  characters_1: '一萬', characters_2: '二萬', characters_3: '三萬',
  characters_4: '四萬', characters_5: '五萬', characters_6: '六萬',
  characters_7: '七萬', characters_8: '八萬', characters_9: '九萬',
  dots_1: '一筒', dots_2: '二筒', dots_3: '三筒',
  dots_4: '四筒', dots_5: '五筒', dots_6: '六筒',
  dots_7: '七筒', dots_8: '八筒', dots_9: '九筒',
  bamboo_1: '一條', bamboo_2: '二條', bamboo_3: '三條',
  bamboo_4: '四條', bamboo_5: '五條', bamboo_6: '六條',
  bamboo_7: '七條', bamboo_8: '八條', bamboo_9: '九條',
  winds_east: '東', winds_south: '南', winds_west: '西', winds_north: '北',
  dragons_red: '中', dragons_green: '發', dragons_white: '白',
};

function tileChinese(tile: Tile | null | undefined): string {
  if (!tile) return '';
  return CHINESE_NAMES[tileKey(tile)] ?? tile.name;
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
        this.onBubble(event.playerIndex, tileChinese(event.tile));
        break;
      case 'meldDeclared': {
        const labels: Record<string, string> = {
          pung: 'Pong!', chow: 'Chow!', kong: 'Kong!',
        };
        const label = labels[event.meld.type] ?? 'Meld!';
        // Show the claimed tile in the bubble
        const claimedTile = event.meld.tiles?.[0];
        const tileStr = claimedTile ? ` ${tileChinese(claimedTile)}` : '';
        this.onBubble(event.playerIndex, `${label}${tileStr}`);
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
    // Always use HTTP for actions — more reliable than WebSocket.
    // WebSocket connections can silently drop, causing lost actions.
    console.log(`[action] Sending ${action.type} via HTTP`);
    fetch(`${this.serverUrl}/api/rooms/${this.roomId}/action`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action }),
    })
      .then(res => {
        if (!res.ok) {
          res.json().then(data => console.error('[action] Server rejected:', data.error));
        } else {
          console.log(`[action] ${action.type} accepted`);
        }
      })
      .catch(err => console.error('[action] HTTP failed:', err));
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
