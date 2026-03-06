/**
 * AI Module for Singapore Mahjong
 *
 * Uses Qwen 3 Coder Plus (Bailian) for decisions with a rule-based fallback strategy.
 * Reads LLM_API_KEY from environment. Falls back to strategy
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
  trashtalk?: string;
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LLM_API_URL = 'https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions';
const LLM_MODEL = 'qwen3-coder-plus';
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

  // Try LLM API — check Vite env (browser) then Node env (tests)
  const apiKey =
    import.meta.env.VITE_LLM_API_KEY ||
    (typeof process !== 'undefined' && process.env?.LLM_API_KEY) ||
    undefined;
  if (apiKey) {
    try {
      const apiResult = await callLLMAPI(state, playerIndex, validActions, apiKey);
      if (apiResult) return apiResult;
      console.warn(`[AI] LLM returned no usable result for player ${playerIndex}, using fallback`);
    } catch (e) {
      console.warn(`[AI] LLM API error for player ${playerIndex}:`, e);
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
): LLMMessage[] {
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
}

async function callLLMAPI(
  state: GameState,
  playerIndex: number,
  validActions: PlayerAction[],
  apiKey: string,
): Promise<AIDecision | null> {
  const messages = buildPrompt(state, playerIndex, validActions);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data: LLMResponse = await response.json();
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
      reasoning: parsed.reasoning || 'LLM API decision',
      trashtalk: parsed.trashtalk || undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback Rule-Based Strategy
// ---------------------------------------------------------------------------

/** Count tiles in hand by tileKey. */
function countHand(handTiles: Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of handTiles) {
    const k = tileKey(t);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

/** Check if a suit is numbered (can form chows). */
function isNumberedSuit(suit: string): boolean {
  return suit === 'bamboo' || suit === 'dots' || suit === 'characters';
}

/**
 * Count how many "groups" (pairs, triplets, sequential connections) a tile
 * participates in. Higher = more useful to keep.
 */
function tileUsefulness(
  tile: Tile,
  counts: Map<string, number>,
  seatWind: Wind,
  prevailingWind: Wind,
): number {
  const key = tileKey(tile);
  const count = counts.get(key) || 0;
  let score = 0;

  // Pair or triplet
  if (count >= 3) score += 60; // keep triplets
  if (count === 2) score += 25; // keep pairs

  // Scoring honors are extra valuable
  if (tile.suit === 'dragons') score += 12;
  if (tile.suit === 'winds' && tile.value === seatWind) score += 12;
  if (tile.suit === 'winds' && tile.value === prevailingWind) score += 12;

  // Sequential connections for numbered suits
  if (isNumberedSuit(tile.suit)) {
    const val = tile.value as number;
    const s = tile.suit;
    // Adjacent tiles (1 away) — strong connection
    if (counts.has(`${s}_${val - 1}`)) score += 10;
    if (counts.has(`${s}_${val + 1}`)) score += 10;
    // Gap tiles (2 away) — weaker connection
    if (counts.has(`${s}_${val - 2}`)) score += 4;
    if (counts.has(`${s}_${val + 2}`)) score += 4;
  }

  return score;
}

/**
 * Evaluate how much claiming a meld improves the hand.
 * Returns true if the claim is worthwhile.
 */
function shouldClaimMeld(
  state: GameState,
  playerIndex: number,
  meldType: 'pong' | 'chow',
): boolean {
  const player = state.players[playerIndex];
  const tile = state.lastDiscard!;
  const counts = countHand(player.handTiles);

  // How many complete groups (melds) does the player already have?
  const existingMelds = player.openMelds.length;

  // Count pairs and near-complete groups in hand
  let pairs = 0;
  let triplets = 0;
  let sequences = 0;
  const visited = new Set<string>();

  for (const [key, count] of counts) {
    if (count >= 3) triplets++;
    else if (count >= 2) pairs++;
  }

  // Count sequential pairs in numbered suits
  for (const t of player.handTiles) {
    if (!isNumberedSuit(t.suit)) continue;
    const val = t.value as number;
    const adjKey = `${t.suit}_${val + 1}`;
    const pairKey = `${tileKey(t)}-${adjKey}`;
    if (!visited.has(pairKey) && counts.has(adjKey)) {
      sequences++;
      visited.add(pairKey);
    }
  }

  const totalGroups = existingMelds + triplets + sequences;

  // Need 4 melds + 1 pair to win
  // Claim if it helps us get closer
  if (meldType === 'pong') {
    // Pong is almost always good — it completes a meld from a pair
    const hasMatchingPair = (counts.get(tileKey(tile)) || 0) >= 2;
    if (hasMatchingPair) return true; // completing a triplet

    // Even if we just have 1 matching tile, claim if we're close to winning
    return totalGroups >= 2;
  }

  if (meldType === 'chow') {
    // Chow completes a sequence — good if we're building toward winning
    // Be more selective early (need more groups), aggressive when close
    return totalGroups >= 2;
  }

  return false;
}

/**
 * Improved rule-based AI strategy.
 *
 * Priority:
 * 1. Always claim win if possible
 * 2. Declare self-win if possible
 * 3. Declare kong / promote pung to kong
 * 4. Claim pong when it helps the hand
 * 5. Claim chow when it helps the hand
 * 6. Smart discard selection
 * 7. Pass on unhelpful claims
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

  // 2. Declare kong / promote pung if available
  const kongAction = validActions.find(a => a.type === 'declareKong' || a.type === 'promotePungToKong');
  if (kongAction) {
    return { action: kongAction, reasoning: 'Kong available' };
  }

  // 3. Claim kong from discard
  const claimKongAction = validActions.find(a => a.type === 'claimKong');
  if (claimKongAction) {
    return { action: claimKongAction, reasoning: 'Claim kong' };
  }

  // 4. Claim pong — always good (completes a meld)
  const pongAction = validActions.find(a => a.type === 'claimPong');
  if (pongAction && shouldClaimMeld(state, playerIndex, 'pong')) {
    return { action: pongAction, reasoning: `Pong ${state.lastDiscard?.name}` };
  }

  // 5. Claim chow — good when building toward a win
  const chowActions = validActions.filter(a => a.type === 'claimChow') as
    Array<{ type: 'claimChow'; chowTiles: [Tile, Tile] }>;
  if (chowActions.length > 0 && shouldClaimMeld(state, playerIndex, 'chow')) {
    // Pick the chow that keeps the most useful tiles
    const player = state.players[playerIndex];
    const counts = countHand(player.handTiles);
    let bestChow = chowActions[0];
    let bestScore = -Infinity;

    for (const chow of chowActions) {
      // Score: usefulness of the tiles we'd keep after claiming
      const usedKeys = new Set(chow.chowTiles.map(t => t.id));
      let score = 0;
      for (const t of player.handTiles) {
        if (!usedKeys.has(t.id)) {
          score += tileUsefulness(t, counts, player.seat, state.prevailingWind);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestChow = chow;
      }
    }
    return { action: bestChow, reasoning: `Chow with ${bestChow.chowTiles.map(t => t.name).join(' + ')}` };
  }

  // 6. Discard logic — smart tile selection
  const discardActions = validActions.filter(a => a.type === 'discard') as
    Array<{ type: 'discard'; tile: Tile }>;

  if (discardActions.length > 0) {
    return pickBestDiscard(state, playerIndex, discardActions);
  }

  // 7. Pass on anything else
  const passAction = validActions.find(a => a.type === 'pass');
  if (passAction) {
    return { action: passAction, reasoning: 'No advantageous claim' };
  }

  return { action: validActions[0], reasoning: 'Default action' };
}

/**
 * Pick the best tile to discard.
 * Keeps tiles that form groups (pairs, triplets, sequences).
 * Discards isolated tiles, preferring safe ones (already discarded by others).
 */
function pickBestDiscard(
  state: GameState,
  playerIndex: number,
  discardActions: Array<{ type: 'discard'; tile: Tile }>,
): AIDecision {
  const player = state.players[playerIndex];
  const counts = countHand(player.handTiles);

  // Build discard safety map (tiles others discarded are safer)
  const allDiscards = new Map<string, number>();
  for (const p of state.players) {
    for (const t of p.discards) {
      const k = tileKey(t);
      allDiscards.set(k, (allDiscards.get(k) || 0) + 1);
    }
  }

  // Score each tile: higher = more useful to keep (= worse to discard)
  const scored = discardActions.map(action => {
    const tile = action.tile;
    const key = tileKey(tile);

    let keepScore = tileUsefulness(tile, counts, player.seat, state.prevailingWind);

    // Safety bonus: tiles already seen are safer to discard
    const discardCount = allDiscards.get(key) || 0;
    if (discardCount > 0) keepScore -= 6 * discardCount;

    // Terminals are slightly less flexible
    if (tile.isTerminal) keepScore -= 2;

    // Isolated honor tiles without a pair are low value
    if (tile.isHonor && (counts.get(key) || 0) === 1) {
      const isScoringHonor =
        tile.suit === 'dragons' ||
        (tile.suit === 'winds' && (tile.value === player.seat || tile.value === state.prevailingWind));
      if (!isScoringHonor) keepScore -= 8;
    }

    return { action, keepScore };
  });

  // Sort ascending by keepScore — lowest = best to discard
  scored.sort((a, b) => a.keepScore - b.keepScore);

  const best = scored[0];
  return {
    action: best.action,
    reasoning: `Discard ${best.action.tile.name} (keep=${best.keepScore})`,
  };
}
