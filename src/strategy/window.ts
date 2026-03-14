import type { WindowInfo } from '../types.js';
import type { TradingConfig } from '../config.js';
import { floorToWindow, nextWindowOpen, windowIdFromEpoch } from '../utils/time.js';

export interface WindowState {
  current: WindowInfo | null;
  traded: boolean;        // already entered a position this window
  tradedSide: 'up' | 'down' | null;
}

export function createWindowState(): WindowState {
  return { current: null, traded: false, tradedSide: null };
}

/**
 * Detect the current 5-min window and return its info.
 * Returns null if we're past the entry deadline for the current window
 * and should wait for the next one.
 */
export function detectWindow(
  now: number,
  config: TradingConfig,
  referencePrice: number,
  marketId: string,
): WindowInfo {
  const openTime = floorToWindow(now);
  return {
    windowId: windowIdFromEpoch(openTime),
    marketId,
    openTime,
    closeTime: openTime + 300_000,
    referencePrice,
  };
}

/** Check if the current time is within the entry window. */
export function isInEntryWindow(now: number, window: WindowInfo, config: TradingConfig): boolean {
  const elapsed = (now - window.openTime) / 1000;
  return elapsed >= config.entryWindowStartSec && elapsed <= config.entryWindowEndSec;
}

/** Check if the current time is within the stop-check window. */
export function isInStopWindow(now: number, window: WindowInfo, config: TradingConfig): boolean {
  const elapsed = (now - window.openTime) / 1000;
  return elapsed >= config.stopWindowStartSec && elapsed <= config.stopWindowEndSec;
}

/** Milliseconds until the entry window opens. Returns 0 if already in or past it. */
export function msUntilEntryWindow(now: number, window: WindowInfo, config: TradingConfig): number {
  const entryStart = window.openTime + config.entryWindowStartSec * 1000;
  return Math.max(0, entryStart - now);
}
