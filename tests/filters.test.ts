import { describe, it, expect } from 'vitest';
import { spreadFilter, depthFilter, timeToSettlementFilter, entryTimeFilter, runFilters } from '../src/strategy/filters.js';
import { loadConfig } from '../src/config.js';
import type { OrderBookSnapshot, WindowInfo } from '../src/types.js';

const config = loadConfig();

function makeWindow(openTime: number): WindowInfo {
  return {
    windowId: 'test',
    marketId: 'test-market',
    openTime,
    closeTime: openTime + 300_000,
    referencePrice: 50000,
  };
}

function makeBook(overrides: Partial<OrderBookSnapshot> = {}): OrderBookSnapshot {
  return {
    bids: [{ price: 0.54, size: 100 }],
    asks: [{ price: 0.55, size: 100 }],
    spread: 0.01,
    bestBid: 0.54,
    bestAsk: 0.55,
    bidDepth: 100,
    askDepth: 100,
    ...overrides,
  };
}

describe('entryTimeFilter', () => {
  it('rejects at 30s (too early)', () => {
    const window = makeWindow(0);
    const result = entryTimeFilter(30_000, window, config);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('too early');
  });

  it('accepts at 50s', () => {
    const window = makeWindow(0);
    const result = entryTimeFilter(50_000, window, config);
    expect(result.pass).toBe(true);
  });

  it('rejects at 80s (too late)', () => {
    const window = makeWindow(0);
    const result = entryTimeFilter(80_000, window, config);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('too late');
  });
});

describe('spreadFilter', () => {
  it('rejects spread of 0.025', () => {
    const book = makeBook({ spread: 0.025 });
    const result = spreadFilter(book, config);
    expect(result.pass).toBe(false);
  });

  it('accepts spread of 0.015', () => {
    const book = makeBook({ spread: 0.015 });
    const result = spreadFilter(book, config);
    expect(result.pass).toBe(true);
  });
});

describe('depthFilter', () => {
  const orderSize = 10;

  it('rejects when depth < 3x order size', () => {
    const book = makeBook({ bidDepth: 20, askDepth: 20 });
    const result = depthFilter(book, orderSize, config);
    expect(result.pass).toBe(false);
  });

  it('accepts when depth >= 3x order size', () => {
    const book = makeBook({ bidDepth: 50, askDepth: 50 });
    const result = depthFilter(book, orderSize, config);
    expect(result.pass).toBe(true);
  });
});

describe('timeToSettlementFilter', () => {
  it('rejects when 60s remaining', () => {
    const window = makeWindow(0);
    const now = 240_000; // 60s remaining
    const result = timeToSettlementFilter(now, window, config);
    expect(result.pass).toBe(false);
  });

  it('accepts when 80s remaining', () => {
    const window = makeWindow(0);
    const now = 220_000; // 80s remaining
    const result = timeToSettlementFilter(now, window, config);
    expect(result.pass).toBe(true);
  });
});

describe('runFilters', () => {
  it('passes when all filters pass', () => {
    const window = makeWindow(0);
    const book = makeBook();
    const result = runFilters(50_000, window, book, 10, config);
    expect(result.pass).toBe(true);
  });

  it('fails on first failing filter', () => {
    const window = makeWindow(0);
    const book = makeBook({ spread: 0.05 });
    const result = runFilters(50_000, window, book, 10, config);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('spread');
  });
});
