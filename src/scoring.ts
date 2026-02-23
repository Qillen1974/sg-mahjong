/**
 * Singapore Mahjong Hand Scoring Utility
 * Calculates tai (points) based on hand composition
 */

import { Tile, NumberedTile, HonorTile, BonusTile, tilesMatch, allTiles } from './tiles';

// Mahjong hand structure
export interface Hand {
  tiles: Tile[];
}

// Scoring result
export interface ScoringResult {
  tai: number;
  handType: string;
  description: string;
  details: ScoringDetail[];
}

export interface ScoringDetail {
  name: string;
  tai: number;
}

// Constants for special hands
export const SPECIAL_HANDS = {
  HEAVENLY_HAND: 'Heavenly Hand',
  EARTHLY_HAND: 'Earthly Hand',
  KNOCKED_FOUR_CHOWS: 'Knocked Four Chows',
  FOUR_CONCEALED_PUNGS: 'Four Concealed Pungs',
  FOUR_PUNGS: 'Four Pungs',
  LITTLE_FOUR_WINDS: 'Little Four Winds',
  BIG_FOUR_WINDS: 'Big Four Winds',
  FOUR_DRAGONS: 'Four Dragons',
  SEVEN_PAIRS: 'Seven Pairs',
  THIRTEEN_ORPHANS: 'Thirteen Orphans'
};

// Basic hand types
export const HAND_TYPES = {
  PUNG: 'Pung',
  KONG: 'Kong',
  CHOW: 'Chow',
  PAIR: 'Pair',
  EYE: 'Eye'
};

