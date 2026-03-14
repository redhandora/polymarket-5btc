import { describe, it, expect } from 'vitest';
import { evaluateEntry, priceBandFilter, computeEdge } from '../src/strategy/entry.js';
import { loadConfig } from '../src/config.js';
import type { OrderBookSnapshot, ProbabilityEstimate } from '../src/types.js';

const config = loadConfig();

function makeBook(bestAsk: number): OrderBookSnapshot {
  return {
    bids: [{ price: bestAsk - 0.01, size: 100 }],
    asks: [{ price: bestAsk, size: 100 }],
    spread: 0.01,
    bestBid: bestAsk - 0.01,
    bestAsk,
    bidDepth: 100,
    askDepth: 100,
  };
}

describe('priceBandFilter', () => {
  it('rejects price at 0.50 (below band)', () => {
    const result = priceBandFilter(0.50, config);
    expect(result.pass).toBe(false);
  });

  it('accepts price at 0.55 (within band)', () => {
    const result = priceBandFilter(0.55, config);
    expect(result.pass).toBe(true);
  });

  it('rejects price at 0.65 (above band)', () => {
    const result = priceBandFilter(0.65, config);
    expect(result.pass).toBe(false);
  });
});

describe('computeEdge', () => {
  it('computes edge correctly', () => {
    // edge = pModel - (marketPrice + fee + slippage)
    // = 0.60 - (0.55 + 0.02 + 0.01) = 0.02
    const edge = computeEdge(0.60, 0.55, config);
    expect(edge).toBeCloseTo(0.02, 4);
  });
});

describe('evaluateEntry', () => {
  it('rejects when edge < threshold', () => {
    const estimate: ProbabilityEstimate = { up: 0.56, down: 0.44 };
    const book = makeBook(0.55); // edge = 0.56 - (0.55 + 0.02 + 0.01) = -0.02
    const decision = evaluateEntry(estimate, book, config);
    expect(decision.enter).toBe(false);
    expect(decision.reason).toContain('edge');
  });

  it('accepts when edge >= threshold', () => {
    const estimate: ProbabilityEstimate = { up: 0.63, down: 0.37 };
    const book = makeBook(0.55); // edge = 0.63 - (0.55 + 0.02 + 0.01) = 0.05
    const decision = evaluateEntry(estimate, book, config);
    expect(decision.enter).toBe(true);
    expect(decision.side).toBe('up');
  });

  it('rejects when price outside band', () => {
    const estimate: ProbabilityEstimate = { up: 0.70, down: 0.30 };
    const book = makeBook(0.70); // outside [0.53, 0.60]
    const decision = evaluateEntry(estimate, book, config);
    expect(decision.enter).toBe(false);
    expect(decision.reason).toContain('outside band');
  });
});
