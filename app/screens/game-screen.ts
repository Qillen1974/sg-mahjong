import type { ScreenContext } from '../main';
import type { GameState, PlayerAction, SessionConfig, GameResult } from '@lib/game-types';
import type { Tile } from '@lib/tiles';
import { canChow } from '@lib/game';
import { GameBridge } from '../state/game-bridge';
import { createGameBoard } from '../components/game-board';

export function renderGameScreen(ctx: ScreenContext): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen game-screen';

  const sessionConfig: Partial<SessionConfig> = ctx.screenData?.sessionConfig ?? {
    playerTypes: ['human', 'ai', 'ai', 'ai'],
  };

  // Reuse bridge across rounds within same session
  const bridge: GameBridge = ctx.screenData?.resumeBridge ?? new GameBridge(sessionConfig);
  let selectedTile: Tile | null = null;
  let lastDrawnTileId: string | null = null;
  let chowOptions: [Tile, Tile][] | false = false;
  let showChowPicker = false;
  const bubbles = new Map<number, string>();
  const bubbleTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const isResume = !!ctx.screenData?.resumeBridge;

  // Persistent bubble overlay — not destroyed by render()
  const bubbleOverlay = document.createElement('div');
  bubbleOverlay.className = 'bubble-overlay';
  screen.appendChild(bubbleOverlay);

  // Session events
  bridge.subscribeSession((event) => {
    if (event.type === 'roundCompleted') {
      ctx.navigate('result', {
        sessionConfig,
        record: event.record,
        session: bridge.sessionState,
        bridge,
      });
    }
  });

  // Wire up bubble callback
  bridge.onBubble = (playerIndex: number, text: string) => {
    // Clear any existing timer for this player
    const existing = bubbleTimers.get(playerIndex);
    if (existing) clearTimeout(existing);

    bubbles.set(playerIndex, text);
    renderBubbles();

    bubbleTimers.set(playerIndex, setTimeout(() => {
      bubbles.delete(playerIndex);
      bubbleTimers.delete(playerIndex);
      renderBubbles();
    }, 1500));
  };

  // Track drawn tile for visual gap
  bridge.subscribeGame((event) => {
    if (event.type === 'tileDrawn' && event.playerIndex === 0) {
      lastDrawnTileId = event.tile.id;
    }
  });

  function renderBubbles() {
    bubbleOverlay.innerHTML = '';
    for (const [playerIndex, text] of bubbles) {
      const el = document.createElement('div');
      // Position class: player 0=bottom, 1=right, 2=top, 3=left
      const pos = ['bottom', 'right', 'top', 'left'][playerIndex];
      el.className = `speech-bubble speech-bubble-${pos}`;
      el.textContent = text;
      bubbleOverlay.appendChild(el);
    }
  }

  function render() {
    let state = bridge.state;
    if (!state) return;

    // Auto-draw for human player before clearing the screen (avoids double-render flash)
    if (state.phase === 'draw' && state.currentPlayerIndex === 0) {
      bridge.drawTileSync();
      state = bridge.state;
      if (!state) return;
    }

    // Clear everything except the bubble overlay
    const overlay = screen.querySelector('.bubble-overlay');
    screen.innerHTML = '';
    if (overlay) screen.appendChild(overlay);

    if (state.phase === 'roundOver') {
      // Session controller handles this via roundCompleted event
      // Show a brief "Round Over" message while processing
      const msg = document.createElement('div');
      msg.className = 'round-over-msg';
      msg.textContent = 'Round complete...';
      screen.appendChild(msg);
      return;
    }

    const validActions = bridge.getValidActions();

    // Check for chow options if in claim window
    if (state.phase === 'claimWindow') {
      const chowResult = canChow(state, 0);
      chowOptions = chowResult || false;
    } else {
      chowOptions = false;
      showChowPicker = false;
    }

    if (showChowPicker && chowOptions) {
      screen.appendChild(renderChowPicker(chowOptions));
      return;
    }

    const board = createGameBoard({
      state,
      validActions,
      selectedTile,
      lastDrawnTileId,
      onTileClick: handleTileClick,
      onAction: handleAction,
    });

    screen.appendChild(board);
  }

  function handleTileClick(tile: Tile) {
    const state = bridge.state;
    if (!state) return;

    const validActions = bridge.getValidActions();
    const canDiscard = validActions.some(a => a.type === 'discard');

    if (!canDiscard) return;

    // Toggle selection
    if (selectedTile && selectedTile.id === tile.id) {
      // Double-tap to discard
      lastDrawnTileId = null;
      bridge.discard(tile);
      selectedTile = null;
    } else {
      selectedTile = tile;
      render();
    }
  }

  async function handleAction(action: PlayerAction) {
    selectedTile = null;
    lastDrawnTileId = null;

    switch (action.type) {
      case 'discard':
        await bridge.discard(action.tile);
        break;
      case 'claimPong':
        await bridge.claimPong();
        break;
      case 'claimChow':
        // Show chow picker if multiple options
        if (chowOptions && chowOptions.length > 1) {
          showChowPicker = true;
          render();
          return;
        }
        if (chowOptions && chowOptions.length === 1) {
          await bridge.claimChow(chowOptions[0]);
        }
        break;
      case 'claimKong':
        await bridge.claimKong();
        break;
      case 'claimWin':
        await bridge.claimWin();
        break;
      case 'pass':
        await bridge.pass();
        break;
      case 'declareSelfWin':
        await bridge.declareSelfWin();
        break;
      case 'declareKong':
        await bridge.declareKong(action.tiles);
        break;
      case 'promotePungToKong':
        await bridge.promotePungToKong(action.tile);
        break;
    }
  }

  function renderChowPicker(options: [Tile, Tile][]): HTMLElement {
    const picker = document.createElement('div');
    picker.className = 'chow-picker';
    picker.innerHTML = '<h3>Choose tiles for Chow</h3>';

    for (const pair of options) {
      const optBtn = document.createElement('button');
      optBtn.className = 'btn btn-primary chow-option';
      optBtn.textContent = `${pair[0].name} + ${pair[1].name}`;
      optBtn.addEventListener('click', async () => {
        showChowPicker = false;
        await bridge.claimChow(pair);
      });
      picker.appendChild(optBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      showChowPicker = false;
      render();
    });
    picker.appendChild(cancelBtn);

    return picker;
  }

  // Subscribe to updates
  bridge.onUpdate = () => render();

  // Start round (new game or next round in existing session)
  bridge.startRound();
  bridge.advanceAnimated();

  return screen;
}
