/**
 * Hand Validation and Meld Parser for Singapore Mahjong
 *
 * Given 14 non-bonus tiles, determines all valid decompositions:
 *   - Standard: 4 sets (chow/pung/kong) + 1 pair
 *   - Seven Pairs: 7 distinct pairs
 *   - Thirteen Orphans: one of each terminal/honor + one duplicate
 *
 * Bonus tiles must be removed before parsing (they are set aside during play).
 */

import { Tile, tileKey, TileNumber, NumberedSuit } from './tiles';
import { MeldedSet } from './scoring';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedHand {
  melds: MeldedSet[];
  pair: Tile[];
}

export interface ParseResult {
  valid: boolean;
  decompositions: ParsedHand[];
  sevenPairs: boolean;
  thirteenOrphans: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group tiles by their key, preserving individual tile references. */
function groupTiles(tiles: Tile[]): Map<string, Tile[]> {
  const groups = new Map<string, Tile[]>();
  for (const t of tiles) {
    const k = tileKey(t);
    const arr = groups.get(k) || [];
    arr.push(t);
    groups.set(k, arr);
  }
  return groups;
}

/** Get numeric value from a numbered tile, or null if not numbered. */
function getNumber(t: Tile): number | null {
  if (t.suit === 'bamboo' || t.suit === 'dots' || t.suit === 'characters') {
    return t.value as number;
  }
  return null;
}

/**
 * Build a sorted array of tile keys for the remaining tiles,
 * used as a compact representation for the recursive solver.
 */
function tilesToCounts(tiles: Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tiles) {
    const k = tileKey(t);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Thirteen Orphans check
// ---------------------------------------------------------------------------

const ORPHAN_KEYS = [
  'bamboo_1', 'bamboo_9',
  'dots_1', 'dots_9',
  'characters_1', 'characters_9',
  'winds_east', 'winds_south', 'winds_west', 'winds_north',
  'dragons_red', 'dragons_green', 'dragons_white',
];

function checkThirteenOrphans(counts: Map<string, number>): boolean {
  if (counts.size > 13) return false;
  let hasPair = false;
  for (const k of ORPHAN_KEYS) {
    const c = counts.get(k) || 0;
    if (c === 0) return false;
    if (c === 2) {
      if (hasPair) return false; // only one pair allowed
      hasPair = true;
    }
    if (c > 2) return false;
  }
  // All 14 tiles accounted for by orphan keys
  let total = 0;
  for (const c of counts.values()) total += c;
  return total === 14 && hasPair;
}

// ---------------------------------------------------------------------------
// Seven Pairs check
// ---------------------------------------------------------------------------

function checkSevenPairs(counts: Map<string, number>): boolean {
  if (counts.size !== 7) return false;
  for (const c of counts.values()) {
    if (c !== 2) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Standard hand decomposition (4 sets + 1 pair)
// ---------------------------------------------------------------------------

/** Sorted unique keys for consistent iteration order. */
function sortedKeys(counts: Map<string, number>): string[] {
  return Array.from(counts.keys()).sort();
}

/**
 * Recursively find all ways to decompose tiles into 4 sets + 1 pair.
 * Works on a mutable counts map; clones before each branch.
 */
function findDecompositions(
  counts: Map<string, number>,
  melds: MeldedSet[],
  tileMap: Map<string, Tile[]>,
  results: ParsedHand[],
  pairChosen: boolean,
): void {
  // Count remaining tiles
  let remaining = 0;
  for (const c of counts.values()) remaining += c;

  // Base case: all tiles consumed
  if (remaining === 0 && melds.length === 4 && pairChosen) {
    results.push({ melds: [...melds], pair: [] }); // pair filled in by caller
    return;
  }

  // Find the first key with count > 0
  const keys = sortedKeys(counts);
  let firstKey = '';
  for (const k of keys) {
    if ((counts.get(k) || 0) > 0) {
      firstKey = k;
      break;
    }
  }
  if (!firstKey) return;

  const count = counts.get(firstKey) || 0;
  const sample = tileMap.get(firstKey)!;

  // Option 1: Use as pair (if pair not yet chosen and count >= 2)
  if (!pairChosen && count >= 2) {
    const next = new Map(counts);
    next.set(firstKey, count - 2);
    const pair = sample.slice(0, 2);
    const subResults: ParsedHand[] = [];
    findDecompositions(next, melds, tileMap, subResults, true);
    for (const r of subResults) {
      r.pair = pair;
      results.push(r);
    }
  }

  // Option 2: Use as pung (count >= 3)
  if (count >= 3 && melds.length < 4) {
    const next = new Map(counts);
    next.set(firstKey, count - 3);
    const pung: MeldedSet = {
      type: 'pung',
      tiles: sample.slice(0, 3),
      concealed: true,
    };
    findDecompositions(next, [...melds, pung], tileMap, results, pairChosen);
  }

  // Option 3: Use as kong (count === 4)
  if (count === 4 && melds.length < 4) {
    const next = new Map(counts);
    next.set(firstKey, 0);
    const kong: MeldedSet = {
      type: 'kong',
      tiles: sample.slice(0, 4),
      concealed: true,
    };
    findDecompositions(next, [...melds, kong], tileMap, results, pairChosen);
  }

  // Option 4: Use as start of chow (numbered suits only, consecutive values)
  const parts = firstKey.split('_');
  const suit = parts[0];
  const val = parseInt(parts[1], 10);
  if ((suit === 'bamboo' || suit === 'dots' || suit === 'characters') && !isNaN(val) && val <= 7) {
    const key2 = suit + '_' + (val + 1);
    const key3 = suit + '_' + (val + 2);
    const c2 = counts.get(key2) || 0;
    const c3 = counts.get(key3) || 0;
    if (c2 > 0 && c3 > 0 && melds.length < 4) {
      const next = new Map(counts);
      next.set(firstKey, count - 1);
      next.set(key2, c2 - 1);
      next.set(key3, c3 - 1);
      const t1 = tileMap.get(firstKey)![0];
      const t2 = tileMap.get(key2)![0];
      const t3 = tileMap.get(key3)![0];
      const chow: MeldedSet = {
        type: 'chow',
        tiles: [t1, t2, t3],
        concealed: true,
      };
      findDecompositions(next, [...melds, chow], tileMap, results, pairChosen);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a 14-tile hand into all valid decompositions.
 * Rejects hands containing bonus tiles.
 */
export function parseHand(tiles: Tile[]): ParseResult {
  // Validate: exactly 14 tiles, no bonus tiles
  if (tiles.length !== 14) {
    return { valid: false, decompositions: [], sevenPairs: false, thirteenOrphans: false };
  }
  if (tiles.some(t => t.isBonus)) {
    return { valid: false, decompositions: [], sevenPairs: false, thirteenOrphans: false };
  }

  const counts = tilesToCounts(tiles);
  const tileMap = groupTiles(tiles);

  const sevenPairs = checkSevenPairs(counts);
  const thirteenOrphans = checkThirteenOrphans(counts);

  // Standard decomposition (4 sets + 1 pair)
  const decompositions: ParsedHand[] = [];
  findDecompositions(counts, [], tileMap, decompositions, false);

  const valid = decompositions.length > 0 || sevenPairs || thirteenOrphans;

  return { valid, decompositions, sevenPairs, thirteenOrphans };
}

/** Convenience: check if 14 tiles form any valid winning hand. */
export function isWinningHand(tiles: Tile[]): boolean {
  return parseHand(tiles).valid;
}
