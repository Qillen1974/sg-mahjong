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
import { createSession, processRoundResult } from '../../src/game-session';
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

    // Create multi-round session
    const session = createSession({
      windRounds: room.settings.windRounds,
      payment: {
        base: room.settings.base,
        taiCap: room.settings.taiCap,
        shooterPays: room.settings.shooterPays,
      },
    });
    room.sessionState = session;

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
      // Round completed — process result into session
      if (room.sessionState && runner.state.result) {
        const { session: updated } = processRoundResult(room.sessionState, runner.state.result);
        room.sessionState = updated;
        console.log(`[API] Round complete in room ${roomId}. Session scores: ${updated.scores}, finished: ${updated.finished}`);

        if (updated.finished) {
          finishRoom(roomId);
          setTimeout(() => unregisterGameRunner(roomId), 60_000);
        } else if (room.settings.betweenRoundsTimeout > 0) {
          // Auto-finish if host doesn't start next round in time
          setTimeout(() => {
            if (room.status === 'playing' && room.sessionState && !room.sessionState.finished) {
              console.log(`[API] Between-rounds timeout in room ${roomId} — auto-finishing`);
              finishRoom(roomId);
              setTimeout(() => unregisterGameRunner(roomId), 60_000);
            }
          }, room.settings.betweenRoundsTimeout * 1000);
        }
        // If betweenRoundsTimeout is 0, keep runner registered indefinitely
        // so clients can poll the roundOver state and request nextRound at their own pace.
      } else {
        finishRoom(roomId);
        setTimeout(() => unregisterGameRunner(roomId), 60_000);
      }
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

