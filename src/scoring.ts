/**
 * Singapore Mahjong Hand Scoring Utility
 *
 * In Singapore Mahjong, bonus tiles (flowers, seasons, animals) are set aside
 * when drawn and replaced. They are NOT part of the 14-tile hand.
 * A winning hand = 14 tiles (4 sets + 1 pair, or 7 pairs, or 13 orphans).
 * Bonus tiles contribute extra tai on top of the hand score.
 *
 * Tai values follow common Singapore tournament rules.
 */

import { Tile, tileKey, NumberedSuit } from './tiles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeldedSet {
  type: 'chow' | 'pung' | 'kong';
  tiles: Tile[];
  concealed: boolean;
}

export interface WinningHand {
  /** The 14 tiles forming the hand (excluding bonus). */
  handTiles: Tile[];
  /** Melded sets (open or concealed). */
  melds: MeldedSet[];
  /** The pair (eyes). */
  pair: Tile[];
  /** Bonus tiles set aside. */
  bonusTiles: Tile[];
  /** Player seat wind. */
  seatWind: 'east' | 'south' | 'west' | 'north';
  /** Prevailing (round) wind. */
  prevailingWind: 'east' | 'south' | 'west' | 'north';
  /** Whether the hand was self-drawn (zi mo). */
  selfDrawn: boolean;
  /** Whether this is the very first draw (for heavenly/earthly hand). */
  firstDraw: boolean;
}

export interface ScoringDetail {
  name: string;
  tai: number;
}

