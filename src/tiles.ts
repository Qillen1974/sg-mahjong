/**
 * Singapore Mahjong Tile Definitions
 * Total: 148 tiles (144 standard + 4 bonus)
 */

// Tile suits
export type TileSuit = 'bamboo' | 'dots' | 'characters' | 'winds' | 'dragons' | 'flowers' | 'animals';

// Tile numbers for numbered suits
export type TileNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// Wind types
export type Wind = 'east' | 'south' | 'west' | 'north';

// Dragon types
export type Dragon = 'red' | 'green' | 'white';

// Flower types
export type Flower = 'plum' | 'orchid' | 'bamboo' | 'chrysanthemum';

// Animal types
export type Animal = 'cat' | 'mouse' | 'rooster' | 'centipede';

// Base tile interface
export interface Tile {
  id: string;
  suit: TileSuit;
  value: number | string;
  name: string;
  isBonus: boolean;
}

// Numbered tile (Bamboo, Dots, Characters)
export interface NumberedTile extends Tile {
  suit: 'bamboo' | 'dots' | 'characters';
  value: TileNumber;
}

// Honor tile (Winds, Dragons)
export interface HonorTile extends Tile {
  suit: 'winds' | 'dragons';
  value: Wind | Dragon;
}

// Bonus tile (Flowers, Animals)
export interface BonusTile extends Tile {
  suit: 'flowers' | 'animals';
  value: Flower | Animal;
}

// Create numbered tile
function createNumberedTile(suit: 'bamboo' | 'dots' | 'characters', num: TileNumber, index: number): NumberedTile {
  const suitNames: Record<string, string> = {
    bamboo: 'Bamboo',
    dots: 'Dots',
    characters: 'Characters'
  };
  return {
    id: `${suit}_${num}_${index}`,
    suit,
    value: num,
    name: `${suitNames[suit]} ${num}`,
    isBonus: false
  };
}

// Create honor tile
function createHonorTile(suit: 'winds' | 'dragons', value: Wind | Dragon, index: number): HonorTile {
  const suitNames: Record<string, string> = {
    winds: 'Wind',
    dragons: 'Dragon'
  };
  return {
    id: `${suit}_${value}_${index}`,
    suit,
    value,
    name: `${suitNames[suit]} ${value.charAt(0).toUpperCase() + value.slice(1)}`,
    isBonus: false
  };
}

// Create bonus tile
function createBonusTile(suit: 'flowers' | 'animals', value: Flower | Animal): BonusTile {
  const suitNames: Record<string, string> = {
    flowers: 'Flower',
    animals: 'Animal'
  };
  return {
    id: `${suit}_${value}`,
    suit,
    value,
    name: `${suitNames[suit]} ${value.charAt(0).toUpperCase() + value.slice(1)}`,
    isBonus: true
  };
}

// Generate all tiles
export function createAllTiles(): Tile[] {
  const tiles: Tile[] = [];

  // Bamboo 1-9 x 4
  for (let n = 1; n <= 9; n++) {
    for (let i = 1; i <= 4; i++) {
      tiles.push(createNumberedTile('bamboo', n as TileNumber, i));
    }
  }

  // Dots 1-9 x 4
  for (let n = 1; n <= 9; n++) {
    for (let i = 1; i <= 4; i++) {
      tiles.push(createNumberedTile('dots', n as TileNumber, i));
    }
  }

  // Characters 1-9 x 4
  for (let n = 1; n <= 9; n++) {
    for (let i = 1; i <= 4; i++) {
      tiles.push(createNumberedTile('characters', n as TileNumber, i));
    }
  }

  // Winds x 4 (East, South, West, North)
  const winds: Wind[] = ['east', 'south', 'west', 'north'];
  for (const wind of winds) {
    for (let i = 1; i <= 4; i++) {
      tiles.push(createHonorTile('winds', wind, i));
    }
  }

  // Dragons x 4 (Red, Green, White)
  const dragons: Dragon[] = ['red', 'green', 'white'];
  for (const dragon of dragons) {
    for (let i = 1; i <= 4; i++) {
      tiles.push(createHonorTile('dragons', dragon, i));
    }
  }

  // Flowers x 1 each
  const flowers: Flower[] = ['plum', 'orchid', 'bamboo', 'chrysanthemum'];
  for (const flower of flowers) {
    tiles.push(createBonusTile('flowers', flower));
  }

  // Animals x 1 each
  const animals: Animal[] = ['cat', 'mouse', 'rooster', 'centipede'];
  for (const animal of animals) {
    tiles.push(createBonusTile('animals', animal));
  }

  return tiles;
}

// Pre-generated tile collection
export const allTiles = createAllTiles();

// Tile counts
export const TILE_COUNTS = {
  bamboo: 36,    // 9 x 4
  dots: 36,      // 9 x 4
  characters: 36, // 9 x 4
  winds: 16,     // 4 x 4
  dragons: 12,   // 3 x 4
  flowers: 4,    // 1 each
  animals: 4,    // 1 each
  total: 148
};

// Check if two tiles are the same type (ignores copy index)
export function tilesMatch(tile1: Tile, tile2: Tile): boolean {
  return tile1.suit === tile2.suit && tile1.value === tile2.value;
}

// Get all copies of a tile (for hand evaluation)
export function getTileMatches(tiles: Tile[], target: Tile): Tile[] {
  return tiles.filter(t => tilesMatch(t, target));
}
