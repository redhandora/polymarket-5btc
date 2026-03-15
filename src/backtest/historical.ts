/**
 * Historical backtest engine (Mode 1).
 *
 * Usage:
 *   npx tsx src/index.ts --backtest 1000 2024-01-01 2024-01-31
 */

import { fetch } from '../utils/fetch.js';
import { loadConfig } from '../config.js';
import { detectWindow } from '../strategy/window.js';
import { runFilters } from '../strategy/filters.js';
import { evaluateMomentumEntry } from '../strategy/entry.js';
import { evaluateTokenStop } from '../strategy/exit.js';
import { checkRisk, computePositionSize, recordTradeResult, createRiskState, resetDaily } from '../risk/risk-manager.js';
import { floorToWindow, windowIdFromEpoch } from '../utils/time.js';
import { fetchHistoricalPrices, fetchBtcKlinesForWindow } from '../market-data/polymarket-history.js';
import { createSimClient } from './sim-client.js';
import type { BacktestResult, BacktestTrade, WindowDecisionLog } from './report.js';

export interface BacktestOptions {
  startDate: string;   // 'YYYY-MM-DD'
  endDate: string;     // 'YYYY-MM-DD'
  initialBankroll: number;
}

// Polymarket BTC 5-min market condition IDs are looked up via the data API.
// For backtesting we use a known market search endpoint.
const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com';

async function fetchBtcMarketsInRange(startTs: number, endTs: number): Promise<Array<{ conditionId: string; tokenId: string; startDate: number }>> {
  // BTC 5-min markets have slug: btc-updown-5m-{windowOpenTimestamp}
  // Enumerate all 5-min window timestamps in range and fetch each by slug directly.
  const results: Array<{ conditionId: string; tokenId: string; startDate: number }> = [];
  const WINDOW = 300; // 5 minutes

  // Round startTs down to nearest 5-min boundary
  const firstWindow = Math.floor(startTs / WINDOW) * WINDOW;

  const fetches: Promise<void>[] = [];
  for (let ts = firstWindow; ts <= endTs; ts += WINDOW) {
    const slug = `btc-updown-5m-${ts}`;
    fetches.push(
      fetch(`${POLYMARKET_GAMMA_API}/markets?slug=${slug}`)
        .then(r => r.ok ? r.json() : [])
        .then((data: Array<{ conditionId?: string; slug?: string; clobTokenIds?: string }>) => {
          const m = Array.isArray(data) ? data[0] : data;
          if (m?.conditionId && m?.clobTokenIds) {
            // clobTokenIds is a JSON string like '["tokenA","tokenB"]'; index 0 = "Up" token
            const tokens: string[] = typeof m.clobTokenIds === 'string'
              ? JSON.parse(m.clobTokenIds)
              : m.clobTokenIds;
            results.push({ conditionId: m.conditionId, tokenId: tokens[0], startDate: ts });
          }
        })
        .catch(() => {}),
    );
  }

  // Run in batches of 20 to avoid overwhelming the API
  const BATCH = 20;
  const totalBatches = Math.ceil(fetches.length / BATCH);
  console.log(`[Backtest] Fetching ${fetches.length} market slugs in ${totalBatches} batches...`);
  for (let i = 0; i < fetches.length; i += BATCH) {
    const batchNum = Math.floor(i / BATCH) + 1;
    if (batchNum % 10 === 0 || batchNum === 1) {
      console.log(`[Backtest] Batch ${batchNum}/${totalBatches} (found ${results.length} markets so far)...`);
    }
    await Promise.all(fetches.slice(i, i + BATCH));
  }

  results.sort((a, b) => a.startDate - b.startDate);
  return results;
}

