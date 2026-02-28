/**
 * Wall Building and Dealing for Singapore Mahjong
 *
 * The wall consists of all 148 tiles, shuffled and arranged.
 * Dealing: 13 tiles to each player, +1 extra to dealer (East).
 * Bonus tiles drawn during deal are replaced from the back of the wall.
 * The last 14 tiles form the dead wall (for kong replacements).
 */

import { Tile, createAllTiles, Wind } from './tiles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerHand {
  /** Seat position. */
  seat: Wind;
  /** Non-bonus tiles in hand. */
  handTiles: Tile[];
  /** Bonus tiles set aside (flowers, seasons, animals). */
  bonusTiles: Tile[];
}

export interface GameSetup {
  /** Remaining drawable tiles (the live wall). */
  wall: Tile[];
  /** Dead wall reserved for kong replacements. */
  deadWall: Tile[];
  /** Four players in seat order: East, South, West, North. */
  players: [PlayerHand, PlayerHand, PlayerHand, PlayerHand];
}

// ---------------------------------------------------------------------------
// Shuffle
// ---------------------------------------------------------------------------

/** Fisher-Yates shuffle (in-place). */
function shuffle(tiles: Tile[]): void {
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
}

// ---------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------

/**
 * Build wall, deal tiles, and set up the game.
 *
 * 1. Shuffle all 148 tiles.
 * 2. Reserve last 14 tiles as dead wall.
 * 3. Deal 13 tiles to each player.
 * 4. Deal 1 extra tile to dealer.
 * 5. Replace any bonus tiles in each player's hand from the back of the
 *    live wall, moving bonus tiles to the player's bonusTiles array.
 *
 * @param dealerIndex - Which player index (0-3) is dealer. Defaults to 0.
 *   Dealer always gets seat wind 'east'. Other seats rotate accordingly.
 */
export function dealGame(dealerIndex: number = 0): GameSetup {
  const allTiles = createAllTiles();
  shuffle(allTiles);

  // Reserve dead wall (last 14 tiles)
  const deadWall = allTiles.splice(allTiles.length - 14, 14);

  // Live wall is the remaining tiles
  const wall = allTiles;

  // Seat winds rotate so dealer is always East
  const allSeats: Wind[] = ['east', 'south', 'west', 'north'];
  const players = [0, 1, 2, 3].map((i): PlayerHand => ({
    seat: allSeats[(i - dealerIndex + 4) % 4],
    handTiles: [],
    bonusTiles: [],
  })) as [PlayerHand, PlayerHand, PlayerHand, PlayerHand];

  // Deal 13 tiles to each player (4 tiles at a time x3 rounds, then 1 each)
  for (let round = 0; round < 3; round++) {
    for (const player of players) {
      player.handTiles.push(...wall.splice(0, 4));
    }
  }
  for (const player of players) {
    player.handTiles.push(wall.splice(0, 1)[0]);
  }

  // Extra tile to dealer
  players[dealerIndex].handTiles.push(wall.splice(0, 1)[0]);

  // Replace bonus tiles for each player
  for (const player of players) {
    replaceBonusTiles(player, wall);
  }

  return { wall, deadWall, players };
}

/**
 * Move any bonus tiles out of a player's hand and replace them with
 * tiles drawn from the back of the wall. Repeat until no bonus tiles remain
 * in hand (replacement tiles could also be bonus tiles).
 */
function replaceBonusTiles(player: PlayerHand, wall: Tile[]): void {
  let foundBonus = true;
  while (foundBonus && wall.length > 0) {
    foundBonus = false;
    for (let i = player.handTiles.length - 1; i >= 0; i--) {
      if (player.handTiles[i].isBonus) {
        // Move bonus tile aside
        player.bonusTiles.push(player.handTiles[i]);
        // Replace from back of wall
        const replacement = wall.pop();
        if (replacement) {
          player.handTiles[i] = replacement;
        } else {
          // Wall exhausted (shouldn't happen in normal play)
          player.handTiles.splice(i, 1);
        }
        foundBonus = true;
      }
    }
  }
}

/**
 * Draw a replacement tile from the dead wall (used after declaring a kong).
 * Returns the tile or null if the dead wall is exhausted.
 */
export function drawFromDeadWall(deadWall: Tile[]): Tile | null {
  return deadWall.pop() ?? null;
}
