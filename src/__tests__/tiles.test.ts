import { describe, it, expect } from 'vitest';
import {
  createAllTiles,
  ALL_TILES,
  TILE_COUNTS,
  tilesMatch,
  tileKey,
  Tile,
} from '../tiles';

describe('createAllTiles', () => {
  const tiles = createAllTiles();

  it('returns exactly 148 tiles', () => {
    expect(tiles).toHaveLength(148);
  });

  it('matches ALL_TILES constant', () => {
    expect(ALL_TILES).toHaveLength(148);
  });

  it('has 36 bamboo tiles', () => {
    expect(tiles.filter(t => t.suit === 'bamboo')).toHaveLength(TILE_COUNTS.bamboo);
  });

  it('has 36 dots tiles', () => {
    expect(tiles.filter(t => t.suit === 'dots')).toHaveLength(TILE_COUNTS.dots);
  });

  it('has 36 characters tiles', () => {
    expect(tiles.filter(t => t.suit === 'characters')).toHaveLength(TILE_COUNTS.characters);
  });

  it('has 16 wind tiles', () => {
    expect(tiles.filter(t => t.suit === 'winds')).toHaveLength(TILE_COUNTS.winds);
  });

  it('has 12 dragon tiles', () => {
    expect(tiles.filter(t => t.suit === 'dragons')).toHaveLength(TILE_COUNTS.dragons);
  });

  it('has 4 flower tiles', () => {
    expect(tiles.filter(t => t.suit === 'flowers')).toHaveLength(TILE_COUNTS.flowers);
  });

  it('has 4 season tiles', () => {
    expect(tiles.filter(t => t.suit === 'seasons')).toHaveLength(TILE_COUNTS.seasons);
  });

  it('has 4 animal tiles', () => {
    expect(tiles.filter(t => t.suit === 'animals')).toHaveLength(TILE_COUNTS.animals);
  });
});

describe('tile flags', () => {
  const tiles = createAllTiles();

  it('isTerminal is true only for 1s and 9s', () => {
    const terminals = tiles.filter(t => t.isTerminal);
    expect(terminals.every(t => t.value === 1 || t.value === 9)).toBe(true);
    // 3 suits x 2 terminals x 4 copies = 24
    expect(terminals).toHaveLength(24);
  });

  it('isHonor is true only for winds and dragons', () => {
    const honors = tiles.filter(t => t.isHonor);
    expect(honors.every(t => t.suit === 'winds' || t.suit === 'dragons')).toBe(true);
    expect(honors).toHaveLength(28); // 16 winds + 12 dragons
  });

  it('isBonus is true only for flowers, seasons, and animals', () => {
    const bonus = tiles.filter(t => t.isBonus);
    expect(bonus.every(t => t.suit === 'flowers' || t.suit === 'seasons' || t.suit === 'animals')).toBe(true);
    expect(bonus).toHaveLength(12); // 4 + 4 + 4
  });
});

describe('tilesMatch', () => {
  const tiles = createAllTiles();

  it('returns true for tiles with same suit and value', () => {
    const bamboo1s = tiles.filter(t => t.suit === 'bamboo' && t.value === 1);
    expect(bamboo1s.length).toBeGreaterThanOrEqual(2);
    expect(tilesMatch(bamboo1s[0], bamboo1s[1])).toBe(true);
  });

  it('returns false for tiles with different suit or value', () => {
    const bamboo1 = tiles.find(t => t.suit === 'bamboo' && t.value === 1)!;
    const dots1 = tiles.find(t => t.suit === 'dots' && t.value === 1)!;
    const bamboo2 = tiles.find(t => t.suit === 'bamboo' && t.value === 2)!;
    expect(tilesMatch(bamboo1, dots1)).toBe(false);
    expect(tilesMatch(bamboo1, bamboo2)).toBe(false);
  });
});

describe('tileKey', () => {
  it('returns correct format for numbered tiles', () => {
    const tile = { suit: 'bamboo', value: 1 } as Tile;
    expect(tileKey(tile)).toBe('bamboo_1');
  });

  it('returns correct format for honor tiles', () => {
    const tile = { suit: 'winds', value: 'east' } as Tile;
    expect(tileKey(tile)).toBe('winds_east');
  });

  it('returns correct format for bonus tiles', () => {
    const tile = { suit: 'flowers', value: 'plum' } as Tile;
    expect(tileKey(tile)).toBe('flowers_plum');
  });
});
