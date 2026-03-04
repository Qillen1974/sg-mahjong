/**
 * REST API Router — all HTTP endpoints for room management and gameplay.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { createToken, requireAuth, revokeToken, revokeRoomTokens } from './auth.js';
import type { AuthenticatedRequest } from './auth.js';
import {
  createRoom,
  getRoom,
  listRooms,
  joinRoom,
  leaveRoom,
  startRoom,
  finishRoom,
} from './room-manager.js';
import { GameRunner } from './game-runner.js';
import {
  registerGameRunner,
  unregisterGameRunner,
  getGameRunner,
  sendToSeat,
  createBroadcastFn,
} from './ws-handler.js';
import { sendSSEToSeat } from './agent-sse.js';
import { setupSSE } from './agent-sse.js';
import { buildAgentState } from './state-filter.js';

export const router = Router();

/** Extract route param as string (Express 5 params can be string | string[]). */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// ---------------------------------------------------------------------------
// Room CRUD
// ---------------------------------------------------------------------------

/** GET /api/rooms — List open rooms. */
router.get('/rooms', (_req: Request, res: Response) => {
  const rooms = listRooms().map(r => ({
    id: r.id,
    name: r.settings.name,
    seats: r.seats.map(s => ({ type: s.type, playerName: s.playerName })),
    status: r.status,
    playerCount: r.seats.filter(s => s.type === 'human' || s.type === 'agent').length,
    createdAt: r.createdAt,
  }));
  res.json({ rooms });
});

