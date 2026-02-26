import { describe, it, expect } from 'vitest';
import { parseHand, isWinningHand } from '../hand-parser';
import { createAllTiles, Tile, TileNumber, NumberedSuit, Wind, Dragon } from '../tiles';

// Helper to create a numbered tile quickly
function nt(suit: NumberedSuit, value: TileNumber): Tile {
  return {
    id: `${suit}_${value}_1`,
    suit,
    value,
    name: `${suit} ${value}`,
    isBonus: false,
    isHonor: false,
    isTerminal: value === 1 || value === 9,
  };
}

function honor(suit: 'winds' | 'dragons', value: Wind | Dragon): Tile {
  return {
    id: `${suit}_${value}_1`,
    suit,
    value,
    name: `${value}`,
    isBonus: false,
    isHonor: true,
    isTerminal: false,
  };
}

function bonus(): Tile {
  return {
    id: 'flowers_plum',
    suit: 'flowers',
    value: 'plum' as any,
    name: 'Plum',
    isBonus: true,
    isHonor: false,
    isTerminal: false,
  };
}

describe('parseHand - validation', () => {
  it('rejects hands with fewer than 14 tiles', () => {
    const tiles = Array(13).fill(null).map(() => nt('bamboo', 1));
    const result = parseHand(tiles);
    expect(result.valid).toBe(false);
  });

  it('rejects hands with more than 14 tiles', () => {
    const tiles = Array(15).fill(null).map(() => nt('bamboo', 1));
    const result = parseHand(tiles);
    expect(result.valid).toBe(false);
  });

  it('rejects hands containing bonus tiles', () => {
    const tiles = Array(13).fill(null).map(() => nt('bamboo', 1));
    tiles.push(bonus());
    const result = parseHand(tiles);
    expect(result.valid).toBe(false);
  });
});

describe('parseHand - winning hands', () => {
  it('recognizes 4 pungs + 1 pair', () => {
    // 3x bamboo1, 3x bamboo2, 3x bamboo3, 3x dots1, 2x dots2
    const tiles = [
      nt('bamboo', 1), nt('bamboo', 1), nt('bamboo', 1),
      nt('bamboo', 2), nt('bamboo', 2), nt('bamboo', 2),
      nt('bamboo', 3), nt('bamboo', 3), nt('bamboo', 3),
      nt('dots', 1), nt('dots', 1), nt('dots', 1),
      nt('dots', 2), nt('dots', 2),
    ];
    const result = parseHand(tiles);
    expect(result.valid).toBe(true);
    expect(result.decompositions.length).toBeGreaterThan(0);
  });

  it('recognizes a hand with chows', () => {
    // 3 chows (1-2-3 bamboo x3) + 1 pung (dots 5) + pair (dots 9)
    const tiles = [
      nt('bamboo', 1), nt('bamboo', 2), nt('bamboo', 3),
      nt('bamboo', 1), nt('bamboo', 2), nt('bamboo', 3),
      nt('bamboo', 1), nt('bamboo', 2), nt('bamboo', 3),
      nt('dots', 5), nt('dots', 5), nt('dots', 5),
      nt('dots', 9), nt('dots', 9),
    ];
    const result = parseHand(tiles);
    expect(result.valid).toBe(true);
  });

  it('detects seven pairs', () => {
    const tiles = [
      nt('bamboo', 1), nt('bamboo', 1),
      nt('bamboo', 3), nt('bamboo', 3),
      nt('bamboo', 5), nt('bamboo', 5),
      nt('dots', 2), nt('dots', 2),
      nt('dots', 7), nt('dots', 7),
      nt('characters', 4), nt('characters', 4),
      honor('winds', 'east'), honor('winds', 'east'),
    ];
    const result = parseHand(tiles);
    expect(result.valid).toBe(true);
    expect(result.sevenPairs).toBe(true);
  });

  it('detects thirteen orphans', () => {
    const tiles = [
      nt('bamboo', 1), nt('bamboo', 9),
      nt('dots', 1), nt('dots', 9),
      nt('characters', 1), nt('characters', 9),
      honor('winds', 'east'), honor('winds', 'south'),
      honor('winds', 'west'), honor('winds', 'north'),
      honor('dragons', 'red'), honor('dragons', 'green'),
      honor('dragons', 'white'),
      nt('bamboo', 1), // the duplicate
    ];
    const result = parseHand(tiles);
    expect(result.valid).toBe(true);
    expect(result.thirteenOrphans).toBe(true);
  });
});

describe('parseHand - non-winning hands', () => {
  it('returns invalid for a non-winning 14-tile hand', () => {
    // Random tiles that don't form a winning pattern
    const tiles = [
      nt('bamboo', 1), nt('bamboo', 3), nt('bamboo', 5),
      nt('dots', 2), nt('dots', 4), nt('dots', 6),
      nt('characters', 1), nt('characters', 3), nt('characters', 7),
      honor('winds', 'east'), honor('winds', 'south'),
      honor('dragons', 'red'), honor('dragons', 'green'),
      honor('dragons', 'white'),
    ];
    const result = parseHand(tiles);
    expect(result.valid).toBe(false);
    expect(result.decompositions).toHaveLength(0);
    expect(result.sevenPairs).toBe(false);
    expect(result.thirteenOrphans).toBe(false);
  });
});

describe('isWinningHand', () => {
  it('returns true for a valid hand', () => {
    const tiles = [
      nt('bamboo', 1), nt('bamboo', 1), nt('bamboo', 1),
      nt('bamboo', 2), nt('bamboo', 2), nt('bamboo', 2),
      nt('bamboo', 3), nt('bamboo', 3), nt('bamboo', 3),
      nt('dots', 1), nt('dots', 1), nt('dots', 1),
      nt('dots', 2), nt('dots', 2),
    ];
    expect(isWinningHand(tiles)).toBe(true);
  });

  it('returns false for an invalid hand', () => {
    const tiles = Array(14).fill(null).map((_, i) => nt('bamboo', ((i % 9) + 1) as TileNumber));
    expect(isWinningHand(tiles)).toBe(false);
  });
});
