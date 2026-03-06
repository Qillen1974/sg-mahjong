/** Server configuration constants. */

export const PORT = parseInt(process.env.PORT ?? '3001', 10);

/** How long players have to submit a claim (pong/kong/chow/win) in ms. */
export const CLAIM_TIMEOUT_MS = 8_000;

/** How long a player has to take their turn (draw/discard) in ms. 0 = no timeout. */
export const TURN_TIMEOUT_MS = 15_000;

/** Maximum concurrent rooms. */
export const MAX_ROOMS = 50;

/** SSE keepalive ping interval in ms. */
export const SSE_KEEPALIVE_MS = 30_000;

/** How often the lobby auto-refreshes room list in the client (advisory). */
export const LOBBY_REFRESH_MS = 5_000;

/** How long to wait for an agent LLM/webhook response before falling back. */
export const AGENT_TURN_TIMEOUT_MS = 60_000;

/** Max retries for agent LLM/webhook calls before falling back to heuristic AI. */
export const AGENT_MAX_RETRIES = 1;
