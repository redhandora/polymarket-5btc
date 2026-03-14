import { describe, it, expect } from 'vitest';
import { createRiskState, checkRisk, computePositionSize, recordTradeResult, resetDaily } from '../src/risk/risk-manager.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const BANKROLL = 10_000;

describe('checkRisk', () => {
  it('halts after 3 consecutive losses', () => {
    const state = createRiskState(BANKROLL);
    recordTradeResult(state, -10);
    recordTradeResult(state, -10);
    recordTradeResult(state, -10);
    const check = checkRisk(state, config);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('consecutive losses');
  });

  it('resets consecutive losses on a win', () => {
    const state = createRiskState(BANKROLL);
    recordTradeResult(state, -10);
    recordTradeResult(state, -10);
    recordTradeResult(state, 20); // win resets
    const check = checkRisk(state, config);
    expect(check.allowed).toBe(true);
  });

  it('halts when daily loss >= 3%', () => {
    const state = createRiskState(BANKROLL);
    // 3% of 10000 = 300
    recordTradeResult(state, -150);
    recordTradeResult(state, -150);
    // Reset consecutive to avoid that trigger
    state.consecutiveLosses = 0;
    const check = checkRisk(state, config);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('daily loss');
  });

  it('blocks when position already active', () => {
    const state = createRiskState(BANKROLL);
    state.activePosition = true;
    const check = checkRisk(state, config);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('position already active');
  });

  it('halts when total drawdown >= maxTotalLossPct', () => {
    const state = createRiskState(BANKROLL);
    // 20% of 10000 = 2000
    state.totalBankroll = BANKROLL * (1 - config.maxTotalLossPct);
    state.consecutiveLosses = 0;
    const check = checkRisk(state, config);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('total drawdown');
  });

  it('halts when daily trade count >= maxDailyTrades', () => {
    const state = createRiskState(BANKROLL);
    state.dailyTrades = config.maxDailyTrades; // 288 = all 5-min windows in a day
    const check = checkRisk(state, config);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('daily trade limit');
  });
});

describe('computePositionSize', () => {
  it('computes correct position size', () => {
    const state = createRiskState(BANKROLL);
    // 0.75% of 10000 = 75
    const size = computePositionSize(state, config);
    expect(size).toBe(75);
  });

  it('shrinks position size after losses', () => {
    const state = createRiskState(BANKROLL);
    recordTradeResult(state, -500);
    state.consecutiveLosses = 0;
    const size = computePositionSize(state, config);
    expect(size).toBe(9500 * config.perTradeRiskPct);
  });
});

describe('recordTradeResult', () => {
  it('tracks cumulative daily PnL', () => {
    const state = createRiskState(BANKROLL);
    recordTradeResult(state, 50);
    recordTradeResult(state, -20);
    expect(state.dailyPnl).toBe(30);
  });

  it('increments consecutive losses', () => {
    const state = createRiskState(BANKROLL);
    recordTradeResult(state, -10);
    recordTradeResult(state, -10);
    expect(state.consecutiveLosses).toBe(2);
  });

  it('resets consecutive losses on profit', () => {
    const state = createRiskState(BANKROLL);
    recordTradeResult(state, -10);
    recordTradeResult(state, -10);
    recordTradeResult(state, 10);
    expect(state.consecutiveLosses).toBe(0);
  });

  it('updates totalBankroll with pnl', () => {
    const state = createRiskState(BANKROLL);
    recordTradeResult(state, -200);
    expect(state.totalBankroll).toBe(9800);
    recordTradeResult(state, 100);
    expect(state.totalBankroll).toBe(9900);
  });

  it('increments dailyTrades', () => {
    const state = createRiskState(BANKROLL);
    recordTradeResult(state, 10);
    recordTradeResult(state, -5);
    expect(state.dailyTrades).toBe(2);
  });
});

describe('resetDaily', () => {
  it('resets dailyPnl, consecutiveLosses, and dailyTrades', () => {
    const state = createRiskState(BANKROLL);
    recordTradeResult(state, -100);
    recordTradeResult(state, -100);
    resetDaily(state);
    expect(state.dailyPnl).toBe(0);
    expect(state.consecutiveLosses).toBe(0);
    expect(state.dailyTrades).toBe(0);
  });

  it('preserves totalBankroll across daily reset', () => {
    const state = createRiskState(BANKROLL);
    recordTradeResult(state, -500);
    resetDaily(state);
    expect(state.totalBankroll).toBe(9500);
  });
});