export interface ScoringResult {
  tai: number;
  details: ScoringDetail[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countByKey(tiles: Tile[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) {
    const k = tileKey(t);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function isNumberedSuit(suit: string): suit is NumberedSuit {
  return suit === 'bamboo' || suit === 'dots' || suit === 'characters';
}

function getNumberedSuits(tiles: Tile[]): Set<NumberedSuit> {
  const suits = new Set<NumberedSuit>();
  for (const t of tiles) {
    if (isNumberedSuit(t.suit)) suits.add(t.suit);
  }
  return suits;
}

function hasHonors(tiles: Tile[]): boolean {
  return tiles.some(t => t.isHonor);
}

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

/** Score bonus tiles (flowers, seasons, animals). */
function scoreBonusTiles(bonus: Tile[]): ScoringDetail[] {
  const details: ScoringDetail[] = [];
  const flowers = bonus.filter(t => t.suit === 'flowers');
  const seasons = bonus.filter(t => t.suit === 'seasons');
  const animals = bonus.filter(t => t.suit === 'animals');

  if (flowers.length === 4) {
    details.push({ name: 'Complete Flowers', tai: 8 });
  } else if (flowers.length > 0) {
    details.push({ name: flowers.length + ' Flower(s)', tai: flowers.length });
  }

  if (seasons.length === 4) {
    details.push({ name: 'Complete Seasons', tai: 8 });
  } else if (seasons.length > 0) {
    details.push({ name: seasons.length + ' Season(s)', tai: seasons.length });
  }

  if (animals.length === 4) {
    details.push({ name: 'Complete Animals', tai: 8 });
  } else if (animals.length > 0) {
    details.push({ name: animals.length + ' Animal(s)', tai: animals.length });
  }

  return details;
}

/** Score melds (pungs, kongs, chows). */
function scoreMelds(
  melds: MeldedSet[],
  seatWind: string,
  prevailingWind: string,
): ScoringDetail[] {
  const details: ScoringDetail[] = [];

  for (const meld of melds) {
    const rep = meld.tiles[0];
    const isPungLike = meld.type === 'pung' || meld.type === 'kong';

    if (!isPungLike) continue;

    // Dragon pung/kong = 1 tai
    if (rep.suit === 'dragons') {
      details.push({ name: 'Pung of ' + rep.name, tai: 1 });
    }
    // Seat wind pung/kong = 1 tai
    if (rep.suit === 'winds' && rep.value === seatWind) {
      details.push({ name: 'Pung of Seat Wind (' + rep.value + ')', tai: 1 });
    }
    // Prevailing wind pung/kong = 1 tai
    if (rep.suit === 'winds' && rep.value === prevailingWind) {
      details.push({ name: 'Pung of Prevailing Wind (' + rep.value + ')', tai: 1 });
    }
    // Kong bonus = 1 extra tai
    if (meld.type === 'kong') {
      details.push({ name: 'Kong of ' + rep.name, tai: 1 });
    }
  }

  return details;
}

/** Score hand-level patterns. */
function scoreHandPatterns(hand: WinningHand): ScoringDetail[] {
  const details: ScoringDetail[] = [];
  const tiles = hand.handTiles;
  const numberedSuits = getNumberedSuits(tiles);
  const honors = hasHonors(tiles);

  // Pure hand (清一色): all tiles one numbered suit, no honors - 4 tai
  if (numberedSuits.size === 1 && !honors) {
    details.push({ name: 'Pure Hand', tai: 4 });
  }

  // Half flush (混一色): one numbered suit + honors - 2 tai
  if (numberedSuits.size === 1 && honors) {
    details.push({ name: 'Half Flush', tai: 2 });
  }

  // All pungs (对对和): 4 pungs/kongs + pair - 4 tai
  const pungOrKong = hand.melds.filter(m => m.type === 'pung' || m.type === 'kong');
  if (pungOrKong.length === 4) {
    details.push({ name: 'All Pungs', tai: 4 });
  }

  // Concealed hand (门前清): all melds concealed - 1 tai
  if (hand.melds.every(m => m.concealed)) {
    details.push({ name: 'Concealed Hand', tai: 1 });
  }

  // Self-drawn (自摸) - 1 tai
  if (hand.selfDrawn) {
    details.push({ name: 'Self-Drawn', tai: 1 });
  }

  // Seven pairs (七对子) - 4 tai
  const counts = countByKey(tiles);
  const pairCount = Array.from(counts.values()).filter(c => c === 2).length;
  if (pairCount === 7) {
    details.push({ name: 'Seven Pairs', tai: 4 });
  }

  return details;
}

/** Check for limit hands (instant max-tai patterns). */
function checkLimitHand(hand: WinningHand): ScoringDetail | null {
  const tiles = hand.handTiles;
  const counts = countByKey(tiles);

  // Thirteen Orphans (十三幺)
  const orphanKeys = [
    'bamboo_1', 'bamboo_9', 'dots_1', 'dots_9', 'characters_1', 'characters_9',
    'winds_east', 'winds_south', 'winds_west', 'winds_north',
    'dragons_red', 'dragons_green', 'dragons_white',
  ];
  const hasAllOrphans = orphanKeys.every(k => (counts.get(k) || 0) >= 1);
  if (hasAllOrphans && tiles.length === 14) {
    return { name: 'Thirteen Orphans', tai: 40 };
  }

  // Heavenly Hand (天和): dealer wins on first draw
  if (hand.firstDraw && hand.seatWind === 'east') {
    return { name: 'Heavenly Hand', tai: 40 };
  }

  // Earthly Hand (地和): non-dealer wins on first discard
  if (hand.firstDraw && hand.seatWind !== 'east') {
    return { name: 'Earthly Hand', tai: 40 };
  }

  // Big Four Winds (大四喜): pungs/kongs of all 4 winds
  const windMelds = hand.melds.filter(
    m => (m.type === 'pung' || m.type === 'kong') && m.tiles[0].suit === 'winds'
  );
  if (windMelds.length === 4) {
    return { name: 'Big Four Winds', tai: 40 };
  }

  // Big Three Dragons (大三元): pungs/kongs of all 3 dragons
  const dragonMelds = hand.melds.filter(
    m => (m.type === 'pung' || m.type === 'kong') && m.tiles[0].suit === 'dragons'
  );
  if (dragonMelds.length === 3) {
    return { name: 'Big Three Dragons', tai: 40 };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main scoring entry point
// ---------------------------------------------------------------------------

/**
 * Score a winning hand. Returns total tai and breakdown.
 * Singapore Mahjong: minimum 1 tai to win, limit typically 40 tai.
 */
export function scoreHand(hand: WinningHand): ScoringResult {
  // Limit hands override everything
  const limit = checkLimitHand(hand);
  if (limit) {
    return { tai: limit.tai, details: [limit] };
  }

  const details: ScoringDetail[] = [];

  details.push(...scoreBonusTiles(hand.bonusTiles));
  details.push(...scoreMelds(hand.melds, hand.seatWind, hand.prevailingWind));
  details.push(...scoreHandPatterns(hand));

  const tai = details.reduce((sum, d) => sum + d.tai, 0);

  // Minimum 1 tai to win (chicken hand / 鸡和)
  const finalTai = Math.max(tai, 1);
  if (tai === 0) {
    details.push({ name: 'Minimum Hand (Chicken)', tai: 1 });
  }

  return { tai: finalTai, details };
}
