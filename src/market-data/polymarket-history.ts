/**
 * Historical data fetchers for backtesting.
 * - Polymarket CLOB API: 5-min price history for a market token
 * - Binance klines: BTC/USDT price at a specific timestamp
 */

import { fetch } from '../utils/fetch.js';

const POLYMARKET_CLOB_API = 'https://clob.polymarket.com';
const BINANCE_API = 'https://api.binance.com';

export interface PricePoint {
  t: number; // unix seconds
  p: number; // price [0, 1]
}

/**
 * Fetch price history for a Polymarket token ID (clobTokenId, not conditionId).
 * Uses CLOB API prices-history endpoint.
 */
export async function fetchHistoricalPrices(
  tokenId: string,
  startTs: number, // unix seconds
  endTs: number,   // unix seconds
): Promise<PricePoint[]> {
  const url =
    `${POLYMARKET_CLOB_API}/prices-history` +
    `?market=${encodeURIComponent(tokenId)}` +
    `&startTs=${startTs}&endTs=${endTs}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Polymarket CLOB API error ${res.status}: ${await res.text()}`);
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
  const endMs = startMs + 300_000;
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

  return parseFloat(klines[0][4]); // close price
}

export interface BtcKline {
  openTime: number; // unix ms
  open: number;
  close: number;
}

/**
 * Fetch 5 × 1-minute BTC/USDT klines covering a 5-min window.
 * Returns open/close for each minute so we can interpolate intra-window BTC price.
 */
export async function fetchBtcKlinesForWindow(windowStartTs: number): Promise<BtcKline[]> {
  const startMs = windowStartTs * 1000;
  const endMs = startMs + 300_000;
  const url =
    `${BINANCE_API}/api/v3/klines` +
    `?symbol=BTCUSDT&interval=1m` +
    `&startTime=${startMs}&endTime=${endMs}&limit=5`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance API error ${res.status}: ${await res.text()}`);
  }

  const raw = await res.json() as Array<[number, string, string, string, string, ...unknown[]]>;
  return raw.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    close: parseFloat(k[4]),
  }));
}

/**
 * Linearly interpolate BTC price within a 5-min window using 1-min klines.
 * secIntoWindow ∈ [0, 299]: sec 0 → first kline open, sec 59 → first kline close, etc.
 */
export function interpolateBtcPrice(klines: BtcKline[], secIntoWindow: number): number {
  if (!klines.length) throw new Error('Cannot interpolate: empty klines');

  const minuteIdx = Math.min(Math.floor(secIntoWindow / 60), klines.length - 1);
  const kline = klines[minuteIdx];
  const secIntoMinute = secIntoWindow - minuteIdx * 60;
  const frac = Math.min(secIntoMinute / 60, 1);
  return kline.open + (kline.close - kline.open) * frac;
}

