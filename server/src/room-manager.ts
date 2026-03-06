/**
 * Room Manager — creates, tracks, and manages game rooms.
 *
 * Each room has 4 seats. Seats can be:
 *   - 'human'       — occupied by a browser or agent player
 *   - 'ai-standby'  — filled by local AI when the game starts
 *   - 'empty'       — waiting for a player to join
 */

import { v4 as uuidv4 } from 'uuid';
import { MAX_ROOMS } from './config.js';
import type { AgentConfig } from './agent-webhook.js';
import type { SessionState } from '../../src/game-types';

export type SeatType = 'human' | 'ai-standby' | 'agent' | 'empty';
export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomSettings {
  name: string;
  /** Base payment per tai. */
  base: number;
  /** Max tai cap. */
  taiCap: number;
  /** Shooter-pays rule. */
  shooterPays: boolean;
  /** Wind rounds (1 = East only). */
  windRounds: number;
  /** Turn timeout in seconds. 0 = no timeout (wait forever). */
  turnTimeout: number;
  /** Between-rounds timeout in seconds. 0 = no timeout (wait forever). */
  betweenRoundsTimeout: number;
}

export interface Seat {
  type: SeatType;
  /** Display name chosen by the player. */
  playerName: string | null;
  /** LLM/webhook config — only for type === 'agent'. */
  agentConfig?: AgentConfig;
}

export interface Room {
  id: string;
  hostSeatIndex: number;
  settings: RoomSettings;
  seats: [Seat, Seat, Seat, Seat];
  status: RoomStatus;
  createdAt: number;
  /** Multi-round session state — created when the game starts. */
  sessionState?: SessionState;
}

const rooms = new Map<string, Room>();

const DEFAULT_SETTINGS: RoomSettings = {
  name: 'Mahjong Room',
  base: 0.20,
  taiCap: 5,
  shooterPays: true,
  windRounds: 1,
  turnTimeout: 0,
  betweenRoundsTimeout: 0,
};

function emptySeats(): [Seat, Seat, Seat, Seat] {
  return [
    { type: 'empty', playerName: null },
    { type: 'empty', playerName: null },
    { type: 'empty', playerName: null },
    { type: 'empty', playerName: null },
  ];
}

/** Create a new room. Returns the room and the host's seat index. */
export function createRoom(
  settings: Partial<RoomSettings> = {},
  hostName: string = 'Host',
): { room: Room; seatIndex: number } {
  if (rooms.size >= MAX_ROOMS) {
    throw new Error('Maximum number of rooms reached');
  }

  const id = uuidv4();
  const seats = emptySeats();
  seats[0] = { type: 'human', playerName: hostName };

  const room: Room = {
    id,
    hostSeatIndex: 0,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    seats,
    status: 'waiting',
    createdAt: Date.now(),
  };

  rooms.set(id, room);
  return { room, seatIndex: 0 };
}

/** Get a room by ID. */
export function getRoom(id: string): Room | undefined {
  return rooms.get(id);
}

/** List all rooms (public info only). */
export function listRooms(): Room[] {
  return Array.from(rooms.values());
}

/** Join a room. Returns the assigned seat index. */
export function joinRoom(
  roomId: string,
  playerName: string = 'Player',
  agentConfig?: AgentConfig,
): { room: Room; seatIndex: number } {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Room not found');
  if (room.status !== 'waiting') throw new Error('Room is not accepting players');

  const seatIndex = room.seats.findIndex(s => s.type === 'empty');
  if (seatIndex === -1) throw new Error('Room is full');

  if (agentConfig) {
    room.seats[seatIndex] = { type: 'agent', playerName, agentConfig };
  } else {
    room.seats[seatIndex] = { type: 'human', playerName };
  }
  return { room, seatIndex };
}

/** Leave a room. Fills the vacated seat with 'empty'. */
export function leaveRoom(roomId: string, seatIndex: number): Room {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Room not found');

  room.seats[seatIndex] = { type: 'empty', playerName: null };

  // If the room is empty (all seats empty), destroy it
  if (room.seats.every(s => s.type === 'empty')) {
    rooms.delete(roomId);
  }

  return room;
}

/**
 * Mark a room as playing. Fills any remaining empty seats with 'ai-standby'.
 * Returns the finalized room.
 */
export function startRoom(roomId: string, requestingSeatIndex: number): Room {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Room not found');
  if (room.status !== 'waiting') throw new Error('Room already started');
  if (requestingSeatIndex !== room.hostSeatIndex) throw new Error('Only the host can start');

  // Must have at least 1 human or agent player
  const playerCount = room.seats.filter(s => s.type === 'human' || s.type === 'agent').length;
  if (playerCount === 0) throw new Error('Need at least one player');

  // Fill empty seats with AI standby
  for (let i = 0; i < 4; i++) {
    if (room.seats[i].type === 'empty') {
      room.seats[i] = { type: 'ai-standby', playerName: `AI ${i + 1}` };
    }
  }

  room.status = 'playing';
  return room;
}

/** Mark a room as finished. */
export function finishRoom(roomId: string): void {
  const room = rooms.get(roomId);
  if (room) {
    room.status = 'finished';
  }
}

/** Delete a room entirely. */
export function deleteRoom(roomId: string): void {
  rooms.delete(roomId);
}

/** Get total number of active rooms (for admin/monitoring). */
export function roomCount(): number {
  return rooms.size;
}
