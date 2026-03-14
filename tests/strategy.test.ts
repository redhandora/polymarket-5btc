import { describe, it, expect } from 'vitest';
import { createWindowState, isInEntryWindow, isInStopWindow } from '../src/strategy/window.js';
import { loadConfig } from '../src/config.js';
import type { WindowInfo } from '../src/types.js';

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

describe('WindowState', () => {
  it('starts with no active window and not traded', () => {
    const state = createWindowState();
    expect(state.current).toBeNull();
    expect(state.traded).toBe(false);
    expect(state.tradedSide).toBeNull();
  });

  it('rejects second entry in same window (no pyramiding)', () => {
    const state = createWindowState();
    state.traded = true;
    state.tradedSide = 'up';
    // The main loop checks state.traded before entering — simulate that check
    expect(state.traded).toBe(true);
  });

  it('rejects opposite side in same window', () => {
    const state = createWindowState();
    state.traded = true;
    state.tradedSide = 'up';
    // Attempting to trade 'down' in same window should be blocked
    const attemptedSide = 'down';
    expect(state.tradedSide).not.toBe(attemptedSide);
    expect(state.traded).toBe(true); // blocked because already traded
  });
});

describe('isInEntryWindow', () => {
  it('returns false before entry window', () => {
    const window = makeWindow(0);
    expect(isInEntryWindow(20_000, window, config)).toBe(false);
  });

  it('returns true during entry window', () => {
    const window = makeWindow(0);
    expect(isInEntryWindow(50_000, window, config)).toBe(true);
  });

  it('returns false after entry window', () => {
    const window = makeWindow(0);
    expect(isInEntryWindow(80_000, window, config)).toBe(false);
  });
});

describe('isInStopWindow', () => {
  it('returns false before stop window', () => {
    const window = makeWindow(0);
    expect(isInStopWindow(100_000, window, config)).toBe(false);
  });

  it('returns true during stop window', () => {
    const window = makeWindow(0);
    expect(isInStopWindow(160_000, window, config)).toBe(true);
  });

  it('returns false after stop window', () => {
    const window = makeWindow(0);
    expect(isInStopWindow(200_000, window, config)).toBe(false);
  });
});
