import type { TradingConfig } from '../config.js';
import type { OrderBookSnapshot, WindowInfo } from '../types.js';

export interface FilterResult {
  pass: boolean;
  reason: string | null;
}

function fail(reason: string): FilterResult {
  return { pass: false, reason };
}

const PASS: FilterResult = { pass: true, reason: null };

/** Reject if spread exceeds maxSpread. */
export function spreadFilter(book: OrderBookSnapshot, config: TradingConfig): FilterResult {
  if (book.spread > config.maxSpread) {
    return fail(`spread ${book.spread.toFixed(4)} > max ${config.maxSpread}`);
  }
  return PASS;
}

/** Reject if depth on the target side is less than minDepthMultiplier × order size. */
export function depthFilter(
  book: OrderBookSnapshot,
  orderSize: number,
  config: TradingConfig,
): FilterResult {
  const minDepth = orderSize * config.minDepthMultiplier;
  // Check both sides — we need liquidity to enter and exit
  if (book.bidDepth < minDepth) {
    return fail(`bid depth ${book.bidDepth.toFixed(2)} < required ${minDepth.toFixed(2)}`);
  }
  if (book.askDepth < minDepth) {
    return fail(`ask depth ${book.askDepth.toFixed(2)} < required ${minDepth.toFixed(2)}`);
  }
  return PASS;
}

/** Reject if not enough time remains until settlement. */
export function timeToSettlementFilter(
  now: number,
  window: WindowInfo,
  config: TradingConfig,
): FilterResult {
  const remaining = (window.closeTime - now) / 1000;
  if (remaining < config.minTimeToSettlementSec) {
    return fail(`time to settlement ${remaining.toFixed(0)}s < min ${config.minTimeToSettlementSec}s`);
  }
  return PASS;
}

/** Reject if we're outside the entry time window. */
export function entryTimeFilter(now: number, window: WindowInfo, config: TradingConfig): FilterResult {
  const elapsed = (now - window.openTime) / 1000;
  if (elapsed < config.entryWindowStartSec) {
    return fail(`too early: ${elapsed.toFixed(0)}s < ${config.entryWindowStartSec}s`);
  }
  if (elapsed > config.entryWindowEndSec) {
    return fail(`too late: ${elapsed.toFixed(0)}s > ${config.entryWindowEndSec}s`);
  }
  return PASS;
}

/** Run all no-trade filters. Returns the first failure or PASS. */
export function runFilters(
  now: number,
  window: WindowInfo,
  book: OrderBookSnapshot,
  orderSize: number,
  config: TradingConfig,
): FilterResult {
  const checks = [
    entryTimeFilter(now, window, config),
    spreadFilter(book, config),
    depthFilter(book, orderSize, config),
    timeToSettlementFilter(now, window, config),
  ];
  for (const result of checks) {
    if (!result.pass) return result;
  }
  return PASS;
}
