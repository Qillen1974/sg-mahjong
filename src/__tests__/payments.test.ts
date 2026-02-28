import { describe, it, expect } from 'vitest';
import { taiToAmount, calculatePayments, DEFAULT_PAYMENT_CONFIG } from '../payments';
import { GameResult, PaymentConfig } from '../game-types';

// ---------------------------------------------------------------------------
// taiToAmount
// ---------------------------------------------------------------------------

describe('taiToAmount', () => {
  const config = DEFAULT_PAYMENT_CONFIG; // base=0.20, taiCap=5

  it('should return base for 1 tai', () => {
    expect(taiToAmount(1, config)).toBeCloseTo(0.20);
  });

  it('should double for each tai', () => {
    expect(taiToAmount(2, config)).toBeCloseTo(0.40);
    expect(taiToAmount(3, config)).toBeCloseTo(0.80);
    expect(taiToAmount(4, config)).toBeCloseTo(1.60);
    expect(taiToAmount(5, config)).toBeCloseTo(3.20);
  });

  it('should cap at taiCap', () => {
    expect(taiToAmount(6, config)).toBeCloseTo(3.20); // capped at 5
    expect(taiToAmount(10, config)).toBeCloseTo(3.20);
    expect(taiToAmount(40, config)).toBeCloseTo(3.20);
  });

  it('should work with custom config', () => {
    const custom: PaymentConfig = { base: 1.00, taiCap: 3, shooterPays: true };
    expect(taiToAmount(1, custom)).toBeCloseTo(1.00);
    expect(taiToAmount(2, custom)).toBeCloseTo(2.00);
    expect(taiToAmount(3, custom)).toBeCloseTo(4.00);
    expect(taiToAmount(4, custom)).toBeCloseTo(4.00); // capped at 3
  });
});

// ---------------------------------------------------------------------------
// calculatePayments
// ---------------------------------------------------------------------------

describe('calculatePayments', () => {
  const config = DEFAULT_PAYMENT_CONFIG;

  it('should return zero deltas for a draw', () => {
    const result: GameResult = { type: 'draw' };
    const payments = calculatePayments(result, config);

    expect(payments.deltas).toEqual([0, 0, 0, 0]);
    expect(payments.perLoserAmount).toBe(0);
    expect(payments.winnerTotal).toBe(0);
  });

  it('should calculate self-draw payments (all 3 losers pay)', () => {
    const result: GameResult = {
      type: 'win',
      winnerIndex: 0,
      scoring: { tai: 3, details: [] },
      // loserIndex undefined = self-drawn
    };
    const payments = calculatePayments(result, config);

    // 3 tai = $0.80 per loser
    expect(payments.perLoserAmount).toBeCloseTo(0.80);
    expect(payments.deltas[0]).toBeCloseTo(2.40);  // winner gets 3 × 0.80
    expect(payments.deltas[1]).toBeCloseTo(-0.80);
    expect(payments.deltas[2]).toBeCloseTo(-0.80);
    expect(payments.deltas[3]).toBeCloseTo(-0.80);
    expect(payments.winnerTotal).toBeCloseTo(2.40);
  });

  it('should calculate discard win with shooter-pays', () => {
    const result: GameResult = {
      type: 'win',
      winnerIndex: 2,
      scoring: { tai: 2, details: [] },
      loserIndex: 1, // player 1 discarded
    };
    const payments = calculatePayments(result, config);

    // 2 tai = $0.40 per loser, shooter pays all 3× = $1.20
    expect(payments.perLoserAmount).toBeCloseTo(0.40);
    expect(payments.deltas[0]).toBeCloseTo(0);      // not involved
    expect(payments.deltas[1]).toBeCloseTo(-1.20);   // shooter pays 3×
    expect(payments.deltas[2]).toBeCloseTo(1.20);    // winner gets 3×
    expect(payments.deltas[3]).toBeCloseTo(0);       // not involved
    expect(payments.winnerTotal).toBeCloseTo(1.20);
  });

  it('should calculate discard win without shooter-pays', () => {
    const noShooter: PaymentConfig = { ...config, shooterPays: false };
    const result: GameResult = {
      type: 'win',
      winnerIndex: 0,
      scoring: { tai: 4, details: [] },
      loserIndex: 3,
    };
    const payments = calculatePayments(result, noShooter);

    // 4 tai = $1.60, only discarder pays
    expect(payments.perLoserAmount).toBeCloseTo(1.60);
    expect(payments.deltas[0]).toBeCloseTo(1.60);    // winner gets 1×
    expect(payments.deltas[3]).toBeCloseTo(-1.60);   // only discarder pays
    expect(payments.deltas[1]).toBeCloseTo(0);
    expect(payments.deltas[2]).toBeCloseTo(0);
  });

  it('should handle limit hand (40 tai, capped)', () => {
    const result: GameResult = {
      type: 'win',
      winnerIndex: 1,
      scoring: { tai: 40, details: [{ name: 'Thirteen Orphans', tai: 40 }] },
    };
    const payments = calculatePayments(result, config);

    // 40 tai capped at 5 = $3.20 per loser, self-drawn
    expect(payments.perLoserAmount).toBeCloseTo(3.20);
    expect(payments.winnerTotal).toBeCloseTo(9.60);
  });

  it('deltas should always sum to zero', () => {
    const cases: GameResult[] = [
      { type: 'draw' },
      { type: 'win', winnerIndex: 0, scoring: { tai: 1, details: [] } },
      { type: 'win', winnerIndex: 2, scoring: { tai: 5, details: [] }, loserIndex: 0 },
      { type: 'win', winnerIndex: 3, scoring: { tai: 3, details: [] }, loserIndex: 1 },
    ];

    for (const result of cases) {
      const payments = calculatePayments(result, config);
      const sum = payments.deltas.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(0);
    }
  });
});
