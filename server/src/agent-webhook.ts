/**
 * Agent Turn Handler — LLM calls and webhook support for agent players.
 *
 * Two modes:
 * 1. Built-in LLM brain — server calls an OpenAI-compatible API directly.
 * 2. Webhook callback — server POSTs game state, expects action in response.
 */

import type { GameState, PlayerAction } from '../../src/game-types';
import type { AgentFriendlyState } from './state-filter.js';
import { buildAgentState } from './state-filter.js';
import { getValidActions } from '../../src/game';
import { AGENT_TURN_TIMEOUT_MS, AGENT_MAX_RETRIES } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentLLMConfig {
  /** OpenAI-compatible API base URL (e.g. https://api.minimax.chat/v1/chat/completions). */
  endpoint: string;
  apiKey: string;
  model: string;
  temperature?: number;
}

export interface AgentConfig {
  /** External webhook URL — server POSTs state, expects action in response. */
  webhookUrl?: string;
  /** Built-in LLM config — server calls the LLM directly. */
  llm?: AgentLLMConfig;
  /** Timeout in ms for LLM/webhook response. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Main Entry
// ---------------------------------------------------------------------------

/**
 * Handle an agent's turn. Calls LLM or webhook, returns the chosen action.
 * Throws on failure (caller should fall back to heuristic AI).
 */
export async function handleAgentTurn(
  state: GameState,
  seatIndex: number,
  validActions: PlayerAction[],
  config: AgentConfig,
): Promise<PlayerAction> {
  const timeout = config.timeoutMs ?? AGENT_TURN_TIMEOUT_MS;
  const agentState = buildAgentState(state, seatIndex, validActions);

  for (let attempt = 0; attempt <= AGENT_MAX_RETRIES; attempt++) {
    try {
      let action: PlayerAction | null = null;

      if (config.llm) {
        action = await callLLM(config.llm, agentState, validActions, timeout);
      } else if (config.webhookUrl) {
        action = await callWebhook(config.webhookUrl, agentState, validActions, timeout);
      }

      if (action) return action;
      console.warn(`[AgentTurn] Attempt ${attempt + 1}: no valid action returned`);
    } catch (err) {
      console.warn(`[AgentTurn] Attempt ${attempt + 1} failed:`, err);
    }
  }

  throw new Error('Agent failed to produce a valid action after retries');
}

// ---------------------------------------------------------------------------
// LLM Integration (OpenAI-compatible)
// ---------------------------------------------------------------------------

async function callLLM(
  llm: AgentLLMConfig,
  agentState: AgentFriendlyState,
  validActions: PlayerAction[],
  timeoutMs: number,
): Promise<PlayerAction | null> {
  const messages = buildPrompt(agentState, validActions);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(llm.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.model,
        messages,
        temperature: llm.temperature ?? 0.3,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`LLM API returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      console.warn('[AgentTurn] LLM returned empty content');
      return null;
    }

    // Strip <think>...</think> blocks (MiniMax M2.1 chain-of-thought)
    const content = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!content) {
      console.warn(`[AgentTurn] LLM response was only <think> block (${rawContent.length} chars)`);
      return null;
    }

    return parseActionFromLLM(content, validActions);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Prompt Engineering
// ---------------------------------------------------------------------------

function buildPrompt(
  agentState: AgentFriendlyState,
  validActions: PlayerAction[],
): Array<{ role: 'system' | 'user'; content: string }> {
  const actionsStr = validActions.map((a, i) => {
    switch (a.type) {
      case 'discard': return `  ${i}: Discard ${(a as any).tile.name}`;
      case 'declareKong': return `  ${i}: Declare concealed kong (${(a as any).tiles.map((t: any) => t.name).join(', ')})`;
      case 'promotePungToKong': return `  ${i}: Promote pung to kong (${(a as any).tile.name})`;
      case 'declareSelfWin': return `  ${i}: Declare self-drawn win (zi mo)`;
      case 'claimPong': return `  ${i}: Claim pong`;
      case 'claimChow': return `  ${i}: Claim chow (${(a as any).chowTiles.map((t: any) => t.name).join(', ')})`;
      case 'claimKong': return `  ${i}: Claim kong`;
      case 'claimWin': return `  ${i}: Claim win`;
      case 'pass': return `  ${i}: Pass`;
    }
  }).join('\n');

  const otherPlayersStr = agentState.otherPlayers.map(p => {
    const melds = p.openMelds.length > 0
      ? p.openMelds.map(m => `${m.type}(${m.tiles.map((t: any) => t.name).join(', ')})`).join('; ')
      : 'none';
    return `  ${p.seat} (seat ${p.seatIndex}): ${p.handCount} tiles, discards=[${p.discards.join(', ')}], melds=[${melds}]`;
  }).join('\n');

  return [
    {
      role: 'system',
      content: `You are a Singapore Mahjong AI. Pick the best action. Be BRIEF — do not think step by step.

Rules: Win > Kong > Pong > Chow > Discard isolated tiles > Pass.
Keep pairs, triplets, sequences. Discard isolated tiles. Honor tiles (dragons, seat/prevailing wind) are valuable.

Respond with ONLY: {"action": <number>, "reasoning": "<5 words max>"}`,
    },
    {
      role: 'user',
      content: `You are seat ${agentState.yourSeat} (${agentState.yourSeatWind} wind).
Phase: ${agentState.phase}
Turn: ${agentState.turnNumber}
Prevailing wind: ${agentState.prevailingWind}
Dealer: seat ${agentState.dealerIndex}
Wall remaining: ${agentState.wallRemaining} tiles
Last discard: ${agentState.lastDiscard ?? 'none'}${agentState.lastDiscardedBy !== null ? ` (by seat ${agentState.lastDiscardedBy})` : ''}

Your hand: ${agentState.yourHand.join(', ')}
Your open melds: ${agentState.yourOpenMelds.length > 0 ? agentState.yourOpenMelds.map(m => `${m.type}(${m.tiles.map((t: any) => t.name).join(', ')})`).join('; ') : 'none'}
Your bonus tiles: ${agentState.yourBonusTiles.length > 0 ? agentState.yourBonusTiles.join(', ') : 'none'}

Other players:
${otherPlayersStr}

Valid actions:
${actionsStr}

Choose the best action.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function parseActionFromLLM(
  content: string,
  validActions: PlayerAction[],
): PlayerAction | null {
  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const actionIndex = parseInt(parsed.action, 10);

    if (isNaN(actionIndex) || actionIndex < 0 || actionIndex >= validActions.length) {
      console.warn(`[AgentTurn] LLM returned invalid action index: ${parsed.action}`);
      return null;
    }

    console.log(`[AgentTurn] LLM chose action ${actionIndex}: ${validActions[actionIndex].type} — ${parsed.reasoning || ''}`);
    return validActions[actionIndex];
  } catch (err) {
    console.warn('[AgentTurn] Failed to parse LLM response:', content.slice(0, 200));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Webhook Integration
// ---------------------------------------------------------------------------

async function callWebhook(
  webhookUrl: string,
  agentState: AgentFriendlyState,
  validActions: PlayerAction[],
  timeoutMs: number,
): Promise<PlayerAction | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: agentState,
        validActions,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }

    const data = await response.json() as { action?: PlayerAction | number };

    // Accept action as index or as full PlayerAction object
    if (typeof data.action === 'number') {
      const idx = data.action;
      if (idx < 0 || idx >= validActions.length) return null;
      return validActions[idx];
    }

    if (data.action && typeof data.action === 'object' && 'type' in data.action) {
      // Validate it matches a valid action
      const submitted = data.action;
      const match = validActions.find(va => va.type === submitted.type);
      if (match) return match;
    }

    return null;
  } finally {
    clearTimeout(timer);
  }
}