/** POST /api/rooms/:id/nextRound — Start the next round (host only). */
router.post('/rooms/:id/nextRound', requireAuth, (req: Request, res: Response) => {
  const { roomId, seatIndex, isHost } = (req as AuthenticatedRequest).auth;

  if (roomId !== param(req, 'id')) {
    res.status(403).json({ error: 'Token does not match this room' });
    return;
  }

  if (!isHost) {
    res.status(403).json({ error: 'Only the host can start the next round' });
    return;
  }

  const room = getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  if (room.status !== 'playing') {
    res.status(400).json({ error: 'Room is not in playing state' });
    return;
  }

  if (!room.sessionState) {
    res.status(400).json({ error: 'No session in progress' });
    return;
  }

  if (room.sessionState.finished) {
    res.status(400).json({ error: 'Session is already finished' });
    return;
  }

  try {
    const broadcast = (seat: number, type: string, data: unknown) => {
      sendToSeat(roomId, seat, type, data);
      sendSSEToSeat(roomId, seat, type, data);
    };

    // Create new runner with updated dealer/wind from session state
    const runner = new GameRunner(
      room,
      broadcast,
      room.sessionState.dealerIndex,
      room.sessionState.prevailingWind,
    );
    registerGameRunner(roomId, runner);

    // Start the game loop asynchronously
    runner.run().then(() => {
      if (room.sessionState && runner.state.result) {
        const { session: updated } = processRoundResult(room.sessionState, runner.state.result);
        room.sessionState = updated;
        console.log(`[API] Round complete in room ${roomId}. Session scores: ${updated.scores}, finished: ${updated.finished}`);

        if (updated.finished) {
          finishRoom(roomId);
          setTimeout(() => unregisterGameRunner(roomId), 60_000);
        } else if (room.settings.betweenRoundsTimeout > 0) {
          setTimeout(() => {
            if (room.status === 'playing' && room.sessionState && !room.sessionState.finished) {
              console.log(`[API] Between-rounds timeout in room ${roomId} — auto-finishing`);
              finishRoom(roomId);
              setTimeout(() => unregisterGameRunner(roomId), 60_000);
            }
          }, room.settings.betweenRoundsTimeout * 1000);
        }
      } else {
        finishRoom(roomId);
        setTimeout(() => unregisterGameRunner(roomId), 60_000);
      }
    }).catch(err => {
      console.error(`Game error in room ${roomId}:`, err);
      finishRoom(roomId);
      setTimeout(() => unregisterGameRunner(roomId), 60_000);
    });

    res.json({ ok: true });
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

  const filtered = runner.getStateForPlayer(seatIndex);
  // Attach recent player messages for HTTP polling clients
  const msgs = runner.getRecentMessages();
  if (msgs.length > 0) filtered.recentMessages = msgs;
  res.json(filtered);
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
// AI Proxy (keeps API key server-side only)
// ---------------------------------------------------------------------------

const LLM_API_URL = 'https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions';
const LLM_MODEL = 'qwen3-coder-plus';
const LLM_API_KEY = process.env.LLM_API_KEY || '';

/** POST /api/ai-decision — Proxy AI decision through server to keep API key safe. */
router.post('/ai-decision', async (req: Request, res: Response) => {
  if (!LLM_API_KEY) {
    res.status(503).json({ error: 'LLM API key not configured' });
    return;
  }

  const { state, playerIndex, validActions } = req.body ?? {};
  if (!state || playerIndex === undefined || !validActions) {
    res.status(400).json({ error: 'Missing state, playerIndex, or validActions' });
    return;
  }

  try {
    // Import buildPrompt logic inline — build the same prompt the client would
    const player = state.players[playerIndex];
    const handStr = player.handTiles.map((t: any) => t.name).join(', ');
    const meldsStr = player.openMelds.length > 0
      ? player.openMelds.map((m: any) =>
          `${m.type}(${m.concealed ? 'concealed' : 'open'}): ${m.tiles.map((t: any) => t.name).join(', ')}`
        ).join('; ')
      : 'None';
    const bonusStr = player.bonusTiles.length > 0
      ? player.bonusTiles.map((t: any) => t.name).join(', ')
      : 'None';
    const discardsStr = state.players.map((p: any, i: number) => {
      const discards = p.discards.map((t: any) => t.name).join(', ');
      return `Player ${i} (${p.seat}): ${discards || 'none'}`;
    }).join('\n');
    const actionsStr = validActions.map((a: any, i: number) => {
      switch (a.type) {
        case 'discard': return `${i}: Discard ${a.tile.name}`;
        case 'declareKong': return `${i}: Declare concealed kong (${a.tiles.map((t: any) => t.name).join(', ')})`;
        case 'promotePungToKong': return `${i}: Promote pung to kong (${a.tile.name})`;
        case 'declareSelfWin': return `${i}: Declare self-drawn win (zi mo)`;
        case 'claimPong': return `${i}: Claim pong`;
        case 'claimChow': return `${i}: Claim chow (${a.chowTiles.map((t: any) => t.name).join(', ')})`;
        case 'claimKong': return `${i}: Claim kong`;
        case 'claimWin': return `${i}: Claim win`;
        case 'pass': return `${i}: Pass`;
      }
    }).join('\n');

    const messages = [
      {
        role: 'system',
        content: `You are a Singapore Mahjong AI player with a fun, competitive personality. You love to trash talk in Singlish/Singapore style.

Respond with ONLY a JSON object: {"action": <number>, "reasoning": "<brief explanation>", "trashtalk": "<short witty remark>"}

Rules for trashtalk:
- Keep it short (under 15 words), playful and funny
- Use Singlish flavour (lah, lor, wah, siao, alamak, etc.)
- React to the actual game situation (what you're discarding, claiming, or what opponents did)
- Sometimes taunt, sometimes bluff, sometimes be dramatic
- About 50% of the time, set trashtalk to null (don't overdo it)

The action number corresponds to one of the valid actions listed.`,
      },
      {
        role: 'user',
        content: `You are Player ${playerIndex} (${player.seat} wind).
Prevailing wind: ${state.prevailingWind}
Tiles remaining in wall: ${state.wall.length}

Your hand: ${handStr}
Your open melds: ${meldsStr}
Your bonus tiles: ${bonusStr}

Discards by all players:
${discardsStr}

Valid actions:
${actionsStr}

Choose the best action.`,
      },
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const llmRes = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({ model: LLM_MODEL, messages, temperature: 0.3 }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!llmRes.ok) {
      res.status(502).json({ error: 'LLM API error' });
      return;
    }

    const data = await llmRes.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      res.status(502).json({ error: 'Empty LLM response' });
      return;
    }

    // Strip <think> blocks
    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(502).json({ error: 'Could not parse LLM response' });
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const actionIndex = parseInt(parsed.action, 10);

    if (isNaN(actionIndex) || actionIndex < 0 || actionIndex >= validActions.length) {
      res.status(502).json({ error: 'Invalid action index from LLM' });
      return;
    }

    res.json({
      actionIndex,
      reasoning: parsed.reasoning || null,
      trashtalk: parsed.trashtalk || null,
    });
  } catch (e: any) {
    console.error('[AI Proxy] Error:', e.message);
    res.status(502).json({ error: 'AI proxy failed' });
  }
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
