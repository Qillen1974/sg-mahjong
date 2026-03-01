import type { ScreenContext } from '../main';
import type { GameState, PlayerAction, SessionConfig, GameResult } from '@lib/game-types';
import type { Tile } from '@lib/tiles';
import { canChow } from '@lib/game';
import { GameBridge } from '../state/game-bridge';
import { NetworkBridge } from '../state/network-bridge';
import { createGameBoard } from '../components/game-board';

export function renderGameScreen(ctx: ScreenContext): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen game-screen';

  const mode: 'local' | 'online' = ctx.screenData?.mode ?? 'local';
  const isOnline = mode === 'online';

  const sessionConfig: Partial<SessionConfig> = ctx.screenData?.sessionConfig ?? {
    playerTypes: ['human', 'ai', 'ai', 'ai'],
  };

  // Bridge — either local GameBridge or network NetworkBridge
  let bridge: GameBridge;
  let networkBridge: NetworkBridge | null = null;

  if (isOnline) {
    const { serverUrl, roomId, token, seatIndex } = ctx.screenData;
    networkBridge = new NetworkBridge(serverUrl, roomId, token, seatIndex);
    // GameBridge is still created for type compat but won't be used in online mode
    bridge = null as any;
  } else {
    bridge = ctx.screenData?.resumeBridge ?? new GameBridge(sessionConfig);
  }

  let selectedTile: Tile | null = null;
  let lastDrawnTileId: string | null = null;
  let chowOptions: [Tile, Tile][] | false = false;
  let showChowPicker = false;
  const bubbles = new Map<number, string>();
  const bubbleTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const isResume = !!ctx.screenData?.resumeBridge;
  /** Player names per seat index (populated in online mode from room data). */
  let playerNames: string[] | undefined;

  // Persistent bubble overlay — not destroyed by render()
  const bubbleOverlay = document.createElement('div');
  bubbleOverlay.className = 'bubble-overlay';
  screen.appendChild(bubbleOverlay);

  // Session events & bubble callback (local mode only — online mode uses NetworkBridge)
  if (!isOnline) {
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

    bridge.onBubble = (playerIndex: number, text: string) => {
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
  }

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
    let state: any;
    if (isOnline && networkBridge) {
      state = networkBridge.state;
    } else {
      state = bridge.state;
    }
    if (!state) return;

    // Auto-draw for human player (local mode only — server handles draws in online mode)
    if (!isOnline && state.phase === 'draw' && state.currentPlayerIndex === 0) {
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

    const validActions = isOnline && networkBridge
      ? networkBridge.getValidActions()
      : bridge.getValidActions();

    // Check for chow options if in claim window
    if (state.phase === 'claimWindow' && !isOnline) {
      const chowResult = canChow(state, 0);
      chowOptions = chowResult || false;
    } else if (state.phase === 'claimWindow' && isOnline) {
      // In online mode, extract chow options from valid actions
      const chowActions = validActions.filter((a: PlayerAction) => a.type === 'claimChow');
      chowOptions = chowActions.length > 0
        ? chowActions.map((a: any) => a.chowTiles as [Tile, Tile])
        : false;
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
      mySeat: isOnline && networkBridge ? networkBridge.mySeat : 0,
      playerNames,
    });

    screen.appendChild(board);
  }

  function handleTileClick(tile: Tile) {
    const state = isOnline && networkBridge ? networkBridge.state : bridge.state;
    if (!state) return;

    const validActions = isOnline && networkBridge
      ? networkBridge.getValidActions()
      : bridge.getValidActions();
    const canDiscard = validActions.some(a => a.type === 'discard');

    if (!canDiscard) return;

    // Toggle selection
    if (selectedTile && selectedTile.id === tile.id) {
      // Double-tap to discard
      lastDrawnTileId = null;
      const b = isOnline && networkBridge ? networkBridge : bridge;
      b.discard(tile);
      selectedTile = null;
    } else {
      selectedTile = tile;
      render();
    }
  }

  async function handleAction(action: PlayerAction) {
    selectedTile = null;
    lastDrawnTileId = null;
    const b = isOnline && networkBridge ? networkBridge : bridge;

    switch (action.type) {
      case 'discard':
        await b.discard(action.tile);
        break;
      case 'claimPong':
        await b.claimPong();
        break;
      case 'claimChow':
        // Show chow picker if multiple options
        if (chowOptions && chowOptions.length > 1) {
          showChowPicker = true;
          render();
          return;
        }
        if (chowOptions && chowOptions.length === 1) {
          await b.claimChow(chowOptions[0]);
        }
        break;
      case 'claimKong':
        await b.claimKong();
        break;
      case 'claimWin':
        await b.claimWin();
        break;
      case 'pass':
        await b.pass();
        break;
      case 'declareSelfWin':
        await b.declareSelfWin();
        break;
      case 'declareKong':
        await b.declareKong(action.tiles);
        break;
      case 'promotePungToKong':
        await b.promotePungToKong(action.tile);
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
        const b = isOnline && networkBridge ? networkBridge : bridge;
        await b.claimChow(pair);
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

  if (isOnline && networkBridge) {
    // Online mode — wire up NetworkBridge
    networkBridge.onUpdate = () => render();
    networkBridge.onBubble = (playerIndex: number, text: string) => {
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

    // Show waiting room immediately while connecting
    showWaitingRoom();

    // Connect to server
    networkBridge.connect().catch(err => {
      console.error('Connection failed:', err);
      screen.innerHTML = '';
      const errDiv = document.createElement('div');
      errDiv.className = 'waiting-room';
      errDiv.innerHTML = `
        <h2>Connection Failed</h2>
        <p>${err.message || 'Could not connect to game server.'}</p>
        <button class="btn btn-primary" id="btn-retry">Retry</button>
        <button class="btn btn-secondary" id="btn-back-lobby">Back to Lobby</button>
      `;
      screen.appendChild(errDiv);
      errDiv.querySelector('#btn-retry')?.addEventListener('click', () => {
        showWaitingRoom();
        networkBridge!.connect().catch(() => ctx.navigate('lobby'));
      });
      errDiv.querySelector('#btn-back-lobby')?.addEventListener('click', () => {
        ctx.navigate('lobby');
      });
    });
  } else {
    // Local mode — wire up GameBridge
    bridge.onUpdate = () => render();
    bridge.startRound();
    bridge.advanceAnimated();
  }

  /** Show waiting room until game starts. Host gets a Start button. */
  function showWaitingRoom() {
    screen.innerHTML = '';
    const waiting = document.createElement('div');
    waiting.className = 'waiting-room';
    const isHost = ctx.screenData.isHost;
    const roomId = ctx.screenData.roomId;
    const serverUrl = ctx.screenData.serverUrl;
    const token = ctx.screenData.token;

    waiting.innerHTML = `
      <h2>Waiting Room</h2>
      <p>${isHost ? 'Tell your agents: "Join mahjong room" and give them the Room ID below.' : 'Waiting for the host to start the game.'}</p>
      <div class="room-id-display">
        <label>Room ID</label>
        <div class="copy-row">
          <code id="room-id-text">${roomId}</code>
          <button class="btn btn-secondary btn-small" id="btn-copy-id">Copy</button>
        </div>
      </div>
      <div class="seat-list" id="seat-list"></div>
      ${isHost ? '<button class="btn btn-primary btn-large" id="btn-start-game">Start Game (AI fills empty seats)</button>' : ''}
      <button class="btn btn-secondary" id="btn-leave">Leave</button>
    `;
    screen.appendChild(waiting);

    // Poll room state to show who's joined
    let waitingTimer: ReturnType<typeof setInterval> | null = null;

    function updateSeats(seats: { type: string; playerName: string | null }[]) {
      // Store player names for game board display
      playerNames = seats.map((s, i) => {
        if (i === (ctx.screenData.seatIndex ?? 0)) return s.playerName || 'You';
        return s.playerName || (s.type === 'empty' ? 'Empty' : `AI ${i + 1}`);
      });

      const seatList = waiting.querySelector('#seat-list');
      if (!seatList) return;
      seatList.innerHTML = seats.map((s, i) => {
        const winds = ['East', 'South', 'West', 'North'];
        const icon = s.type === 'human' ? '&#x1F464;' : s.type === 'ai-standby' ? '&#x1F916;' : '&#x25CB;';
        const name = s.playerName || (s.type === 'empty' ? 'Empty' : 'AI');
        return `<div class="seat-slot ${s.type}"><span class="seat-wind">${winds[i]}</span> ${icon} <span>${name}</span></div>`;
      }).join('');
    }

    async function pollRoom() {
      try {
        const res = await fetch(`${serverUrl}/api/rooms/${roomId}`);
        if (res.ok) {
          const data = await res.json();
          updateSeats(data.room.seats);
        }
      } catch { /* ignore */ }
    }

    pollRoom();
    waitingTimer = setInterval(pollRoom, 2000);

    waiting.querySelector('#btn-copy-id')?.addEventListener('click', () => {
      navigator.clipboard.writeText(roomId).then(() => {
        const btn = waiting.querySelector('#btn-copy-id') as HTMLButtonElement;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });

    waiting.querySelector('#btn-start-game')?.addEventListener('click', async () => {
      try {
        const res = await fetch(`${serverUrl}/api/rooms/${roomId}/start`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) {
          const err = await res.json();
          alert(err.error || 'Failed to start');
          return;
        }
        // Game started — fetch state via HTTP as fallback (in case WS isn't connected)
        if (waitingTimer) { clearInterval(waitingTimer); waitingTimer = null; }
        await pollForGameState(serverUrl, roomId, token);
      } catch (e) {
        alert('Failed to start game');
      }
    });

    waiting.querySelector('#btn-leave')!.addEventListener('click', () => {
      if (waitingTimer) clearInterval(waitingTimer);
      networkBridge?.disconnect();
      ctx.navigate('lobby');
    });

    // Clean up polling when game starts (render() will be called by onUpdate)
    const origOnUpdate = networkBridge!.onUpdate;
    networkBridge!.onUpdate = (state) => {
      if (waitingTimer) {
        clearInterval(waitingTimer);
        waitingTimer = null;
      }
      origOnUpdate(state);
    };
  }

  /** Poll server for game state via HTTP — fallback when WS isn't delivering updates. */
  async function pollForGameState(serverUrl: string, roomId: string, token: string) {
    for (let i = 0; i < 10; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/rooms/${roomId}/state`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const state = await res.json();
          if (state && state.players) {
            // We have game state — update the bridge and render
            if (networkBridge) {
              networkBridge.state = state;
              networkBridge.onUpdate(state);
            }
            return;
          }
        }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return screen;
}
