import type { ScreenContext } from '../main';
import type { GameState, PlayerAction, SessionConfig, GameResult } from '@lib/game-types';
import type { Tile } from '@lib/tiles';
import { tileKey } from '@lib/tiles';
import { canChow } from '@lib/game';
import { GameBridge } from '../state/game-bridge';
import { NetworkBridge } from '../state/network-bridge';
import { createGameBoard } from '../components/game-board';
import { calculatePayments } from '@lib/payments';

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
  /** Previous state snapshot for detecting changes in online mode (for bubbles). */
  let prevOnlineState: any = null;

  /** Chinese tile names for online mode bubbles. */
  const CN: Record<string, string> = {
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
  function cnTile(tile: any): string {
    if (!tile) return '';
    return CN[tileKey(tile)] ?? tile.name ?? `${tile.suit} ${tile.value}`;
  }

  // Persistent bubble overlay — re-created if destroyed by showWaitingRoom()
  let bubbleOverlay = document.createElement('div');
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
      showBubble(playerIndex, text);
    };

    // Track drawn tile for visual gap + handle trash talk bubbles
    bridge.subscribeGame((event) => {
      if (event.type === 'tileDrawn' && event.playerIndex === 0) {
        lastDrawnTileId = event.tile.id;
      }
      if (event.type === 'playerMessage') {
        showBubble(event.playerIndex, event.message, 3000);
      }
    });
  }

  function renderBubbles() {
    bubbleOverlay.innerHTML = '';
    const mySeat = isOnline && networkBridge ? networkBridge.mySeat : 0;
    for (const [playerIndex, text] of bubbles) {
      const el = document.createElement('div');
      // Position relative to my seat: 0=bottom, +1=right, +2=top, +3=left
      const relPos = (playerIndex - mySeat + 4) % 4;
      const pos = ['bottom', 'right', 'top', 'left'][relPos];
      el.className = `speech-bubble speech-bubble-${pos}`;
      el.textContent = text;
      bubbleOverlay.appendChild(el);
    }
  }

  /** Show a bubble for a player. Optional duration in ms (default 1800). */
  function showBubble(playerIndex: number, text: string, durationMs = 1800) {
    console.log(`[bubble] showBubble called: player=${playerIndex}, text="${text}", overlay.parentNode=${!!bubbleOverlay.parentNode}`);
    const existing = bubbleTimers.get(playerIndex);
    if (existing) clearTimeout(existing);
    bubbles.set(playerIndex, text);
    renderBubbles();
    bubbleTimers.set(playerIndex, setTimeout(() => {
      bubbles.delete(playerIndex);
      bubbleTimers.delete(playerIndex);
      renderBubbles();
    }, durationMs));
  }

  /**
   * Detect state changes between polls and emit speech bubbles.
   * Compares previous and current filtered state to find discards, melds, wins.
   */
  /** Track previous counts to detect state changes between polls. */
  let prevTurnNumber = -1;
  let prevDiscardCounts: number[] = [0, 0, 0, 0];
  let prevMeldCounts: number[] = [0, 0, 0, 0];

  function detectBubblesFromStateChange(_prev: any, curr: any) {
    if (!curr || !curr.players) return;

    const currTurn = curr.turnNumber ?? 0;

    // Detect new discards by tracking each player's discard array length.
    // This is cumulative (like openMelds), so we catch all discards even if
    // multiple happen between polls (e.g. agent claims are instant).
    for (let i = 0; i < 4; i++) {
      const p = curr.players[i];
      if (!p) continue;
      const currDiscardLen = p.discards?.length ?? 0;
      if (currDiscardLen > prevDiscardCounts[i]) {
        // Show bubble for the most recent discard only (not all missed ones)
        const lastDiscard = p.discards[currDiscardLen - 1];
        if (lastDiscard) {
          const tileName = cnTile(lastDiscard);
          showBubble(i, tileName);
        }
      }
      prevDiscardCounts[i] = currDiscardLen;
    }

    // Detect new melds
    for (let i = 0; i < 4; i++) {
      const p = curr.players[i];
      if (!p) continue;
      const currMeldLen = p.openMelds?.length ?? 0;
      if (currMeldLen > prevMeldCounts[i]) {
        const newMeld = p.openMelds[currMeldLen - 1];
        const labels: Record<string, string> = {
          pung: 'Pong!', chow: 'Chow!', kong: 'Kong!',
        };
        const label = labels[newMeld.type] ?? 'Meld!';
        const claimedTile = newMeld.tiles?.[0];
        const tileStr = claimedTile ? ` ${cnTile(claimedTile)}` : '';
        showBubble(i, `${label}${tileStr}`);
      }
      prevMeldCounts[i] = currMeldLen;
    }

    // Detect win
    if (curr.phase === 'roundOver' && curr.result && prevTurnNumber !== -1 && currTurn !== prevTurnNumber) {
      if (curr.result.type === 'win' && curr.result.winnerIndex !== undefined) {
        showBubble(curr.result.winnerIndex, 'Hu!');
      }
    }

    prevTurnNumber = currTurn;
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

    // Clear everything and re-attach bubble overlay
    screen.innerHTML = '';
    bubbleOverlay = document.createElement('div');
    bubbleOverlay.className = 'bubble-overlay';
    screen.appendChild(bubbleOverlay);
    // Re-render any active bubbles into the fresh overlay
    renderBubbles();

    if (state.phase === 'roundOver') {
      if (!isOnline) {
        // Local mode — session controller handles navigation to result screen
        const msg = document.createElement('div');
        msg.className = 'round-over-msg';
        msg.textContent = 'Round complete...';
        screen.appendChild(msg);
        return;
      }

      // Online mode — show result inline
      stopGamePolling();
      screen.appendChild(renderOnlineResult(state));
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

    // Version indicator (remove after debugging)
    const ver = document.createElement('div');
    ver.style.cssText = 'position:fixed;bottom:2px;right:4px;font-size:9px;opacity:0.4;z-index:200;color:white';
    ver.textContent = 'v4';
    screen.appendChild(ver);

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
    // Bubbles are handled by detectBubblesFromStateChange (HTTP polling).
    // Don't also listen to WS gameEvent bubbles — that causes duplicates.
    // But playerMessage (trash talk) is WS-only, so wire it up separately.
    networkBridge.onPlayerMessage = (playerIndex: number, text: string) => {
      showBubble(playerIndex, text, 3000);
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
        // Game started — start HTTP polling for state + actions
        if (waitingTimer) { clearInterval(waitingTimer); waitingTimer = null; }
        startGamePolling(serverUrl, roomId, token);
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

  /** HTTP polling timer for game state — fallback when WS isn't working. */
  let gamePoller: ReturnType<typeof setInterval> | null = null;

  /**
   * Start continuous HTTP polling for game state + valid actions.
   * Uses agent-friendly format which includes validActions.
   * Runs every 2s. Stops when the game screen is left.
   */
  function startGamePolling(serverUrl: string, roomId: string, token: string) {
    // Fetch room data for player names (after startRoom has filled AI seats)
    // Small delay to ensure startRoom has completed on server
    setTimeout(() => {
      fetch(`${serverUrl}/api/rooms/${roomId}`, {})
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.room?.seats) {
            const mySeat = ctx.screenData.seatIndex ?? 0;
            playerNames = data.room.seats.map((s: any, i: number) => {
              if (i === mySeat) return s.playerName || 'You';
              return s.playerName || (s.type === 'ai-standby' ? `AI ${i + 1}` : 'Player');
            });
          }
        })
        .catch(() => {});
    }, 500);

    async function poll() {
      try {
        // Fetch filtered state for board rendering
        const stateRes = await fetch(`${serverUrl}/api/rooms/${roomId}/state`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!stateRes.ok) return;
        const filteredState = await stateRes.json();
        if (!filteredState || !filteredState.players) return;

        // Fetch agent state for valid actions (skip if game is over)
        let validActions: PlayerAction[] = [];
        if (filteredState.phase !== 'roundOver') {
          const res = await fetch(`${serverUrl}/api/rooms/${roomId}/state?format=agent`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (res.ok) {
            const agentState = await res.json();
            validActions = agentState?.validActions || [];
          }
        }

        if (networkBridge) {
          // Detect changes for speech bubbles before updating state
          detectBubblesFromStateChange(prevOnlineState, filteredState);
          prevOnlineState = JSON.parse(JSON.stringify(filteredState));

          // Show trash talk from HTTP polling (playerMessage events)
          if (filteredState.recentMessages) {
            for (const msg of filteredState.recentMessages) {
              // Only show if not already displaying a bubble for this player
              if (!bubbles.has(msg.playerIndex)) {
                showBubble(msg.playerIndex, msg.message, 3000);
              }
            }
          }

          networkBridge.state = filteredState;
          networkBridge.validActions = validActions;
          render();
        }
      } catch { /* ignore */ }
    }

    // Initial poll
    poll();
    // Continue polling every 1s for responsive bubbles
    gamePoller = setInterval(poll, 1000);
  }

  /** Stop game polling (called when leaving the screen). */
  function stopGamePolling() {
    if (gamePoller) {
      clearInterval(gamePoller);
      gamePoller = null;
    }
  }

  /** Render result screen for online mode (inline, no session navigation). */
  function renderOnlineResult(state: any): HTMLElement {
    const result = state.result as GameResult | null;
    const sessionInfo = state.sessionInfo as {
      scores: [number, number, number, number];
      roundNumber: number;
      dealerIndex: number;
      prevailingWind: string;
      finished: boolean;
      windRounds: number;
    } | undefined;
    const mySeat = isOnline && networkBridge ? networkBridge.mySeat : 0;
    const names = playerNames ?? ['You', 'Player 2', 'Player 3', 'Player 4'];
    const container = document.createElement('div');
    container.className = 'result-content';

    let heading = '';
    let details = '';

    if (!result || result.type === 'draw') {
      heading = 'Draw Game';
      details = '<p>The wall was exhausted with no winner.</p>';
    } else if (result.winnerIndex !== undefined) {
      const isMe = result.winnerIndex === mySeat;
      heading = isMe ? 'You Win!' : `${names[result.winnerIndex]} Wins`;

      if (result.scoring) {
        const scoringLines = result.scoring.details
          .map(d => `<li>${d.name}: ${d.tai} tai</li>`)
          .join('');
        details = `
          <div class="scoring-breakdown">
            <p class="total-tai">${result.scoring.tai} Tai Total</p>
            <ul class="scoring-list">${scoringLines}</ul>
          </div>
        `;
      }
    }

    // Use session payment config if available, otherwise defaults
    const paymentConfig = sessionInfo
      ? { base: ctx.screenData?.roomSettings?.base ?? 0.20, taiCap: ctx.screenData?.roomSettings?.taiCap ?? 5, shooterPays: ctx.screenData?.roomSettings?.shooterPays ?? true }
      : { base: 0.20, taiCap: 5, shooterPays: true };

    // Calculate payments for this round
    const payments = result ? calculatePayments(result, paymentConfig)
      : { deltas: [0, 0, 0, 0] as [number, number, number, number] };

    const paymentRows = payments.deltas
      .map((d, i) => {
        const sign = d > 0 ? '+' : '';
        const cls = d > 0 ? 'positive' : d < 0 ? 'negative' : '';
        return `<tr class="${cls}"><td>${names[i]}</td><td>${sign}$${d.toFixed(2)}</td></tr>`;
      })
      .join('');

    // Session total rows (if session info available)
    let sessionTableHtml = '';
    if (sessionInfo) {
      const sessionRows = sessionInfo.scores
        .map((s, i) => {
          const sign = s > 0 ? '+' : '';
          const cls = s > 0 ? 'positive' : s < 0 ? 'negative' : '';
          return `<tr class="${cls}"><td>${names[i]}</td><td>${sign}$${s.toFixed(2)}</td></tr>`;
        })
        .join('');
      const windNames: Record<string, string> = { east: 'East', south: 'South', west: 'West', north: 'North' };
      const windLabel = windNames[sessionInfo.prevailingWind] ?? sessionInfo.prevailingWind;
      sessionTableHtml = `
        <div class="result-table">
          <h3>Session Total</h3>
          <p class="session-meta">Round ${sessionInfo.roundNumber} &bull; ${windLabel} Wind</p>
          <table>${sessionRows}</table>
        </div>
      `;
    }

    // Determine action buttons
    const isHost = ctx.screenData?.isHost ?? false;
    const sessionFinished = sessionInfo?.finished ?? true;

    let actionsHtml = '';
    if (sessionInfo && !sessionFinished && isHost) {
      actionsHtml = `
        <div class="result-actions">
          <button class="btn btn-primary btn-large" id="btn-next-round">Next Round</button>
          <button class="btn btn-secondary" id="btn-back-lobby">Back to Lobby</button>
        </div>
      `;
    } else if (sessionInfo && !sessionFinished && !isHost) {
      actionsHtml = `
        <div class="result-actions">
          <p class="waiting-hint">Waiting for host to start next round...</p>
          <button class="btn btn-secondary" id="btn-back-lobby">Back to Lobby</button>
        </div>
      `;
    } else if (sessionInfo && sessionFinished) {
      actionsHtml = `
        <div class="result-actions">
          <button class="btn btn-primary btn-large" id="btn-back-lobby">Finish</button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="result-actions">
          <button class="btn btn-primary btn-large" id="btn-back-lobby">Back to Lobby</button>
        </div>
      `;
    }

    container.innerHTML = `
      <h2>${heading}</h2>
      ${details}
      <div class="result-tables">
        <div class="result-table">
          <h3>This Round</h3>
          <table>${paymentRows}</table>
        </div>
        ${sessionTableHtml}
      </div>
      ${actionsHtml}
    `;

    container.querySelector('#btn-back-lobby')?.addEventListener('click', () => {
      networkBridge?.disconnect();
      ctx.navigate('lobby');
    });

    container.querySelector('#btn-next-round')?.addEventListener('click', async () => {
      const btn = container.querySelector('#btn-next-round') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Starting...';

      try {
        const serverUrl = ctx.screenData.serverUrl;
        const roomId = ctx.screenData.roomId;
        const token = ctx.screenData.token;

        const res = await fetch(`${serverUrl}/api/rooms/${roomId}/nextRound`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          const err = await res.json();
          alert(err.error || 'Failed to start next round');
          btn.disabled = false;
          btn.textContent = 'Next Round';
          return;
        }

        // Resume game polling
        startGamePolling(serverUrl, roomId, token);
      } catch (e) {
        alert('Failed to start next round');
        btn.disabled = false;
        btn.textContent = 'Next Round';
      }
    });

    // Non-host: poll for next round to start
    if (sessionInfo && !sessionFinished && !isHost) {
      const serverUrl = ctx.screenData.serverUrl;
      const roomId = ctx.screenData.roomId;
      const token = ctx.screenData.token;

      const waitPoller = setInterval(async () => {
        try {
          const res = await fetch(`${serverUrl}/api/rooms/${roomId}/state`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (!res.ok) return;
          const newState = await res.json();
          if (newState && newState.phase && newState.phase !== 'roundOver') {
            // New round started — resume game polling
            clearInterval(waitPoller);
            startGamePolling(serverUrl, roomId, token);
          }
        } catch { /* ignore */ }
      }, 2000);

      // Clean up poller if user navigates away
      const origClick = container.querySelector('#btn-back-lobby');
      origClick?.addEventListener('click', () => clearInterval(waitPoller));
    }

    return container;
  }

  return screen;
}
