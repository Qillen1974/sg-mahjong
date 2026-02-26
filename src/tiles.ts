/**
 * Singapore Mahjong Tile Definitions
 *
 * Total: 148 tiles
 *   Bamboo 1-9 x4 = 36
 *   Dots 1-9 x4 = 36
 *   Characters 1-9 x4 = 36
 *   Winds (E/S/W/N) x4 = 16
 *   Dragons (Red/Green/White) x4 = 12
 *   Flowers (Plum/Orchid/Bamboo/Chrysanthemum) x1 = 4
 *   Seasons (Spring/Summer/Autumn/Winter) x1 = 4
 *   Animals (Cat/Mouse/Rooster/Centipede) x1 = 4
 */

export type NumberedSuit = 'bamboo' | 'dots' | 'characters';
export type HonorSuit = 'winds' | 'dragons';
export type BonusSuit = 'flowers' | 'seasons' | 'animals';
export type TileSuit = NumberedSuit | HonorSuit | BonusSuit;

export type TileNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Wind = 'east' | 'south' | 'west' | 'north';
export type Dragon = 'red' | 'green' | 'white';
export type Flower = 'plum' | 'orchid' | 'bamboo' | 'chrysanthemum';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Animal = 'cat' | 'mouse' | 'rooster' | 'centipede';

export interface Tile {
  id: string;
  suit: TileSuit;
  value: TileNumber | Wind | Dragon | Flower | Season | Animal;
  name: string;
  isBonus: boolean;
  isHonor: boolean;
  isTerminal: boolean;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function createNumberedTile(suit: NumberedSuit, num: TileNumber, copy: number): Tile {
  return {
    id: `${suit}_${num}_${copy}`,
    suit,
    value: num,
    name: `${capitalize(suit)} ${num}`,
    isBonus: false,
    isHonor: false,
    isTerminal: num === 1 || num === 9,
  };
}

function createHonorTile(suit: HonorSuit, value: Wind | Dragon, copy: number): Tile {
  return {
    id: `${suit}_${value}_${copy}`,
    suit,
    value,
    name: `${capitalize(value)} ${suit === 'winds' ? 'Wind' : 'Dragon'}`,
    isBonus: false,
    isHonor: true,
    isTerminal: false,
  };
}

function createBonusTile(suit: BonusSuit, value: Flower | Season | Animal): Tile {
  return {
    id: `${suit}_${value}`,
    suit,
    value,
    name: capitalize(value),
    isBonus: true,
    isHonor: false,
    isTerminal: false,
  };
}

export function createAllTiles(): Tile[] {
  const tiles: Tile[] = [];

  // Numbered suits: Bamboo, Dots, Characters (9 values x 4 copies each)
  const numberedSuits: NumberedSuit[] = ['bamboo', 'dots', 'characters'];
  for (const suit of numberedSuits) {
    for (let n = 1; n <= 9; n++) {
      for (let c = 1; c <= 4; c++) {
        tiles.push(createNumberedTile(suit, n as TileNumber, c));
      }
    }
  }

  // Winds (4 types x 4 copies)
  const winds: Wind[] = ['east', 'south', 'west', 'north'];
  for (const w of winds) {
    for (let c = 1; c <= 4; c++) {
      tiles.push(createHonorTile('winds', w, c));
    }
  }

  // Dragons (3 types x 4 copies)
  const dragons: Dragon[] = ['red', 'green', 'white'];
  for (const d of dragons) {
    for (let c = 1; c <= 4; c++) {
      tiles.push(createHonorTile('dragons', d, c));
    }
  }

  // Flowers (4 unique)
  const flowers: Flower[] = ['plum', 'orchid', 'bamboo', 'chrysanthemum'];
  for (const f of flowers) tiles.push(createBonusTile('flowers', f));

  // Seasons (4 unique)
  const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  for (const s of seasons) tiles.push(createBonusTile('seasons', s));

  // Animals (4 unique)
  const animals: Animal[] = ['cat', 'mouse', 'rooster', 'centipede'];
  for (const a of animals) tiles.push(createBonusTile('animals', a));

  return tiles;
}

export const ALL_TILES = createAllTiles();

export const TILE_COUNTS = {
  bamboo: 36,
  dots: 36,
  characters: 36,
  winds: 16,
  dragons: 12,
  flowers: 4,
  seasons: 4,
  animals: 4,
  total: 148,
} as const;

/** Check if two tiles are the same kind (ignoring copy index). */
export function tilesMatch(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.value === b.value;
}

/** Unique key for grouping identical tiles. */
export function tileKey(t: Tile): string {
  return `${t.suit}_${t.value}`;
}
