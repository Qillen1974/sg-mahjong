/**
 * SSE (Server-Sent Events) endpoint for OpenClaw agents.
 *
 * Agents connect to GET /api/rooms/:id/events with Bearer auth.
 * Receives: state, turnNotify, gameEvent, ping events.
 */

import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import { SSE_KEEPALIVE_MS } from './config.js';

interface SSEClient {
  res: Response;
  roomId: string;
  seatIndex: number;
}

// Active SSE connections: roomId → seatIndex → Response
const sseClients = new Map<string, Map<number, Response>>();

/** Register an SSE connection. Called from the route handler. */
export function setupSSE(req: Request, res: Response): void {
  const { roomId, seatIndex } = (req as AuthenticatedRequest).auth;

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Store client
  if (!sseClients.has(roomId)) {
    sseClients.set(roomId, new Map());
  }
  sseClients.get(roomId)!.set(seatIndex, res);

  // Send initial connected event
  sendSSE(res, 'connected', { roomId, seatIndex });

  // Keepalive ping
  const pingInterval = setInterval(() => {
    sendSSE(res, 'ping', { time: Date.now() });
  }, SSE_KEEPALIVE_MS);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    const roomClients = sseClients.get(roomId);
    if (roomClients) {
      roomClients.delete(seatIndex);
      if (roomClients.size === 0) {
        sseClients.delete(roomId);
      }
    }
  });
}

/** Send an SSE event to a specific response stream. */
function sendSSE(res: Response, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client may have disconnected
  }
}

/**
 * Send an SSE event to a specific seat in a room.
 * Used by GameRunner broadcast to push events to agent clients.
 */
export function sendSSEToSeat(roomId: string, seatIndex: number, event: string, data: unknown): void {
  const roomClients = sseClients.get(roomId);
  if (!roomClients) return;
  const res = roomClients.get(seatIndex);
  if (res) {
    sendSSE(res, event, data);
  }
}

/** Broadcast an SSE event to all connected seats in a room. */
export function broadcastSSEToRoom(roomId: string, event: string, data: unknown): void {
  const roomClients = sseClients.get(roomId);
  if (!roomClients) return;
  for (const res of roomClients.values()) {
    sendSSE(res, event, data);
  }
}
