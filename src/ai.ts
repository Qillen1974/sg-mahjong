/**
 * AI Module for Singapore Mahjong
 *
 * Uses MiniMax 2.5 API for decisions with a rule-based fallback strategy.
 * Reads MINIMAX_API_KEY from environment. Falls back to basic strategy
 * if the API is unavailable or times out (5 seconds).
 */

import { Tile, tileKey, Wind } from './tiles';
import { GameState, PlayerAction } from './game-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIDecision {
  action: PlayerAction;
  reasoning?: string;
}

interface MiniMaxMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MiniMaxResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MINIMAX_API_URL = 'https://api.minimaxi.chat/v1/text/chatcompletion_v2';
const MINIMAX_MODEL = 'MiniMax-Text-02';
const API_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Main AI Function
// ---------------------------------------------------------------------------

/**
 * Get an AI decision for the given player.
 * Tries MiniMax API first, falls back to rule-based strategy.
 */
export async function getAIDecision(
  state: GameState,
  playerIndex: number,
  validActions: PlayerAction[],
): Promise<AIDecision> {
  if (validActions.length === 0) {
    throw new Error('No valid actions available');
  }
  if (validActions.length === 1) {
    return { action: validActions[0], reasoning: 'Only one option' };
  }

  // Try MiniMax API
  const apiKey = typeof process !== 'undefined' ? process.env?.MINIMAX_API_KEY : undefined;
  if (apiKey) {
    try {
      const apiResult = await callMiniMaxAPI(state, playerIndex, validActions, apiKey);
      if (apiResult) return apiResult;
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback to rule-based strategy
  return fallbackDecision(state, playerIndex, validActions);
}

// ---------------------------------------------------------------------------
// MiniMax API Integration
// ---------------------------------------------------------------------------

function buildPrompt(
  state: GameState,
  playerIndex: number,
  validActions: PlayerAction[],
): MiniMaxMessage[] {
  const player = state.players[playerIndex];
  const handStr = player.handTiles.map(t => t.name).join(', ');
  const meldsStr = player.openMelds.length > 0
    ? player.openMelds.map(m =>
        `${m.type}(${m.concealed ? 'concealed' : 'open'}): ${m.tiles.map(t => t.name).join(', ')}`
      ).join('; ')
    : 'None';
  const bonusStr = player.bonusTiles.length > 0
    ? player.bonusTiles.map(t => t.name).join(', ')
    : 'None';

  // Visible discards from all players
  const discardsStr = state.players.map((p, i) => {
    const discards = p.discards.map(t => t.name).join(', ');
    return `Player ${i} (${p.seat}): ${discards || 'none'}`;
  }).join('\n');

  const actionsStr = validActions.map((a, i) => {
    switch (a.type) {
      case 'discard': return `${i}: Discard ${a.tile.name}`;
      case 'declareKong': return `${i}: Declare concealed kong (${a.tiles.map(t => t.name).join(', ')})`;
      case 'promotePungToKong': return `${i}: Promote pung to kong (${a.tile.name})`;
      case 'declareSelfWin': return `${i}: Declare self-drawn win (zi mo)`;
      case 'claimPong': return `${i}: Claim pong`;
      case 'claimChow': return `${i}: Claim chow (${a.chowTiles.map(t => t.name).join(', ')})`;
      case 'claimKong': return `${i}: Claim kong`;
      case 'claimWin': return `${i}: Claim win`;
      case 'pass': return `${i}: Pass`;
    }
  }).join('\n');

  return [
    {
      role: 'system',
      content: `You are a Singapore Mahjong AI player. Respond with ONLY a JSON object: {"action": <number>, "reasoning": "<brief explanation>"}. The action number corresponds to one of the valid actions listed.`,
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
}

async function callMiniMaxAPI(
  state: GameState,
  playerIndex: number,
  validActions: PlayerAction[],
  apiKey: string,
): Promise<AIDecision | null> {
  const messages = buildPrompt(state, playerIndex, validActions);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        messages,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data: MiniMaxResponse = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    return parseAPIResponse(content, validActions);
  } finally {
    clearTimeout(timeout);
  }
}

function parseAPIResponse(
  content: string,
  validActions: PlayerAction[],
): AIDecision | null {
  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const actionIndex = parseInt(parsed.action, 10);

    if (isNaN(actionIndex) || actionIndex < 0 || actionIndex >= validActions.length) {
      return null;
    }

    return {
      action: validActions[actionIndex],
      reasoning: parsed.reasoning || 'MiniMax API decision',
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback Rule-Based Strategy
// ---------------------------------------------------------------------------

/**
 * Simple rule-based AI when the MiniMax API is unavailable.
 *
 * Priority:
 * 1. Always claim win if possible
 * 2. Declare self-win if possible
 * 3. Claim scoring melds (dragons, seat wind, prevailing wind)
 * 4. Declare kong if safe
 * 5. Discard: prefer isolated tiles, safe tiles (already discarded by others)
 * 6. Pass on non-scoring claims
 */
export function fallbackDecision(
  state: GameState,
  playerIndex: number,
  validActions: PlayerAction[],
): AIDecision {
  // 1. Always win if possible
  const winAction = validActions.find(a => a.type === 'claimWin' || a.type === 'declareSelfWin');
  if (winAction) {
    return { action: winAction, reasoning: 'Win available' };
  }

  // 2. Declare kong if available
  const kongAction = validActions.find(a => a.type === 'declareKong' || a.type === 'promotePungToKong');
  if (kongAction) {
    return { action: kongAction, reasoning: 'Kong available' };
  }

  // 3. Claim pong for scoring tiles (dragons, seat wind, prevailing wind)
  const pongAction = validActions.find(a => a.type === 'claimPong');
  if (pongAction && state.lastDiscard) {
    const tile = state.lastDiscard;
    const player = state.players[playerIndex];
    const isScoring =
      tile.suit === 'dragons' ||
      (tile.suit === 'winds' && (tile.value === player.seat || tile.value === state.prevailingWind));
    if (isScoring) {
      return { action: pongAction, reasoning: `Pong scoring tile: ${tile.name}` };
    }
  }

  // 4. Claim kong from discard for scoring tiles
  const claimKongAction = validActions.find(a => a.type === 'claimKong');
  if (claimKongAction && state.lastDiscard) {
    const tile = state.lastDiscard;
    const player = state.players[playerIndex];
    const isScoring =
      tile.suit === 'dragons' ||
      (tile.suit === 'winds' && (tile.value === player.seat || tile.value === state.prevailingWind));
    if (isScoring) {
      return { action: claimKongAction, reasoning: `Kong scoring tile: ${tile.name}` };
    }
  }

  // 5. Discard logic — find the best tile to discard
  const discardActions = validActions.filter(a => a.type === 'discard') as
    Array<{ type: 'discard'; tile: Tile }>;

  if (discardActions.length > 0) {
    const player = state.players[playerIndex];
    const bestDiscard = pickBestDiscard(state, player, discardActions);
    return bestDiscard;
  }

  // 6. Pass on anything else
  const passAction = validActions.find(a => a.type === 'pass');
  if (passAction) {
    return { action: passAction, reasoning: 'No advantageous claim' };
  }

  // Shouldn't reach here, but return first action as safety
  return { action: validActions[0], reasoning: 'Default action' };
}

/**
 * Pick the best tile to discard using a simple heuristic.
 * Prefer: isolated tiles > terminals/honors without pairs > tiles others discarded
 */
function pickBestDiscard(
  state: GameState,
  player: { handTiles: Tile[]; seat: Wind },
  discardActions: Array<{ type: 'discard'; tile: Tile }>,
): AIDecision {
  // Build discard safety map (tiles already discarded are safer to discard)
  const allDiscards = new Set<string>();
  for (const p of state.players) {
    for (const t of p.discards) {
      allDiscards.add(tileKey(t));
    }
  }

  // Count tiles by key in hand for isolation scoring
  const handCounts = new Map<string, number>();
  for (const t of player.handTiles) {
    const k = tileKey(t);
    handCounts.set(k, (handCounts.get(k) || 0) + 1);
  }

  // Score each discard option (lower = better to discard)
  const scored = discardActions.map(action => {
    const tile = action.tile;
    const key = tileKey(tile);
    let score = 0;

    const count = handCounts.get(key) || 0;

    // Pairs are more valuable, keep them
    if (count >= 2) score += 20;
    // Triplets are very valuable
    if (count >= 3) score += 40;

    // Scoring tiles are valuable — dragons, seat/prevailing wind
    if (tile.suit === 'dragons') score += 15;
    if (tile.suit === 'winds' && tile.value === player.seat) score += 15;
    if (tile.suit === 'winds' && tile.value === state.prevailingWind) score += 15;

    // Connected tiles (part of potential chow) are valuable
    if (tile.suit === 'bamboo' || tile.suit === 'dots' || tile.suit === 'characters') {
      const val = tile.value as number;
      const suit = tile.suit;
      for (const offset of [-2, -1, 1, 2]) {
        const neighbor = `${suit}_${val + offset}`;
        if (handCounts.has(neighbor)) score += 5;
      }
    }

    // Tiles already discarded by others are safer to discard
    if (allDiscards.has(key)) score -= 3;

    // Isolated honor tiles without a pair are less useful
    if (tile.isHonor && count === 1) score -= 5;

    // Terminal tiles are less flexible than middle tiles
    if (tile.isTerminal) score -= 2;

    return { action, score };
  });

  // Sort ascending — lowest score = best to discard
  scored.sort((a, b) => a.score - b.score);

  const best = scored[0];
  return {
    action: best.action,
    reasoning: `Discard ${best.action.tile.name} (score: ${best.score})`,
  };
}
