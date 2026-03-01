import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createToken,
  validateToken,
  revokeToken,
  revokeRoomTokens,
  findToken,
  requireAuth,
} from '../auth';

// Clean up all tokens between tests (auth uses module-level Map)
afterEach(() => {
  revokeRoomTokens('room-a');
  revokeRoomTokens('room-b');
  revokeRoomTokens('test-room');
});

describe('createToken', () => {
  it('returns a UUID string', () => {
    const token = createToken('room-a', 0, true);
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('validateToken', () => {
  it('returns TokenInfo for a valid token', () => {
    const token = createToken('room-a', 2, false);
    const info = validateToken(token);
    expect(info).toEqual({ roomId: 'room-a', seatIndex: 2, isHost: false });
  });

  it('returns undefined for an invalid token', () => {
    expect(validateToken('not-a-real-token')).toBeUndefined();
  });
});

describe('revokeToken', () => {
  it('removes a specific token', () => {
    const token = createToken('room-a', 0, true);
    revokeToken(token);
    expect(validateToken(token)).toBeUndefined();
  });
});

describe('revokeRoomTokens', () => {
  it('removes all tokens for a room', () => {
    const t1 = createToken('room-a', 0, true);
    const t2 = createToken('room-a', 1, false);
    const t3 = createToken('room-b', 0, true);

    revokeRoomTokens('room-a');

    expect(validateToken(t1)).toBeUndefined();
    expect(validateToken(t2)).toBeUndefined();
    // room-b token should survive
    expect(validateToken(t3)).toBeDefined();
  });
});

describe('findToken', () => {
  it('locates token by roomId + seatIndex', () => {
    const token = createToken('room-a', 3, false);
    expect(findToken('room-a', 3)).toBe(token);
  });

  it('returns undefined when no match', () => {
    createToken('room-a', 0, true);
    expect(findToken('room-a', 2)).toBeUndefined();
  });
});

describe('requireAuth middleware', () => {
  function mockReqResNext(authHeader?: string) {
    const req = { headers: { authorization: authHeader } } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;
    const next = vi.fn();
    return { req, res, next };
  }

  it('sets req.auth on valid Bearer token', () => {
    const token = createToken('test-room', 1, false);
    const { req, res, next } = mockReqResNext(`Bearer ${token}`);

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.auth).toEqual({ roomId: 'test-room', seatIndex: 1, isHost: false });
    expect(req.token).toBe(token);
  });

  it('returns 401 on missing Authorization header', () => {
    const { req, res, next } = mockReqResNext(undefined);

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing Authorization header' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 on invalid token', () => {
    const { req, res, next } = mockReqResNext('Bearer invalid-token-value');

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });
});
