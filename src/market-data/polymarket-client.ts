import type { TradingConfig } from '../config.js';
import type { OrderBookSnapshot, WindowInfo } from '../types.js';

export interface PolymarketClient {
  /** Fetch the USDC balance available in the Polymarket account. */
  getBalance(): Promise<number>;

  /** Fetch the active 5-min BTC market for the given window open time. */
  getWindowMarket(windowOpenTime: number): Promise<{ marketId: string } | null>;

  /** Fetch the current order book for a market's "up" token. */
  getOrderBook(marketId: string): Promise<OrderBookSnapshot>;

  /** Place a post-only limit order. Returns an order ID. */
  placeOrder(params: {
    marketId: string;
    side: 'buy' | 'sell';
    price: number;
    size: number;
    ttlMs: number;
  }): Promise<string>;

  /** Check if an order has been filled. */
  isOrderFilled(orderId: string): Promise<boolean>;

  /** Cancel an open order. */
  cancelOrder(orderId: string): Promise<void>;

  /** Get the current executable price for a side. */
  getExecutablePrice(marketId: string, side: 'buy' | 'sell', size: number): Promise<number | null>;
}

export function createPolymarketClient(config: TradingConfig): PolymarketClient {
  // This is a structural wrapper. Real implementation would use @polymarket/clob-client.
  // For now, methods throw so the system compiles and tests can mock this.

  function notConfigured(): never {
    throw new Error(
      'Polymarket client not configured — set POLYMARKET_API_KEY and related env vars',
    );
  }

  return {
    async getBalance() {
      notConfigured();
    },

    async getWindowMarket(_windowOpenTime: number) {
      notConfigured();
    },

    async getOrderBook(_marketId: string) {
      notConfigured();
    },

    async placeOrder(_params) {
      notConfigured();
    },

    async isOrderFilled(_orderId: string) {
      notConfigured();
    },

    async cancelOrder(_orderId: string) {
      notConfigured();
    },

    async getExecutablePrice(_marketId, _side, _size) {
      notConfigured();
    },
  };
}

/** Build an OrderBookSnapshot from raw bid/ask arrays. */
export function buildOrderBookSnapshot(
  bids: { price: number; size: number }[],
  asks: { price: number; size: number }[],
  depthLevels = 5,
): OrderBookSnapshot {
  const bestBid = bids.length > 0 ? bids[0].price : 0;
  const bestAsk = asks.length > 0 ? asks[0].price : 1;
  const spread = bestAsk - bestBid;

  const bidDepth = bids.slice(0, depthLevels).reduce((sum, l) => sum + l.size, 0);
  const askDepth = asks.slice(0, depthLevels).reduce((sum, l) => sum + l.size, 0);

  return { bids, asks, spread, bestBid, bestAsk, bidDepth, askDepth };
}
