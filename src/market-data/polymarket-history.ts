/**
 * Historical data fetchers for backtesting.
 * - Polymarket Data API: 5-min price history for a market
 * - Binance klines: BTC/USDT price at a specific timestamp
 */

const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';
const BINANCE_API = 'https://api.binance.com';

export interface PricePoint {
  t: number; // unix seconds
  p: number; // price [0, 1]
}

/**
 * Fetch price history for a Polymarket condition ID.
 * Returns one data point per minute (fidelity=1) within the time range.
 */
export async function fetchHistoricalPrices(
  marketId: string,
  startTs: number, // unix seconds
  endTs: number,   // unix seconds
): Promise<PricePoint[]> {
  const url =
    `${POLYMARKET_DATA_API}/prices/history` +
    `?market=${encodeURIComponent(marketId)}` +
    `&startTs=${startTs}&endTs=${endTs}` +
    `&interval=1m&fidelity=1`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Polymarket Data API error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json() as { history?: Array<{ t: number; p: number }> };
  return (json.history ?? []).map((pt) => ({ t: pt.t, p: pt.p }));
}

/**
 * Fetch the BTC/USDT close price for the 5-min candle containing `ts`.
 * Uses Binance klines API.
 */
export async function fetchBtcPriceAt(ts: number): Promise<number> {
  const startMs = ts * 1000;
  const endMs = startMs + 300_000; // 5-min window
  const url =
    `${BINANCE_API}/api/v3/klines` +
    `?symbol=BTCUSDT&interval=5m` +
    `&startTime=${startMs}&endTime=${endMs}&limit=1`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance API error ${res.status}: ${await res.text()}`);
  }

  const klines = await res.json() as Array<[string, string, string, string, string, ...unknown[]]>;
  if (!klines.length) {
    throw new Error(`No Binance kline data for ts=${ts}`);
  }

  // kline format: [openTime, open, high, low, close, ...]
  return parseFloat(klines[0][4]); // close price
}
