import { describe, it, expect, afterEach } from 'vitest';
import {
  createRoom,
  getRoom,
  listRooms,
  joinRoom,
  leaveRoom,
  startRoom,
  finishRoom,
  deleteRoom,
  roomCount,
} from '../room-manager';

// Track created room IDs for cleanup
const createdRoomIds: string[] = [];

function createTrackedRoom(...args: Parameters<typeof createRoom>) {
  const result = createRoom(...args);
  createdRoomIds.push(result.room.id);
  return result;
}

afterEach(() => {
  for (const id of createdRoomIds) {
    deleteRoom(id);
  }
  createdRoomIds.length = 0;
});

describe('createRoom', () => {
  it('returns room with correct defaults', () => {
    const { room, seatIndex } = createTrackedRoom();

    expect(seatIndex).toBe(0);
    expect(room.status).toBe('waiting');
    expect(room.hostSeatIndex).toBe(0);
    expect(room.seats[0].type).toBe('human');
    expect(room.seats[0].playerName).toBe('Host');
    expect(room.seats[1].type).toBe('empty');
    expect(room.seats[2].type).toBe('empty');
    expect(room.seats[3].type).toBe('empty');
  });

  it('assigns unique IDs', () => {
    const r1 = createTrackedRoom();
    const r2 = createTrackedRoom();
    expect(r1.room.id).not.toBe(r2.room.id);
  });

  it('applies custom settings', () => {
    const { room } = createTrackedRoom({ name: 'My Room', base: 0.50 }, 'Alice');
    expect(room.settings.name).toBe('My Room');
    expect(room.settings.base).toBe(0.50);
    expect(room.seats[0].playerName).toBe('Alice');
  });
});

describe('getRoom', () => {
  it('returns created room', () => {
    const { room } = createTrackedRoom();
    expect(getRoom(room.id)).toBe(room);
  });

  it('returns undefined for missing room', () => {
    expect(getRoom('nonexistent')).toBeUndefined();
  });
});

describe('listRooms', () => {
  it('returns all rooms', () => {
    const r1 = createTrackedRoom();
    const r2 = createTrackedRoom();
    const rooms = listRooms();
    const ids = rooms.map(r => r.id);
    expect(ids).toContain(r1.room.id);
    expect(ids).toContain(r2.room.id);
  });
});

describe('joinRoom', () => {
  it('assigns next empty seat', () => {
    const { room } = createTrackedRoom();
    const { seatIndex } = joinRoom(room.id, 'Bob');

    expect(seatIndex).toBe(1);
    expect(room.seats[1].type).toBe('human');
    expect(room.seats[1].playerName).toBe('Bob');
  });

  it('fills seats sequentially', () => {
    const { room } = createTrackedRoom();
    joinRoom(room.id, 'P2');
    joinRoom(room.id, 'P3');
    const { seatIndex } = joinRoom(room.id, 'P4');

    expect(seatIndex).toBe(3);
  });

  it('fails on full room', () => {
    const { room } = createTrackedRoom();
    joinRoom(room.id, 'P2');
    joinRoom(room.id, 'P3');
    joinRoom(room.id, 'P4');

    expect(() => joinRoom(room.id, 'P5')).toThrow('Room is full');
  });

  it('fails on non-waiting room', () => {
    const { room } = createTrackedRoom();
    startRoom(room.id, 0);

    expect(() => joinRoom(room.id, 'Late')).toThrow('not accepting');
  });
});

describe('leaveRoom', () => {
  it('frees the seat', () => {
    const { room } = createTrackedRoom();
    joinRoom(room.id, 'Bob');
    leaveRoom(room.id, 1);

    expect(room.seats[1].type).toBe('empty');
    expect(room.seats[1].playerName).toBeNull();
  });

  it('deletes room when all seats become empty', () => {
    const { room } = createTrackedRoom();
    leaveRoom(room.id, 0);

    expect(getRoom(room.id)).toBeUndefined();
  });
});

describe('startRoom', () => {
  it('fills empty seats with ai-standby', () => {
    const { room } = createTrackedRoom();
    startRoom(room.id, 0);

    expect(room.seats[0].type).toBe('human');
    expect(room.seats[1].type).toBe('ai-standby');
    expect(room.seats[2].type).toBe('ai-standby');
    expect(room.seats[3].type).toBe('ai-standby');
  });

  it('fails if not host', () => {
    const { room } = createTrackedRoom();
    joinRoom(room.id, 'Bob');

    expect(() => startRoom(room.id, 1)).toThrow('Only the host');
  });

  it('transitions status to playing', () => {
    const { room } = createTrackedRoom();
    startRoom(room.id, 0);

    expect(room.status).toBe('playing');
  });

  it('fails if room already started', () => {
    const { room } = createTrackedRoom();
    startRoom(room.id, 0);

    expect(() => startRoom(room.id, 0)).toThrow('already started');
  });
});

describe('finishRoom', () => {
  it('transitions status to finished', () => {
    const { room } = createTrackedRoom();
    startRoom(room.id, 0);
    finishRoom(room.id);

    expect(room.status).toBe('finished');
  });
});

describe('roomCount', () => {
  it('returns correct count', () => {
    const before = roomCount();
    createTrackedRoom();
    createTrackedRoom();

    expect(roomCount()).toBe(before + 2);
  });
});
