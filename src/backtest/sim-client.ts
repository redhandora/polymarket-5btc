/**
 * Simulated PolymarketClient for backtesting and paper trading.
 * Implements the PolymarketClient interface without making real orders.
 */

import type { PolymarketClient } from '../market-data/polymarket-client.js';
import type { OrderBookSnapshot } from '../types.js';
import { buildOrderBookSnapshot } from '../market-data/polymarket-client.js';

export interface SimDataProvider {
  /** Return the current simulated price for a market (0–1). */
  getCurrentPrice(marketId: string): number;

  /** Return the marketId for a given window open time (unix ms), or null. */
  getMarketForWindow(windowOpenTime: number): string | null;

  /** Return the initial bankroll. */
  getInitialBankroll(): number;
}

let _orderCounter = 0;

/**
 * Create a simulated PolymarketClient.
 * Orders are immediately "filled" at the current simulated price.
 */
export function createSimClient(
  mode: 'historical' | 'paper',
  dataProvider: SimDataProvider,
): PolymarketClient {
  const prefix = mode === 'paper' ? '[PAPER]' : '[SIM]';

  return {
    async getBalance() {
      return dataProvider.getInitialBankroll();
    },

    async getWindowMarket(windowOpenTime: number) {
      const marketId = dataProvider.getMarketForWindow(windowOpenTime);
      return marketId ? { marketId } : null;
    },

    async getOrderBook(marketId: string): Promise<OrderBookSnapshot> {
      const price = dataProvider.getCurrentPrice(marketId);
      const spread = 0.01;
      const half = spread / 2;
      const bid = Math.max(0.01, price - half);
      const ask = Math.min(0.99, price + half);
      const depth = 1000;

      return buildOrderBookSnapshot(
        [{ price: bid, size: depth }],
        [{ price: ask, size: depth }],
      );
    },

    async placeOrder(params) {
      _orderCounter++;
      const id = `${prefix}-order-${_orderCounter}`;
      return id;
    },

    async isOrderFilled(_orderId: string) {
      return true; // always immediately filled
    },

    async cancelOrder(_orderId: string) {
      // no-op
    },

    async getExecutablePrice(marketId: string, _side: 'buy' | 'sell', _size: number) {
      return dataProvider.getCurrentPrice(marketId);
    },
  };
}
