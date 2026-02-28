/**
 * Payment Calculation for Singapore Mahjong
 *
 * Standard SG tournament doubling table:
 *   1 tai = base, 2 tai = 2×base, 3 tai = 4×base, ...
 *   Formula: base × 2^(tai-1), capped at taiCap.
 *
 * Self-draw (zi mo): all 3 losers pay the winner.
 * Discard win + shooter-pays: discarder pays full 3× amount.
 * Draw: no payments.
 */

import { GameResult, PaymentConfig, PaymentResult } from './game-types';

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  base: 0.20,
  taiCap: 5,
  shooterPays: true,
};

// ---------------------------------------------------------------------------
// Payment Calculation
// ---------------------------------------------------------------------------

/**
 * Convert a tai count to a dollar amount per loser.
 * Uses doubling: base × 2^(effectiveTai - 1), capped at taiCap.
 */
export function taiToAmount(tai: number, config: PaymentConfig): number {
  const effectiveTai = Math.min(Math.max(tai, 1), config.taiCap);
  return config.base * Math.pow(2, effectiveTai - 1);
}

/**
 * Calculate payment deltas for a completed round.
 *
 * - Win by self-draw: all 3 losers each pay the winner.
 * - Win by discard + shooterPays: discarder pays 3× per-loser amount.
 * - Win by discard + !shooterPays: discarder pays 1× per-loser amount.
 * - Draw: no payments.
 *
 * Returns deltas that always sum to zero.
 */
export function calculatePayments(
  result: GameResult,
  config: PaymentConfig,
): PaymentResult {
  const deltas: [number, number, number, number] = [0, 0, 0, 0];

  if (result.type === 'draw' || result.winnerIndex === undefined || !result.scoring) {
    return { deltas, perLoserAmount: 0, winnerTotal: 0 };
  }

  const tai = result.scoring.tai;
  const perLoserAmount = taiToAmount(tai, config);
  const winnerIdx = result.winnerIndex;
  const isSelfDrawn = result.loserIndex === undefined;

  if (isSelfDrawn) {
    // Self-draw: each of the 3 other players pays
    for (let i = 0; i < 4; i++) {
      if (i === winnerIdx) {
        deltas[i] = perLoserAmount * 3;
      } else {
        deltas[i] = -perLoserAmount;
      }
    }
  } else if (config.shooterPays) {
    // Shooter pays for all 3 losers
    const shooterIdx = result.loserIndex!;
    deltas[winnerIdx] = perLoserAmount * 3;
    deltas[shooterIdx] = -perLoserAmount * 3;
  } else {
    // Only discarder pays their share
    const shooterIdx = result.loserIndex!;
    deltas[winnerIdx] = perLoserAmount;
    deltas[shooterIdx] = -perLoserAmount;
  }

  const winnerTotal = deltas[winnerIdx];
  return { deltas, perLoserAmount, winnerTotal };
}
