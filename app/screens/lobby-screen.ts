/**
 * Lobby Screen — room browser for online multiplayer.
 *
 * Features:
 * - Auto-refreshing room list (every 5s)
 * - Create room form with settings
 * - Join room buttons
 * - Navigate to game-screen in online mode on join/start
 */

import type { ScreenContext } from '../main';

/** Server base URL — defaults to same origin in production, localhost:3001 in dev. */
function getServerUrl(): string {
  // In production, API is on same origin via nginx proxy
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    return location.origin;
  }
  // In dev, server runs on port 3001
  return 'http://localhost:3001';
}

const SERVER = getServerUrl();

interface RoomInfo {
  id: string;
  name: string;
  seats: { type: string; playerName: string | null }[];
  status: string;
  playerCount: number;
}

export function renderLobbyScreen(ctx: ScreenContext): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen lobby-screen';

  let rooms: RoomInfo[] = [];
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  /** Initial render — called once. Sets up the static form and room list container. */
  function renderInitial() {
    screen.innerHTML = `
      <div class="lobby-content">
        <div class="lobby-header">
          <h2>Online Lobby</h2>
          <button class="btn btn-secondary" id="btn-back">Back</button>
        </div>

        <div class="lobby-create">
          <h3>Create Room</h3>
          <div class="create-form">
            <input type="text" id="room-name" placeholder="Room name" value="Mahjong Room" class="lobby-input" />
            <input type="text" id="player-name" placeholder="Your name" value="Player" class="lobby-input" />
            <button class="btn btn-primary" id="btn-create">Create</button>
          </div>
        </div>

        <div class="lobby-rooms">
          <h3>Open Rooms <span class="room-count">(0)</span></h3>
          <div id="room-list">
            <p class="no-rooms">No rooms available. Create one!</p>
          </div>
        </div>
      </div>
    `;

    screen.querySelector('#btn-back')!.addEventListener('click', () => {
      cleanup();
      ctx.navigate('title');
    });

    screen.querySelector('#btn-create')!.addEventListener('click', handleCreate);
  }

  /** Update only the room list — leaves the form inputs untouched. */
  function updateRoomList() {
    const roomList = screen.querySelector('#room-list');
    const roomCount = screen.querySelector('.room-count');
    if (!roomList) return;

    if (roomCount) roomCount.textContent = `(${rooms.length})`;

    roomList.innerHTML = rooms.length === 0
      ? '<p class="no-rooms">No rooms available. Create one!</p>'
      : rooms.map(r => renderRoomCard(r)).join('');

    // Wire join buttons
    roomList.querySelectorAll('.btn-join').forEach(btn => {
      btn.addEventListener('click', () => {
        const roomId = (btn as HTMLElement).dataset.roomId!;
        handleJoin(roomId);
      });
    });
  }

  function renderRoomCard(room: RoomInfo): string {
    const seatIcons = room.seats.map(s => {
      if (s.type === 'human') return `<span class="seat-taken" title="${s.playerName}">&#x1F464;</span>`;
      if (s.type === 'ai-standby') return '<span class="seat-ai" title="AI">&#x1F916;</span>';
      return '<span class="seat-empty" title="Empty">&#x25CB;</span>';
    }).join('');

    const canJoin = room.status === 'waiting' && room.seats.some(s => s.type === 'empty');

    return `
      <div class="room-card">
        <div class="room-info">
          <span class="room-name">${escapeHtml(room.name)}</span>
          <span class="room-seats">${seatIcons}</span>
        </div>
        <div class="room-actions">
          <span class="room-status">${room.status}</span>
          ${canJoin ? `<button class="btn btn-primary btn-small btn-join" data-room-id="${room.id}">Join</button>` : ''}
        </div>
      </div>
    `;
  }

  async function fetchRooms() {
    try {
      const res = await fetch(`${SERVER}/api/rooms`);
      if (res.ok) {
        const data = await res.json();
        const newRooms = data.rooms.filter((r: RoomInfo) => r.status === 'waiting');
        // Only update DOM if room list actually changed (avoid stealing input focus)
        const newJson = JSON.stringify(newRooms.map((r: RoomInfo) => r.id));
        const oldJson = JSON.stringify(rooms.map(r => r.id));
        if (newJson !== oldJson) {
          rooms = newRooms;
          updateRoomList();
        }
      }
    } catch (e) {
      console.error('Failed to fetch rooms:', e);
    }
  }

  async function handleCreate() {
    const nameInput = screen.querySelector('#room-name') as HTMLInputElement;
    const playerInput = screen.querySelector('#player-name') as HTMLInputElement;
    const roomName = nameInput.value.trim() || 'Mahjong Room';
    const playerName = playerInput.value.trim() || 'Player';

    try {
      const res = await fetch(`${SERVER}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { name: roomName },
          playerName,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to create room');
        return;
      }

      const data = await res.json();
      cleanup();
      ctx.navigate('game', {
        mode: 'online',
        serverUrl: SERVER,
        roomId: data.roomId,
        token: data.token,
        seatIndex: data.seatIndex,
        isHost: true,
      });
    } catch (e) {
      alert('Failed to connect to server');
    }
  }

  async function handleJoin(roomId: string) {
    const playerInput = screen.querySelector('#player-name') as HTMLInputElement;
    const playerName = playerInput?.value.trim() || 'Player';

    try {
      const res = await fetch(`${SERVER}/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to join room');
        return;
      }

      const data = await res.json();
      cleanup();
      ctx.navigate('game', {
        mode: 'online',
        serverUrl: SERVER,
        roomId: data.roomId,
        token: data.token,
        seatIndex: data.seatIndex,
        isHost: false,
      });
    } catch (e) {
      alert('Failed to connect to server');
    }
  }

  function cleanup() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function escapeHtml(text: string): string {
    const el = document.createElement('span');
    el.textContent = text;
    return el.innerHTML;
  }

  // Initial render, then fetch rooms and auto-refresh
  renderInitial();
  fetchRooms();
  refreshTimer = setInterval(fetchRooms, 5000);

  return screen;
}
