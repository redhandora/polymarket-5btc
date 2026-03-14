const WINDOW_DURATION_MS = 300_000; // 5 minutes

/** Round a timestamp down to the nearest 5-minute boundary (UTC). */
export function floorToWindow(epochMs: number): number {
  return Math.floor(epochMs / WINDOW_DURATION_MS) * WINDOW_DURATION_MS;
}

/** Get the next 5-minute window open time after the given timestamp. */
export function nextWindowOpen(epochMs: number): number {
  return floorToWindow(epochMs) + WINDOW_DURATION_MS;
}

/** Seconds elapsed since the start of the current 5-minute window. */
export function secondsIntoWindow(epochMs: number): number {
  const windowStart = floorToWindow(epochMs);
  return (epochMs - windowStart) / 1000;
}

/** Seconds remaining until the window closes. */
export function secondsUntilClose(epochMs: number): number {
  const windowEnd = floorToWindow(epochMs) + WINDOW_DURATION_MS;
  return (windowEnd - epochMs) / 1000;
}

/** ISO string for a window ID from its open time. */
export function windowIdFromEpoch(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Sleep for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