/** POST /api/rooms — Create a new room. */
router.post('/rooms', (req: Request, res: Response) => {
  try {
    const { settings, playerName } = req.body ?? {};
    const { room, seatIndex } = createRoom(settings, playerName ?? 'Host');
    const token = createToken(room.id, seatIndex, true);
    res.status(201).json({
      roomId: room.id,
      seatIndex,
      token,
      room: sanitizeRoom(room),
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/** GET /api/rooms/:id — Room details. */
router.get('/rooms/:id', (req: Request, res: Response) => {
  const room = getRoom(param(req, 'id'));
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json({ room: sanitizeRoom(room) });
});

/** POST /api/rooms/:id/join — Join a room. */
router.post('/rooms/:id/join', (req: Request, res: Response) => {
  try {
    const { playerName, agentConfig } = req.body ?? {};

    // Validate agentConfig if provided
    if (agentConfig) {
      if (!agentConfig.llm && !agentConfig.webhookUrl) {
        res.status(400).json({ error: 'agentConfig must include "llm" or "webhookUrl"' });
        return;
      }
      if (agentConfig.llm) {
        if (!agentConfig.llm.endpoint || !agentConfig.llm.apiKey || !agentConfig.llm.model) {
          res.status(400).json({ error: 'agentConfig.llm requires endpoint, apiKey, and model' });
          return;
        }
        try {
          new URL(agentConfig.llm.endpoint);
        } catch {
          res.status(400).json({ error: 'agentConfig.llm.endpoint must be a valid URL' });
          return;
        }
      }
      if (agentConfig.webhookUrl) {
        try {
          new URL(agentConfig.webhookUrl);
        } catch {
          res.status(400).json({ error: 'agentConfig.webhookUrl must be a valid URL' });
          return;
        }
      }
    }

    // Log agent join for debugging
    if (agentConfig) {
      const maskedKey = agentConfig.llm?.apiKey
        ? `${agentConfig.llm.apiKey.slice(0, 8)}...${agentConfig.llm.apiKey.slice(-4)}`
        : 'none';
      console.log(`[API] Agent join: player=${playerName}, endpoint=${agentConfig.llm?.endpoint ?? agentConfig.webhookUrl}, apiKey=${maskedKey}, model=${agentConfig.llm?.model}`);
    }

    const { room, seatIndex } = joinRoom(param(req, 'id'), playerName ?? 'Player', agentConfig);
    const token = createToken(room.id, seatIndex, false);
    res.json({
      roomId: room.id,
      seatIndex,
      token,
      room: sanitizeRoom(room),
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/** POST /api/rooms/:id/leave — Leave a room (auth required). */
router.post('/rooms/:id/leave', requireAuth, (req: Request, res: Response) => {
  const { roomId, seatIndex } = (req as AuthenticatedRequest).auth;
  const token = (req as AuthenticatedRequest).token;

  if (roomId !== param(req, 'id')) {
    res.status(403).json({ error: 'Token does not match this room' });
    return;
  }

  try {
    leaveRoom(roomId, seatIndex);
    revokeToken(token);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/** POST /api/rooms/:id/start — Start the game (host only). */
router.post('/rooms/:id/start', requireAuth, (req: Request, res: Response) => {
  const { roomId, seatIndex } = (req as AuthenticatedRequest).auth;

  if (roomId !== param(req, 'id')) {
    res.status(403).json({ error: 'Token does not match this room' });
    return;
  }

  try {
    const room = startRoom(roomId, seatIndex);

    // Create broadcast function that sends to both WS and SSE
    const broadcast = (seat: number, type: string, data: unknown) => {
      sendToSeat(roomId, seat, type, data);
      sendSSEToSeat(roomId, seat, type, data);
    };

    // Create and register the game runner
    const runner = new GameRunner(room, broadcast);
    registerGameRunner(roomId, runner);

    // Start the game loop asynchronously
    runner.run().then(() => {
      finishRoom(roomId);
      // Keep runner registered for 60s so clients can poll the final roundOver state
      setTimeout(() => unregisterGameRunner(roomId), 60_000);
    }).catch(err => {
      console.error(`Game error in room ${roomId}:`, err);
      finishRoom(roomId);
      setTimeout(() => unregisterGameRunner(roomId), 60_000);
    });

    res.json({ ok: true, room: sanitizeRoom(room) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Game Actions (auth required)
// ---------------------------------------------------------------------------

/** GET /api/rooms/:id/state — Get filtered game state. */
router.get('/rooms/:id/state', requireAuth, (req: Request, res: Response) => {
  const { roomId, seatIndex } = (req as AuthenticatedRequest).auth;

  if (roomId !== param(req, 'id')) {
    res.status(403).json({ error: 'Token does not match this room' });
    return;
  }

  const runner = getGameRunner(roomId);
  if (!runner) {
    res.status(400).json({ error: 'No game in progress' });
    return;
  }

  // Check for agent-friendly format
  const format = req.query.format;
  if (format === 'agent') {
    const validActions = runner.getValidActions(seatIndex);
    const agentState = buildAgentState(runner.state, seatIndex, validActions);
    res.json(agentState);
    return;
  }

  res.json(runner.getStateForPlayer(seatIndex));
});

/** POST /api/rooms/:id/action — Submit a player action. */
router.post('/rooms/:id/action', requireAuth, (req: Request, res: Response) => {
  const { roomId, seatIndex } = (req as AuthenticatedRequest).auth;

  if (roomId !== param(req, 'id')) {
    res.status(403).json({ error: 'Token does not match this room' });
    return;
  }

  const runner = getGameRunner(roomId);
  if (!runner) {
    res.status(400).json({ error: 'No game in progress' });
    return;
  }

  const { action } = req.body ?? {};
  if (!action || !action.type) {
    res.status(400).json({ error: 'Missing action in request body' });
    return;
  }

  const result = runner.submitAction(seatIndex, action);
  if (result.ok) {
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

/** GET /api/rooms/:id/events — SSE stream (auth required). */
router.get('/rooms/:id/events', requireAuth, (req: Request, res: Response) => {
  const { roomId } = (req as AuthenticatedRequest).auth;

  if (roomId !== param(req, 'id')) {
    res.status(403).json({ error: 'Token does not match this room' });
    return;
  }

  setupSSE(req, res);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeRoom(room: ReturnType<typeof getRoom>) {
  if (!room) return null;
  return {
    id: room.id,
    name: room.settings.name,
    settings: room.settings,
    seats: room.seats.map(s => ({ type: s.type, playerName: s.playerName })),
    status: room.status,
    playerCount: room.seats.filter(s => s.type === 'human' || s.type === 'agent').length,
  };
}
