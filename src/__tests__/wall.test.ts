import { describe, it, expect } from 'vitest';
import { dealGame, drawFromDeadWall } from '../wall';

describe('dealGame', () => {
  const game = dealGame();

  it('returns 4 players', () => {
    expect(game.players).toHaveLength(4);
  });

  it('seats are east, south, west, north', () => {
    expect(game.players.map(p => p.seat)).toEqual(['east', 'south', 'west', 'north']);
  });

  it('East (dealer) has 14 hand tiles', () => {
    expect(game.players[0].handTiles).toHaveLength(14);
  });

  it('non-dealer players have 13 hand tiles', () => {
    expect(game.players[1].handTiles).toHaveLength(13);
    expect(game.players[2].handTiles).toHaveLength(13);
    expect(game.players[3].handTiles).toHaveLength(13);
  });

  it('dead wall has 14 tiles', () => {
    expect(game.deadWall).toHaveLength(14);
  });

  it('total tiles across all locations equals 148', () => {
    const playerTiles = game.players.reduce(
      (sum, p) => sum + p.handTiles.length + p.bonusTiles.length, 0
    );
    const total = playerTiles + game.wall.length + game.deadWall.length;
    expect(total).toBe(148);
  });

  it('no bonus tiles remain in any player handTiles', () => {
    for (const player of game.players) {
      const bonusInHand = player.handTiles.filter(t => t.isBonus);
      expect(bonusInHand).toHaveLength(0);
    }
  });

  it('bonus tiles are in bonusTiles array', () => {
    const allBonus = game.players.flatMap(p => p.bonusTiles);
    for (const t of allBonus) {
      expect(t.isBonus).toBe(true);
    }
  });

  it('all tile IDs are unique', () => {
    const allTiles = [
      ...game.players.flatMap(p => [...p.handTiles, ...p.bonusTiles]),
      ...game.wall,
      ...game.deadWall,
    ];
    const ids = allTiles.map(t => t.id);
    expect(new Set(ids).size).toBe(148);
  });
});

describe('drawFromDeadWall', () => {
  it('draws a tile from the dead wall', () => {
    const deadWall = dealGame().deadWall;
    const initialLength = deadWall.length;
    const tile = drawFromDeadWall(deadWall);
    expect(tile).not.toBeNull();
    expect(deadWall).toHaveLength(initialLength - 1);
  });

  it('returns null when dead wall is empty', () => {
    const tile = drawFromDeadWall([]);
    expect(tile).toBeNull();
  });
});
