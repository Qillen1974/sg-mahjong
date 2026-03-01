/**
 * WebSocket Handler — manages browser player connections.
 *
 * Protocol:
 *   Client → Server:
 *     { type: 'auth', token: string }
 *     { type: 'action', action: PlayerAction }
 *
 *   Server → Client:
 *     { type: 'gameState', data: FilteredGameState }
 *     { type: 'gameEvent', data: FilteredGameEvent }
 *     { type: 'turnNotify', data: { seatIndex, phase, validActions } }
 *     { type: 'error', data: { message: string } }
 *     { type: 'roomUpdate', data: Room }
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { validateToken } from './auth.js';
import type { GameRunner } from './game-runner.js';

interface AuthedSocket {
  ws: WebSocket;
  roomId: string;
  seatIndex: number;
}

// Maps: roomId → seatIndex → WebSocket
const connections = new Map<string, Map<number, WebSocket>>();

// Active game runners per room
const gameRunners = new Map<string, GameRunner>();

export function registerGameRunner(roomId: string, runner: GameRunner): void {
  gameRunners.set(roomId, runner);
}

export function unregisterGameRunner(roomId: string): void {
  gameRunners.delete(roomId);
}

export function getGameRunner(roomId: string): GameRunner | undefined {
  return gameRunners.get(roomId);
}

/** Send a message to a specific seat in a room. */
export function sendToSeat(roomId: string, seatIndex: number, type: string, data: unknown): void {
  const roomConns = connections.get(roomId);
  if (!roomConns) return;
  const ws = roomConns.get(seatIndex);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

/** Send a message to all connected seats in a room. */
export function broadcastToRoom(roomId: string, type: string, data: unknown): void {
  const roomConns = connections.get(roomId);
  if (!roomConns) return;
  const msg = JSON.stringify({ type, data });
  for (const ws of roomConns.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

/** Create broadcast function for GameRunner use. */
export function createBroadcastFn(roomId: string) {
  return (seatIndex: number, type: string, data: unknown) => {
    sendToSeat(roomId, seatIndex, type, data);
  };
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    let authed: AuthedSocket | null = null;

    ws.on('message', (raw: Buffer) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid JSON' } }));
        return;
      }

      if (msg.type === 'auth') {
        handleAuth(ws, msg.token as string, (info) => {
          authed = info;
        });
        return;
      }

      if (!authed) {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Not authenticated. Send auth message first.' } }));
        return;
      }

      if (msg.type === 'action') {
        handleAction(authed, msg.action as any);
        return;
      }

      ws.send(JSON.stringify({ type: 'error', data: { message: `Unknown message type: ${msg.type}` } }));
    });

    ws.on('close', () => {
      if (authed) {
        removeConnection(authed.roomId, authed.seatIndex);
      }
    });

    ws.on('error', () => {
      if (authed) {
        removeConnection(authed.roomId, authed.seatIndex);
      }
    });
  });

  return wss;
}

function handleAuth(
  ws: WebSocket,
  token: string,
  onSuccess: (info: AuthedSocket) => void,
): void {
  const info = validateToken(token);
  if (!info) {
    ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid token' } }));
    return;
  }

  // Store connection
  if (!connections.has(info.roomId)) {
    connections.set(info.roomId, new Map());
  }
  connections.get(info.roomId)!.set(info.seatIndex, ws);

  const authed: AuthedSocket = { ws, roomId: info.roomId, seatIndex: info.seatIndex };
  onSuccess(authed);

  ws.send(JSON.stringify({
    type: 'authOk',
    data: { roomId: info.roomId, seatIndex: info.seatIndex },
  }));

  // If game is already running, send current state
  const runner = gameRunners.get(info.roomId);
  if (runner) {
    ws.send(JSON.stringify({
      type: 'gameState',
      data: runner.getStateForPlayer(info.seatIndex),
    }));
  }
}

function handleAction(authed: AuthedSocket, action: any): void {
  const runner = gameRunners.get(authed.roomId);
  if (!runner) {
    authed.ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'No game in progress' },
    }));
    return;
  }

  const result = runner.submitAction(authed.seatIndex, action);
  if (!result.ok) {
    authed.ws.send(JSON.stringify({
      type: 'error',
      data: { message: result.error },
    }));
  }
}

function removeConnection(roomId: string, seatIndex: number): void {
  const roomConns = connections.get(roomId);
  if (roomConns) {
    roomConns.delete(seatIndex);
    if (roomConns.size === 0) {
      connections.delete(roomId);
    }
  }
}
