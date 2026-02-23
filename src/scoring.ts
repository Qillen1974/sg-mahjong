/**
 * Singapore Mahjong Hand Scoring Utility
 * Calculates tai (points) based on hand composition
 *
 * In Singapore Mahjong, bonus tiles (flowers/animals) are set aside when drawn.
 * A winning hand has 14 tiles (excluding bonus tiles): 4 melds + 1 pair.
 */

import { Tile, NumberedTile } from './tiles';

export interface Hand {
  /** The 14 tiles forming the winning hand (excluding bonus tiles) */
  tiles: Tile[];
  /** Bonus tiles (flowers/animals) set aside during play */
  bonusTiles: Tile[];
  /** Number of concealed kongs (4 identical tiles kept hidden) */
  concealedKongs: number;
  /** Number of exposed kongs */
  exposedKongs: number;
}

export interface ScoringDetail {
  name: string;
  tai: number;
}

export interface ScoringResult {
  tai: number;
  handType: string;
  description: string;
  details: ScoringDetail[];
}

// Count tile occurrences by suit_value key
function countTiles(tiles: Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const key = `${tile.suit}_${tile.value}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Get the numbered suits present (excluding honors and bonus)
function getNumberedSuits(tiles: Tile[]): Set<string> {
  return new Set(
    tiles
      .filter(t => t.suit === 'bamboo' || t.suit === 'dots' || t.suit === 'characters')
      .map(t => t.suit)
  );
}

function hasHonors(tiles: Tile[]): boolean {
  return tiles.some(t => t.suit === 'winds' || t.suit === 'dragons');
}

function hasTerminals(tiles: Tile[]): boolean {
  return tiles.some(t => {
    if (t.suit === 'bamboo' || t.suit === 'dots' || t.suit === 'characters') {
      return (t as NumberedTile).value === 1 || (t as NumberedTile).value === 9;
    }
    return false;
  });
}

/**
 * Calculate tai for a winning Singapore Mahjong hand.
 *
 * Scoring rules implemented:
 * - Bonus tiles: 1 tai each; all 4 flowers = 8 tai; all 4 animals = 8 tai
 * - Wind pung: 1 tai (seat/prevailing wind pungs would be more — simplified here)
 * - Dragon pung: 1 tai each
 * - Terminal pung (1 or 9): 1 tai each
 * - Kong: 1 tai each
 * - Pure hand (清一色, one numbered suit only): 4 tai
 * - Half flush (混一色, one numbered suit + honors): 2 tai
 * - All terminals and honors: 4 tai
 * - Seven pairs: 4 tai
 * - No flowers: 1 tai
 * - Minimum hand: 1 tai (if nothing else scores)
 */
export function scoreHand(hand: Hand): ScoringResult {
  const { tiles, bonusTiles } = hand;
  const details: ScoringDetail[] = [];
  let tai = 0;

  // Validate hand size: must be 14 tiles (excluding bonus)
  if (tiles.length !== 14) {
    return {
      tai: 0,
      handType: 'Invalid',
      description: `Invalid hand: expected 14 tiles, got ${tiles.length}`,
      details: [],
    };
  }

  const tileCounts = countTiles(tiles);
  const totalKongs = (hand.concealedKongs || 0) + (hand.exposedKongs || 0);

  // ── Bonus tile scoring ──
  const flowers = bonusTiles.filter(t => t.suit === 'flowers');
  const animals = bonusTiles.filter(t => t.suit === 'animals');

  if (flowers.length === 4) {
    tai += 8;
    details.push({ name: 'All Flowers', tai: 8 });
  } else if (flowers.length > 0) {
    tai += flowers.length;
    details.push({ name: 'Flowers', tai: flowers.length });
  }

  if (animals.length === 4) {
    tai += 8;
    details.push({ name: 'All Animals', tai: 8 });
  } else if (animals.length > 0) {
    tai += animals.length;
    details.push({ name: 'Animals', tai: animals.length });
  }

  if (bonusTiles.length === 0) {
    tai += 1;
    details.push({ name: 'No Flowers', tai: 1 });
  }

  // ── Pung/Kong scoring ──
  for (const [key, count] of tileCounts) {
    if (count < 3) continue;

    if (key.startsWith('dragons_')) {
      tai += 1;
      details.push({ name: `Dragon Pung (${key.split('_')[1]})`, tai: 1 });
    } else if (key.startsWith('winds_')) {
      tai += 1;
      details.push({ name: `Wind Pung (${key.split('_')[1]})`, tai: 1 });
    } else {
      // Check terminal pung
      const valStr = key.split('_')[1];
      if (valStr === '1' || valStr === '9') {
        tai += 1;
        details.push({ name: `Terminal Pung (${key})`, tai: 1 });
      }
    }
  }

  // Kong scoring
  if (totalKongs > 0) {
    tai += totalKongs;
    details.push({ name: `Kongs (${totalKongs})`, tai: totalKongs });
  }

  // ── Hand pattern scoring ──
  const numberedSuits = getNumberedSuits(tiles);
  const honorPresent = hasHonors(tiles);
  const pairs = Array.from(tileCounts.values()).filter(c => c >= 2).length;

  // Seven pairs
  if (pairs >= 7 && tiles.length === 14) {
    tai += 4;
    details.push({ name: 'Seven Pairs', tai: 4 });
  }

  // Pure hand: only one numbered suit, no honors
  if (numberedSuits.size === 1 && !honorPresent) {
    tai += 4;
    details.push({ name: 'Pure Hand (清一色)', tai: 4 });
  }
  // Half flush: one numbered suit + honors
  else if (numberedSuits.size === 1 && honorPresent) {
    tai += 2;
    details.push({ name: 'Half Flush (混一色)', tai: 2 });
  }

  // All terminals and honors (no simples 2-8)
  const allTerminalsAndHonors = tiles.every(t => {
    if (t.suit === 'winds' || t.suit === 'dragons') return true;
    if (t.suit === 'bamboo' || t.suit === 'dots' || t.suit === 'characters') {
      const v = (t as NumberedTile).value;
      return v === 1 || v === 9;
    }
    return false;
  });
  if (allTerminalsAndHonors) {
    tai += 4;
    details.push({ name: 'All Terminals & Honors', tai: 4 });
  }

  // ── Minimum hand ──
  if (tai < 1) {
    tai = 1;
    details.push({ name: 'Minimum Hand', tai: 1 });
  }

  // ── Determine hand type label ──
  let handType = 'Standard Hand';
  if (pairs >= 7) {
    handType = 'Seven Pairs';
  } else if (numberedSuits.size === 1 && !honorPresent) {
    handType = 'Pure Hand';
  } else if (numberedSuits.size === 1 && honorPresent) {
    handType = 'Half Flush';
  } else if (allTerminalsAndHonors) {
    handType = 'All Terminals & Honors';
  }

  const description = `${handType} — ${tai} tai total`;

  return { tai, handType, description, details };
}

export { countTiles };
