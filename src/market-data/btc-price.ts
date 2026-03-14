import type { TradingConfig } from '../config.js';

export interface BtcPriceFeed {
  getPrice(): Promise<number>;
}

export function createBtcPriceFeed(config: TradingConfig): BtcPriceFeed {
  return {
    async getPrice(): Promise<number> {
      const res = await fetch(config.btcPriceUrl);
      if (!res.ok) {
        throw new Error(`BTC price fetch failed: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as { price: string };
      const price = parseFloat(data.price);
      if (Number.isNaN(price)) {
        throw new Error(`Invalid BTC price response`);
      }
      return price;
    },
  };
}
