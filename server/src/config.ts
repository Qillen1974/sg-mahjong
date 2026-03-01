/** Server configuration constants. */

export const PORT = parseInt(process.env.PORT ?? '3001', 10);

/** How long players have to submit a claim (pong/kong/chow/win) in ms. */
export const CLAIM_TIMEOUT_MS = 30_000;

/** How long a player has to take their turn (draw/discard) in ms. */
export const TURN_TIMEOUT_MS = 120_000;

/** Maximum concurrent rooms. */
export const MAX_ROOMS = 50;

/** SSE keepalive ping interval in ms. */
export const SSE_KEEPALIVE_MS = 30_000;

/** How often the lobby auto-refreshes room list in the client (advisory). */
export const LOBBY_REFRESH_MS = 5_000;