export async function runHistoricalBacktest(options: BacktestOptions): Promise<BacktestResult> {
  const { startDate, endDate, initialBankroll } = options;
  const config = loadConfig();

  const startTs = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
  const endTs = Math.floor(new Date(endDate + 'T23:59:59Z').getTime() / 1000);

  console.log(`[Backtest] Fetching BTC markets from ${startDate} to ${endDate}...`);
  const markets = await fetchBtcMarketsInRange(startTs, endTs);
  console.log(`[Backtest] Found ${markets.length} markets`);

  // Build a map: windowOpenMs -> { conditionId, tokenId }
  const windowMarketMap = new Map<number, { conditionId: string; tokenId: string }>();
  for (const m of markets) {
    const windowMs = floorToWindow(m.startDate * 1000);
    windowMarketMap.set(windowMs, { conditionId: m.conditionId, tokenId: m.tokenId });
  }

  const riskState = createRiskState(initialBankroll);
  const trades: BacktestTrade[] = [];
  const decisions: WindowDecisionLog[] = [];
  let skipCount = 0;
  let lastTradeDate: string | null = null;

  // Enumerate all 5-min windows in the range
  const windowDurationMs = 300_000;
  let windowOpenMs = floorToWindow(startTs * 1000);
  const endMs = endTs * 1000;

  let processedCount = 0;
  const totalMarkets = markets.length;

  while (windowOpenMs <= endMs) {
    const windowId = windowIdFromEpoch(windowOpenMs);
    const today = new Date(windowOpenMs).toISOString().slice(0, 10);

    if (lastTradeDate && lastTradeDate !== today) {
      resetDaily(riskState);
    }

    const market = windowMarketMap.get(windowOpenMs);
    if (!market) {
      decisions.push({ windowId, outcome: 'no_market', reason: null, tokenPrice: null, bestAsk: null, pricePoints: null, side: null, entryPrice: null, exitPrice: null, pnlNet: null, stopTriggered: null });
      windowOpenMs += windowDurationMs;
      skipCount++;
      continue;
    }

    processedCount++;
    console.log(`[Backtest] Processing ${processedCount}/${totalMarkets}: ${windowId} — fetching prices...`);

    // Fetch historical prices for this window (use "Up" token ID for CLOB API)
    const windowStartTs = Math.floor(windowOpenMs / 1000);
    const windowEndTs = windowStartTs + 300;

    let priceHistory: Array<{ t: number; p: number }>;
    try {
      priceHistory = await fetchHistoricalPrices(market.tokenId, windowStartTs, windowEndTs);
    } catch (err) {
      console.warn(`[Backtest] ${windowId}: failed to fetch prices — ${err}`);
      decisions.push({ windowId, outcome: 'fetch_error', reason: String(err), tokenPrice: null, bestAsk: null, pricePoints: null, side: null, entryPrice: null, exitPrice: null, pnlNet: null, stopTriggered: null });
      windowOpenMs += windowDurationMs;
      skipCount++;
      continue;
    }

    if (priceHistory.length === 0) {
      console.log(`[Backtest] ${windowId}: no price data, skipping`);
      decisions.push({ windowId, outcome: 'no_price_data', reason: null, tokenPrice: null, bestAsk: null, pricePoints: null, side: null, entryPrice: null, exitPrice: null, pnlNet: null, stopTriggered: null });
      windowOpenMs += windowDurationMs;
      skipCount++;
      continue;
    }

    console.log(`[Backtest] ${windowId}: got ${priceHistory.length} price points, fetching BTC ref price...`);

    // Build a price lookup: seconds-into-window -> price
    const priceAtSec = new Map<number, number>();
    for (const pt of priceHistory) {
      const sec = pt.t - windowStartTs;
      priceAtSec.set(sec, pt.p);
    }

    function getPriceAt(sec: number): number {
      // Find closest available price
      let closest = priceHistory[0].p;
      let minDiff = Infinity;
      for (const [s, p] of priceAtSec) {
        const diff = Math.abs(s - sec);
        if (diff < minDiff) { minDiff = diff; closest = p; }
      }
      return closest;
    }

    // Fetch 1-min BTC klines for this window (5 candles)
    let btcKlines: import('../market-data/polymarket-history.js').BtcKline[];
    try {
      btcKlines = await fetchBtcKlinesForWindow(windowStartTs);
    } catch {
      console.warn(`[Backtest] ${windowId}: failed to fetch BTC klines, skipping`);
      decisions.push({ windowId, outcome: 'no_btc_klines', reason: 'fetch failed', tokenPrice: null, bestAsk: null, pricePoints: priceHistory.length, side: null, entryPrice: null, exitPrice: null, pnlNet: null, stopTriggered: null });
      windowOpenMs += windowDurationMs;
      skipCount++;
      continue;
    }
    if (!btcKlines.length) {
      console.warn(`[Backtest] ${windowId}: no BTC kline data, skipping`);
      decisions.push({ windowId, outcome: 'no_btc_klines', reason: 'empty response', tokenPrice: null, bestAsk: null, pricePoints: priceHistory.length, side: null, entryPrice: null, exitPrice: null, pnlNet: null, stopTriggered: null });
      windowOpenMs += windowDurationMs;
      skipCount++;
      continue;
    }
    const referencePrice = btcKlines[0].open;

    console.log(`[Backtest] ${windowId}: BTC ref=$${referencePrice.toFixed(0)}, evaluating entry...`);

    // Simulate entry at entryWindowStartSec
    const entrySec = config.entryWindowStartSec;
    const entryNowMs = windowOpenMs + entrySec * 1000;
    const windowInfo = detectWindow(entryNowMs, config, referencePrice, market.conditionId);

    // Build simulated data provider for this window
    let currentSimPrice = getPriceAt(entrySec);
    const simClient = createSimClient('historical', {
      getCurrentPrice: (_id) => currentSimPrice,
      getMarketForWindow: (t) => windowMarketMap.get(t)?.conditionId ?? null,
      getInitialBankroll: () => riskState.totalBankroll,
    });

    const orderSize = computePositionSize(riskState, config);
    const book = await simClient.getOrderBook(market.conditionId);

    // Run filters
    const filterResult = runFilters(entryNowMs, windowInfo, book, orderSize, config);
    if (!filterResult.pass) {
      decisions.push({ windowId, outcome: 'filter_rejected', reason: filterResult.reason ?? null, tokenPrice: currentSimPrice, bestAsk: book.bestAsk, pricePoints: priceHistory.length, side: null, entryPrice: null, exitPrice: null, pnlNet: null, stopTriggered: null });
      skipCount++;
      windowOpenMs += windowDurationMs;
      continue;
    }

    // Risk check
    const riskCheck = checkRisk(riskState, config, windowOpenMs);
    if (!riskCheck.allowed) {
      decisions.push({ windowId, outcome: 'risk_blocked', reason: riskCheck.reason ?? null, tokenPrice: currentSimPrice, bestAsk: book.bestAsk, pricePoints: priceHistory.length, side: null, entryPrice: null, exitPrice: null, pnlNet: null, stopTriggered: null });
      skipCount++;
      windowOpenMs += windowDurationMs;
      continue;
    }

    // Momentum entry: use token price directly
    const entryTokenPrice = getPriceAt(entrySec);
    const decision = evaluateMomentumEntry(entryTokenPrice, book, config);

    if (!decision.enter) {
      decisions.push({ windowId, outcome: 'entry_rejected', reason: decision.reason ?? null, tokenPrice: entryTokenPrice, bestAsk: book.bestAsk, pricePoints: priceHistory.length, side: null, entryPrice: null, exitPrice: null, pnlNet: null, stopTriggered: null });
      skipCount++;
      windowOpenMs += windowDurationMs;
      continue;
    }

    const entryPrice = decision.price!;
    riskState.activePosition = true;

    // Simulate stop check during stop window using token price retracement
    let stopTriggered = false;
    let exitPrice: number | null = null;

    for (let sec = config.stopWindowStartSec; sec <= config.stopWindowEndSec; sec += 5) {
      const currentTokenPrice = getPriceAt(sec);
      const stopResult = evaluateTokenStop(
        decision.side!, entryTokenPrice, currentTokenPrice, config,
      );
      if (stopResult.shouldExit) {
        stopTriggered = true;
        exitPrice = currentTokenPrice;
        break;
      }
    }

    // Settlement price (end of window)
    if (!stopTriggered) {
      exitPrice = getPriceAt(295); // ~5s before close
    }

    const pnlGross = exitPrice != null ? exitPrice - entryPrice : 0;
    const pnlNet = (pnlGross - config.estimatedFee) * orderSize;

    recordTradeResult(riskState, pnlNet);
    lastTradeDate = today;

    trades.push({
      windowId,
      side: decision.side!,
      entryPrice,
      exitPrice,
      pnlNet,
      stopTriggered,
    });

    decisions.push({ windowId, outcome: 'traded', reason: null, tokenPrice: entryTokenPrice, bestAsk: book.bestAsk, pricePoints: priceHistory.length, side: decision.side!, entryPrice, exitPrice, pnlNet, stopTriggered });

    console.log(`[Backtest] ${windowId} ${decision.side} entry=${entryPrice.toFixed(4)} exit=${exitPrice?.toFixed(4)} pnl=${pnlNet >= 0 ? '+' : ''}${pnlNet.toFixed(2)}`);

    windowOpenMs += windowDurationMs;
  }

  const winCount = trades.filter((t) => t.pnlNet > 0).length;
  const lossCount = trades.filter((t) => t.pnlNet <= 0).length;
  const totalPnl = trades.reduce((s, t) => s + t.pnlNet, 0);

  return {
    startDate,
    endDate,
    initialBankroll,
    finalBankroll: riskState.totalBankroll,
    totalPnl,
    winCount,
    lossCount,
    skipCount,
    trades,
    decisions,
  };
}
