import type { TradingConfig } from '../config.js';

export interface RiskState {
  dailyPnl: number;
  consecutiveLosses: number;
  activePosition: boolean;
  totalBankroll: number;
  initialBankroll: number;
  dailyTrades: number;
}

export function createRiskState(totalBankroll: number): RiskState {
  return {
    dailyPnl: 0,
    consecutiveLosses: 0,
    activePosition: false,
    totalBankroll,
    initialBankroll: totalBankroll,
    dailyTrades: 0,
  };
}

export interface RiskCheck {
  allowed: boolean;
  reason: string | null;
}

/** Check if trading is allowed given current risk state. */
export function checkRisk(state: RiskState, config: TradingConfig): RiskCheck {
  if (state.activePosition) {
    return { allowed: false, reason: 'position already active' };
  }

  if (state.consecutiveLosses >= config.maxConsecutiveLosses) {
    return {
      allowed: false,
      reason: `consecutive losses ${state.consecutiveLosses} >= max ${config.maxConsecutiveLosses}`,
    };
  }

  const dailyLossPct = Math.abs(Math.min(0, state.dailyPnl)) / state.totalBankroll;
  if (dailyLossPct >= config.dailyMaxLossPct) {
    return {
      allowed: false,
      reason: `daily loss ${(dailyLossPct * 100).toFixed(2)}% >= max ${(config.dailyMaxLossPct * 100).toFixed(2)}%`,
    };
  }

  const totalLossPct = (state.initialBankroll - state.totalBankroll) / state.initialBankroll;
  if (totalLossPct >= config.maxTotalLossPct) {
    return {
      allowed: false,
      reason: `total drawdown ${(totalLossPct * 100).toFixed(1)}% >= max ${(config.maxTotalLossPct * 100).toFixed(1)}%`,
    };
  }

  if (state.dailyTrades >= config.maxDailyTrades) {
    return {
      allowed: false,
      reason: `daily trade limit ${config.maxDailyTrades} reached`,
    };
  }

  return { allowed: true, reason: null };
}

/** Compute position size based on per-trade risk. */
export function computePositionSize(state: RiskState, config: TradingConfig): number {
  return state.totalBankroll * config.perTradeRiskPct;
}

/** Update risk state after a trade settles. */
export function recordTradeResult(state: RiskState, pnl: number): void {
  state.dailyPnl += pnl;
  state.totalBankroll += pnl;
  state.dailyTrades++;
  state.activePosition = false;

  if (pnl < 0) {
    state.consecutiveLosses++;
  } else {
    state.consecutiveLosses = 0;
  }
}

/** Reset daily counters (call at start of each trading day). */
export function resetDaily(state: RiskState): void {
  state.dailyPnl = 0;
  state.consecutiveLosses = 0;
  state.dailyTrades = 0;
}
