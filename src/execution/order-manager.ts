import type { TradingConfig } from '../config.js';
import type { PolymarketClient } from '../market-data/polymarket-client.js';
import { sleep } from '../utils/time.js';

export interface OrderResult {
  filled: boolean;
  orderId: string | null;
  fillPrice: number | null;
  fillTime: number | null;
}

const EMPTY_RESULT: OrderResult = { filled: false, orderId: null, fillPrice: null, fillTime: null };

/**
 * Attempt to place a post-only order and wait for fill.
 * Retries up to config.maxEntryAttempts times.
 */
export async function attemptEntry(
  client: PolymarketClient,
  marketId: string,
  side: 'buy' | 'sell',
  price: number,
  size: number,
  config: TradingConfig,
): Promise<{ result: OrderResult; attempts: number }> {
  let attempts = 0;

  for (let i = 0; i < config.maxEntryAttempts; i++) {
    attempts++;
    try {
      const orderId = await client.placeOrder({
        marketId,
        side,
        price,
        size,
        ttlMs: config.orderTtlMs,
      });

      // Poll for fill
      const filled = await waitForFill(client, orderId, config.orderTtlMs);
      if (filled) {
        return {
          result: {
            filled: true,
            orderId,
            fillPrice: price,
            fillTime: Date.now(),
          },
          attempts,
        };
      }

      // Not filled — cancel and retry
      await client.cancelOrder(orderId).catch(() => {});
    } catch (err) {
      console.error(`Order attempt ${attempts} failed:`, err);
    }
  }

  return { result: EMPTY_RESULT, attempts };
}

async function waitForFill(
  client: PolymarketClient,
  orderId: string,
  ttlMs: number,
): Promise<boolean> {
  const deadline = Date.now() + ttlMs;
  const pollInterval = 1000;

  while (Date.now() < deadline) {
    const filled = await client.isOrderFilled(orderId);
    if (filled) return true;
    await sleep(Math.min(pollInterval, deadline - Date.now()));
  }

  return false;
}

/** Place an exit order (market/taker). */
export async function placeExitOrder(
  client: PolymarketClient,
  marketId: string,
  side: 'buy' | 'sell',
  price: number,
  size: number,
  config: TradingConfig,
): Promise<OrderResult> {
  try {
    const orderId = await client.placeOrder({
      marketId,
      side,
      price,
      size,
      ttlMs: config.orderTtlMs,
    });
    return { filled: true, orderId, fillPrice: price, fillTime: Date.now() };
  } catch (err) {
    console.error('Exit order failed:', err);
    return EMPTY_RESULT;
  }
}
