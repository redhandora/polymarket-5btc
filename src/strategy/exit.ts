import type { TradingConfig } from '../config.js';
import type { WindowInfo } from '../types.js';

export interface StopCheckResult {
  shouldExit: boolean;
  reason: string | null;
}

/**
 * Evaluate whether to exit a position early during the stop-check window.
 *
 * Triggers when BOTH conditions are met:
 * 1. Adverse price move >= stopAdverseMove
 * 2. Edge has degraded by >= stopEdgeDelta from entry edge
 */
export function evaluateStop(
  now: number,
  window: WindowInfo,
  entryPrice: number,
  currentPrice: number,
  entryEdge: number,
  currentEdge: number,
  config: TradingConfig,
): StopCheckResult {
  const elapsed = (now - window.openTime) / 1000;

  // Only check during the stop window
  if (elapsed < config.stopWindowStartSec || elapsed > config.stopWindowEndSec) {
    return { shouldExit: false, reason: null };
  }

  const adverseMove = entryPrice - currentPrice; // positive = price moved against us
  const edgeDelta = entryEdge - currentEdge;

  const adverseTriggered = adverseMove >= config.stopAdverseMove;
  const edgeTriggered = edgeDelta >= config.stopEdgeDelta;

  if (adverseTriggered && edgeTriggered) {
    return {
      shouldExit: true,
      reason: `stop: adverse move ${adverseMove.toFixed(4)} >= ${config.stopAdverseMove}, edge degraded ${edgeDelta.toFixed(4)} >= ${config.stopEdgeDelta}`,
    };
  }

  return { shouldExit: false, reason: null };
}
