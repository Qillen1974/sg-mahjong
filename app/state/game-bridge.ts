import { SessionController } from '@lib/game-session';
import type { GameState, PlayerAction, SessionConfig, SessionState, GameEvent, SessionEvent } from '@lib/game-types';
import type { Tile } from '@lib/tiles';
import { tileKey } from '@lib/tiles';

export type UpdateCallback = (state: GameState, session: SessionState) => void;
export type BubbleCallback = (playerIndex: number, text: string) => void;

/** Map tile keys to short Chinese names for speech bubbles. */
const CHINESE_NAMES: Record<string, string> = {
  // Characters (萬)
  characters_1: '一萬', characters_2: '二萬', characters_3: '三萬',
  characters_4: '四萬', characters_5: '五萬', characters_6: '六萬',
  characters_7: '七萬', characters_8: '八萬', characters_9: '九萬',
  // Dots (筒)
  dots_1: '一筒', dots_2: '二筒', dots_3: '三筒',
  dots_4: '四筒', dots_5: '五筒', dots_6: '六筒',
  dots_7: '七筒', dots_8: '八筒', dots_9: '九筒',
  // Bamboo (條)
  bamboo_1: '一條', bamboo_2: '二條', bamboo_3: '三條',
  bamboo_4: '四條', bamboo_5: '五條', bamboo_6: '六條',
  bamboo_7: '七條', bamboo_8: '八條', bamboo_9: '九條',
  // Winds
  winds_east: '東', winds_south: '南', winds_west: '西', winds_north: '北',
  // Dragons
  dragons_red: '中', dragons_green: '發', dragons_white: '白',
};

function tileChinese(tile: Tile): string {
  return CHINESE_NAMES[tileKey(tile)] ?? tile.name;
}

export class GameBridge {
  session: SessionController;
  onUpdate: UpdateCallback = () => {};
  onBubble: BubbleCallback = () => {};
  private advancing = false;

  constructor(config?: Partial<SessionConfig>) {
    this.session = new SessionController(config);
  }

  private get game() {
    return this.session.currentGame;
  }

  startRound() {
    this.session.startRound();
    this.notifyUpdate();
  }

  /** Run all AI turns one step at a time with animation pauses. */
  async advanceAnimated() {
    if (this.advancing || !this.game) return;
    this.advancing = true;
    try {
      while (true) {
        const { events, done } = await this.game.step();
        this.emitBubbles(events);
        this.notifyUpdate();
        if (done) break;
        await this.sleep(this.getDelay(events));
      }
    } catch (e) {
      console.error('advanceGame error:', e);
    }
    this.advancing = false;
  }

  /** Legacy non-animated advance (still used internally). */
  async advanceAndUpdate() {
    if (this.advancing || !this.game) return;
    this.advancing = true;
    try {
      await this.session.advanceRound();
    } catch (e) {
      console.error('advanceGame error:', e);
    }
    this.advancing = false;
    this.notifyUpdate();
  }

  private emitBubbles(events: GameEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'tileDiscarded':
          this.onBubble(e.playerIndex, tileChinese(e.tile));
          break;
        case 'meldDeclared': {
          const labels: Record<string, string> = {
            pung: 'Pong!', chow: 'Chow!', kong: 'Kong!',
          };
          this.onBubble(e.playerIndex, labels[e.meld.type] ?? 'Meld!');
          break;
        }
        case 'gameOver':
          if (e.result.type === 'win' && e.result.winnerIndex !== undefined) {
            this.onBubble(e.result.winnerIndex, 'Hu!');
          }
          break;
      }
    }
  }

  private getDelay(events: GameEvent[]): number {
    // Use the most significant event to pick the delay
    for (const e of events) {
      if (e.type === 'gameOver') return 2000;
      if (e.type === 'meldDeclared') return 1200;
      if (e.type === 'tileDiscarded') return 800;
      if (e.type === 'tileDrawn') return 300;
    }
    return 400;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getValidActions(): PlayerAction[] {
    if (!this.game) return [];
    return this.game.getValidActions(0);
  }

  get state(): GameState | null {
    return this.game?.state ?? null;
  }

  get sessionState(): SessionState {
    return this.session.session;
  }

  get isRoundOver(): boolean {
    return this.game?.isOver ?? false;
  }

  get isSessionFinished(): boolean {
    return this.session.isFinished;
  }

  // Human actions — all target player 0
  async discard(tile: Tile) {
    if (!this.game) return;
    this.game.discardTile(tile);
    await this.advanceAnimated();
  }

  async claimPong() {
    if (!this.game) return;
    this.game.claimPong(0);
    await this.advanceAnimated();
  }

  async claimChow(chowTiles: [Tile, Tile]) {
    if (!this.game) return;
    this.game.claimChow(0, chowTiles);
    await this.advanceAnimated();
  }

  async claimKong() {
    if (!this.game) return;
    this.game.claimKong(0);
    await this.advanceAnimated();
  }

  async claimWin() {
    if (!this.game) return;
    this.game.claimWin(0);
    await this.advanceAnimated();
  }

  async pass() {
    if (!this.game) return;
    this.game.passClaim();
    await this.advanceAnimated();
  }

  async declareSelfWin() {
    if (!this.game) return;
    this.game.declareSelfWin();
    await this.advanceAnimated();
  }

  async declareKong(kongTiles: Tile[]) {
    if (!this.game) return;
    this.game.declareKong(kongTiles);
    await this.advanceAnimated();
  }

  async promotePungToKong(tile: Tile) {
    if (!this.game) return;
    this.game.promotePungToKong(tile);
    await this.advanceAnimated();
  }

  async drawTile() {
    if (!this.game) return;
    this.game.drawTile();
    await this.advanceAnimated();
  }

  subscribeSession(listener: (event: SessionEvent) => void): () => void {
    return this.session.onSession(listener);
  }

  subscribeGame(listener: (event: GameEvent) => void): () => void {
    return this.session.onGame(listener);
  }

  private notifyUpdate() {
    if (this.game) {
      this.onUpdate(this.game.state, this.session.session);
    }
  }
}