// Count tile occurrences in hand
function countTiles(tiles: Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const key = `${tile.suit}_${tile.value}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Check for pung (3 identical tiles)
function hasPung(tileCounts: Map<string, number>): boolean {
  return Array.from(tileCounts.values()).some(count => count >= 3);
}

// Check for kong (4 identical tiles)
function hasKong(tileCounts: Map<string, number>): boolean {
  return Array.from(tileCounts.values()).some(count => count >= 4);
}

// Check for pair (2 identical tiles)
function hasPair(tileCounts: Map<string, number>): boolean {
  return Array.from(tileCounts.values()).some(count => count >= 2);
}

// Count pungs in hand
function countPungs(tileCounts: Map<string, number>): number {
  let pungs = 0;
  for (const [key, count] of tileCounts) {
    if (count >= 3) pungs++;
  }
  return pungs;
}

// Count kongs in hand
function countKongs(tileCounts: Map<string, number>): number {
  let kongs = 0;
  for (const count of tileCounts.values()) {
    if (count >= 4) kongs++;
  }
  return kongs;
}

// Count pairs in hand
function countPairs(tileCounts: Map<string, number>): number {
  let pairs = 0;
  for (const count of tileCounts.values()) {
    if (count >= 2) pairs++;
  }
  return pairs;
}

// Check if hand is all one suit (pure hand)
function isPureHand(tiles: Tile[]): boolean {
  const suits = new Set(tiles.map(t => t.suit));
  const nonBonusSuits = Array.from(suits).filter(s => s !== 'flowers' && s !== 'animals');
  return nonBonusSuits.size === 1;
}

// Check if hand has mixed suit
function isMixedSuit(tiles: Tile[]): boolean {
  const suits = new Set(tiles.map(t => t.suit));
  const nonBonusSuits = Array.from(suits).filter(s => s !== 'flowers' && s !== 'animals');
  return nonBonusSuits.size > 1;
}

// Count bonus tiles (flowers and animals)
function countBonusTiles(tiles: Tile[]): number {
  return tiles.filter(t => t.isBonus).length;
}

// Check for same suit honors
function hasHonors(tiles: Tile[]): boolean {
  return tiles.some(t => t.suit === 'winds' || t.suit === 'dragons');
}

// Check for terminal tiles (1 and 9)
function hasTerminals(tiles: Tile[]): boolean {
  return tiles.some(t => {
    if (t.suit === 'bamboo' || t.suit === 'dots' || t.suit === 'characters') {
      const num = (t as NumberedTile).value;
      return num === 1 || num === 9;
    }
    return false;
  });
}

// Calculate base tai from hand composition
export function calculateTai(hand: Hand): number {
  const tiles = hand.tiles;
  const tileCounts = countTiles(tiles);
  
  let tai = 0;
  const details: ScoringDetail[] = [];

  // Validate hand size (should be 14 tiles)
  if (tiles.length !== 14) {
    return 0;
  }

  // Count pungs and kongs
  const pungs = countPungs(tileCounts);
  const kongs = countKongs(tileCounts);
  const pairs = countPairs(tileCounts);
  const bonusCount = countBonusTiles(tiles);

  // Bonus tile scoring (each flower/animal = 1 tai, all 4 = 8 tai)
  if (bonusCount > 0) {
    if (bonusCount === 4) {
      tai += 8;
      details.push({ name: 'All Flowers/Animals', tai: 8 });
    } else {
      tai += bonusCount;
      details.push({ name: 'Bonus Tiles', tai: bonusCount });
    }
  }

  // Pung of honor tiles
  const honorPungs = Array.from(tileCounts.entries())
    .filter(([key, count]) => count >= 3 && (key.startsWith('winds_') || key.startsWith('dragons_')))
    .length;
  
  if (honorPungs > 0) {
    tai += honorPungs * 2;
    details.push({ name: 'Honor Pungs', tai: honorPungs * 2 });
  }

  // Pung of terminal tiles (1 or 9)
  const terminalPungs = Array.from(tileCounts.entries())
    .filter(([key, count]) => {
      if (count < 3) return false;
      const match = key.match(/^(bamboo|dots|characters)_(1|9)/);
      return match !== null;
    }).length;

  if (terminalPungs > 0) {
    tai += terminalPungs * 2;
    details.push({ name: 'Terminal Pungs', tai: terminalPungs * 2 });
  }

  // Kong scoring (each kong = 2 tai)
  if (kongs > 0) {
    tai += kongs * 2;
    details.push({ name: 'Kongs', tai: kongs * 2 });
  }

  // Pure hand (all one suit) = 6 tai
  if (isPureHand(tiles) && pungs > 0) {
    tai += 6;
    details.push({ name: 'Pure Hand', tai: 6 });
  }

  // Mixed one-suit hand (two suits) = 3 tai
  const suits = new Set(tiles.filter(t => !t.isBonus).map(t => t.suit));
  if (suits.size === 2) {
    tai += 3;
    details.push({ name: 'Mixed One-Suit', tai: 3 });
  }

  // Mixed suit hand = 1 tai
  if (isMixedSuit(tiles) && suits.size >= 3) {
    tai += 1;
    details.push({ name: 'Mixed Suit', tai: 1 });
  }

  // No honors or terminals (half flush) = 2 tai
  if (!hasHonors(tiles) && !hasTerminals(tiles) && suits.size >= 2) {
    tai += 2;
    details.push({ name: 'Half Flush', tai: 2 });
  }

  // Dragon pung = 2 tai
  const dragonPungs = Array.from(tileCounts.entries())
    .filter(([key, count]) => count >= 3 && key.startsWith('dragons_'))
    .length;
  if (dragonPungs > 0) {
    tai += dragonPungs * 2;
    details.push({ name: 'Dragon Pungs', tai: dragonPungs * 2 });
  }

  // Wind pair with seat wind = 1 tai
  // (simplified - would need to know seat wind)
  
  // Seven pairs = 6 tai
  if (pairs >= 7) {
    tai += 6;
    details.push({ name: 'Seven Pairs', tai: 6 });
  }

  // Ensure minimum tai of 1 for a valid complete hand
  if (tai < 1) {
    tai = 1;
    details.push({ name: 'Minimum Hand', tai: 1 });
  }

  return tai;
}

// Main scoring function
export function scoreHand(hand: Hand): ScoringResult {
  const tai = calculateTai(hand);
  const details: ScoringDetail[] = [];
  
  // Generate description based on hand composition
  const tiles = hand.tiles;
  const tileCounts = countTiles(tiles);
  const pungs = countPungs(tileCounts);
  const kongs = countKongs(tileCounts);
  const pairs = countPairs(tileCounts);
  const bonusCount = countBonusTiles(tiles);

  let handType = 'Standard Hand';
  
  if (pairs >= 7) {
    handType = SPECIAL_HANDS.SEVEN_PAIRS;
  } else if (pungs + kongs >= 4) {
    handType = 'Pung Hand';
  } else if (isPureHand(tiles)) {
    handType = 'Pure Hand';
  }

  const description = `${handType}: ${pungs} pungs, ${kongs} kongs, ${pairs} pairs, ${bonusCount} bonus tiles`;

  return {
    tai,
    handType,
    description,
    details
  };
}

// Export utility functions
export { countTiles, countPungs, countKongs, countPairs, isPureHand, isMixedSuit };
