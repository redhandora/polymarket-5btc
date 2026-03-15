import { describe, it, expect } from 'vitest';
import { evaluateStop, evaluateTokenStop } from '../src/strategy/exit.js';
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

describe('evaluateStop', () => {
  it('triggers stop when both conditions met in stop window', () => {
    const window = makeWindow(0);
    const now = 160_000; // 160s into window (within 150-180)
    const result = evaluateStop(
      now, window,
      0.55,  // entry price
      0.45,  // current price (adverse move = 0.10 >= 0.08)
      0.05,  // entry edge
      0.01,  // current edge (delta = 0.04 >= 0.03)
      config,
    );
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toContain('stop');
  });

  it('does not trigger when only adverse move met', () => {
    const window = makeWindow(0);
    const now = 160_000;
    const result = evaluateStop(
      now, window,
      0.55, 0.45,  // adverse move = 0.10 >= 0.08
      0.05, 0.04,  // edge delta = 0.01 < 0.03
      config,
    );
    expect(result.shouldExit).toBe(false);
  });

  it('does not trigger when only edge degradation met', () => {
    const window = makeWindow(0);
    const now = 160_000;
    const result = evaluateStop(
      now, window,
      0.55, 0.52,  // adverse move = 0.03 < 0.08
      0.05, 0.01,  // edge delta = 0.04 >= 0.03
      config,
    );
    expect(result.shouldExit).toBe(false);
  });

  it('does not trigger outside stop window', () => {
    const window = makeWindow(0);
    const now = 100_000; // 100s — before stop window
    const result = evaluateStop(
      now, window,
      0.55, 0.45,
      0.05, 0.01,
      config,
    );
    expect(result.shouldExit).toBe(false);
  });
});

describe('evaluateTokenStop', () => {
  it('triggers stop for up side when token drops enough', () => {
    const result = evaluateTokenStop('up', 0.55, 0.49, config);
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toContain('token stop');
  });

  it('does not trigger for up side when drop is small', () => {
    const result = evaluateTokenStop('up', 0.55, 0.52, config);
    expect(result.shouldExit).toBe(false);
  });

  it('triggers stop for down side when token rises enough', () => {
    const result = evaluateTokenStop('down', 0.45, 0.51, config);
    expect(result.shouldExit).toBe(true);
  });

  it('does not trigger for down side when rise is small', () => {
    const result = evaluateTokenStop('down', 0.45, 0.48, config);
    expect(result.shouldExit).toBe(false);
  });

  it('triggers at exact threshold', () => {
    // stopTokenRetracement = 0.05, entry = 0.55, current = 0.50 → retracement = 0.05
    const result = evaluateTokenStop('up', 0.55, 0.50, config);
    expect(result.shouldExit).toBe(true);
  });
});
