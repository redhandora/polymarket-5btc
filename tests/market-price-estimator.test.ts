import { describe, it, expect } from 'vitest';
import { createMarketPriceEstimator } from '../src/signal/market-price-estimator.js';
import type { WindowInfo } from '../src/types.js';

function makeWindow(): WindowInfo {
  return {
    windowId: '2026-03-14T12:05:00Z',
    marketId: 'test-condition-id',
    openTime: Date.now(),
    closeTime: Date.now() + 300_000,
    referencePrice: 65000,
  };
}

describe('MarketPriceEstimator', () => {
  it('returns 50/50 when tokenPrice is 0.50 (no signal)', async () => {
    const est = createMarketPriceEstimator();
    est.setTokenPrice(0.50);
    const result = await est.estimate(makeWindow(), 65000);
    expect(result.up).toBeCloseTo(0.50, 4);
    expect(result.down).toBeCloseTo(0.50, 4);
  });

  it('returns bullish signal when tokenPrice > 0.50', async () => {
    const est = createMarketPriceEstimator();
    est.setTokenPrice(0.55);
    const result = await est.estimate(makeWindow(), 65000);
    expect(result.up).toBeGreaterThan(0.50);
    expect(result.down).toBeLessThan(0.50);
  });

  it('returns bearish signal when tokenPrice < 0.50', async () => {
    const est = createMarketPriceEstimator();
    est.setTokenPrice(0.45);
    const result = await est.estimate(makeWindow(), 65000);
    expect(result.up).toBeLessThan(0.50);
    expect(result.down).toBeGreaterThan(0.50);
  });

  it('clamps nudge to ±0.15', async () => {
    const est = createMarketPriceEstimator(5); // high sensitivity
    est.setTokenPrice(0.80); // (0.80 - 0.50) * 5 = 1.5, clamped to 0.15
    const result = await est.estimate(makeWindow(), 65000);
    expect(result.up).toBeCloseTo(0.65, 4);
    expect(result.down).toBeCloseTo(0.35, 4);

    est.setTokenPrice(0.20); // (0.20 - 0.50) * 5 = -1.5, clamped to -0.15
    const resultDown = await est.estimate(makeWindow(), 65000);
    expect(resultDown.up).toBeCloseTo(0.35, 4);
    expect(resultDown.down).toBeCloseTo(0.65, 4);
  });

  it('produces deviation from 0.50 when token price is 0.55', async () => {
    const est = createMarketPriceEstimator();
    est.setTokenPrice(0.55);
    const result = await est.estimate(makeWindow(), 65000);
    // With default sensitivity, up should be > 0.50
    expect(result.up).toBeGreaterThan(0.50);
  });

  it('ignores currentBtcPrice parameter', async () => {
    const est = createMarketPriceEstimator();
    est.setTokenPrice(0.55);
    const r1 = await est.estimate(makeWindow(), 60000);
    const r2 = await est.estimate(makeWindow(), 70000);
    expect(r1.up).toEqual(r2.up);
    expect(r1.down).toEqual(r2.down);
  });

  it('respects custom sensitivity', async () => {
    const est1 = createMarketPriceEstimator(1);
    const est2 = createMarketPriceEstimator(2);
    est1.setTokenPrice(0.55);
    est2.setTokenPrice(0.55);
    const r1 = await est1.estimate(makeWindow(), 65000);
    const r2 = await est2.estimate(makeWindow(), 65000);
    // sensitivity=2 should produce a larger nudge
    expect(r2.up - 0.5).toBeCloseTo((r1.up - 0.5) * 2, 4);
  });
});
