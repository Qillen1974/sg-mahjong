/**
 * Token-based authentication for game server.
 *
 * Each player receives a UUID token when they create or join a room.
 * The token maps to a (roomId, seatIndex) pair. Tokens are revoked
 * when a player leaves or the room is destroyed.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

export interface TokenInfo {
  roomId: string;
  seatIndex: number;
  isHost: boolean;
}

const tokens = new Map<string, TokenInfo>();

/** Generate a new auth token for a player seat. */
export function createToken(roomId: string, seatIndex: number, isHost: boolean): string {
  const token = uuidv4();
  tokens.set(token, { roomId, seatIndex, isHost });
  return token;
}

/** Look up a token. Returns undefined if invalid/revoked. */
export function validateToken(token: string): TokenInfo | undefined {
  return tokens.get(token);
}

/** Revoke a single token. */
export function revokeToken(token: string): void {
  tokens.delete(token);
}

/** Revoke all tokens for a room (e.g., when room is destroyed). */
export function revokeRoomTokens(roomId: string): void {
  for (const [token, info] of tokens) {
    if (info.roomId === roomId) {
      tokens.delete(token);
    }
  }
}

/** Find the token string for a given room + seat (for cleanup). */
export function findToken(roomId: string, seatIndex: number): string | undefined {
  for (const [token, info] of tokens) {
    if (info.roomId === roomId && info.seatIndex === seatIndex) {
      return token;
    }
  }
  return undefined;
}

/**
 * Express middleware: extracts Bearer token from Authorization header
 * and attaches TokenInfo to `req.auth`. Responds 401 if missing/invalid.
 */
export interface AuthenticatedRequest extends Request {
  auth: TokenInfo;
  token: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const token = header.slice(7);
  const info = validateToken(token);
  if (!info) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  (req as AuthenticatedRequest).auth = info;
  (req as AuthenticatedRequest).token = token;
  next();
}
