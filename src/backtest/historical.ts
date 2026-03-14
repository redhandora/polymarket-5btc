/**
 * Historical backtest engine (Mode 1).
 *
 * Usage:
 *   npx tsx src/index.ts --backtest 1000 2024-01-01 2024-01-31
 */

import { loadConfig } from '../config.js';
import { createPlaceholderEstimator } from '../signal/placeholder.js';
import { detectWindow, isInStopWindow } from '../strategy/window.js';
import { runFilters } from '../strategy/filters.js';
import { evaluateEntry } from '../strategy/entry.js';
import { evaluateStop } from '../strategy/exit.js';
import { checkRisk, computePositionSize, recordTradeResult, createRiskState, resetDaily } from '../risk/risk-manager.js';
import { floorToWindow, windowIdFromEpoch } from '../utils/time.js';
import { fetchHistoricalPrices, fetchBtcPriceAt } from '../market-data/polymarket-history.js';
import { createSimClient } from './sim-client.js';
import type { BacktestResult, BacktestTrade } from './report.js';

export interface BacktestOptions {
  startDate: string;   // 'YYYY-MM-DD'
  endDate: string;     // 'YYYY-MM-DD'
  initialBankroll: number;
}

// Polymarket BTC 5-min market condition IDs are looked up via the data API.
// For backtesting we use a known market search endpoint.
const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com';

async function fetchBtcMarketsInRange(startTs: number, endTs: number): Promise<Array<{ conditionId: string; startDate: number }>> {
  // Query Polymarket gamma API for BTC 5-min markets
  const url = `${POLYMARKET_GAMMA_API}/markets?tag=btc&closed=true&limit=500`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json() as Array<{ conditionId?: string; startDate?: string; endDate?: string; question?: string }>;
  const results: Array<{ conditionId: string; startDate: number }> = [];

  for (const m of data) {
    if (!m.conditionId || !m.startDate) continue;
    if (!m.question?.toLowerCase().includes('btc')) continue;
    const ts = Math.floor(new Date(m.startDate).getTime() / 1000);
    if (ts >= startTs && ts <= endTs) {
      results.push({ conditionId: m.conditionId, startDate: ts });
    }
  }

  return results;
}

export async function runHistoricalBacktest(options: BacktestOptions): Promise<BacktestResult> {
  const { startDate, endDate, initialBankroll } = options;
  const config = loadConfig();
  const estimator = createPlaceholderEstimator();

  const startTs = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
  const endTs = Math.floor(new Date(endDate + 'T23:59:59Z').getTime() / 1000);

  console.log(`[Backtest] Fetching BTC markets from ${startDate} to ${endDate}...`);
  const markets = await fetchBtcMarketsInRange(startTs, endTs);
  console.log(`[Backtest] Found ${markets.length} markets`);

  // Build a map: windowOpenMs -> conditionId
  const windowMarketMap = new Map<number, string>();
  for (const m of markets) {
    const windowMs = floorToWindow(m.startDate * 1000);
    windowMarketMap.set(windowMs, m.conditionId);
  }

  const riskState = createRiskState(initialBankroll);
  const trades: BacktestTrade[] = [];
  let skipCount = 0;
  let lastTradeDate: string | null = null;

  // Enumerate all 5-min windows in the range
  const windowDurationMs = 300_000;
  let windowOpenMs = floorToWindow(startTs * 1000);
  const endMs = endTs * 1000;

  while (windowOpenMs <= endMs) {
    const windowId = windowIdFromEpoch(windowOpenMs);
    const today = new Date(windowOpenMs).toISOString().slice(0, 10);

    if (lastTradeDate && lastTradeDate !== today) {
      resetDaily(riskState);
    }

    const marketId = windowMarketMap.get(windowOpenMs);
    if (!marketId) {
      windowOpenMs += windowDurationMs;
      skipCount++;
      continue;
    }

    // Fetch historical prices for this window
    const windowStartTs = Math.floor(windowOpenMs / 1000);
    const windowEndTs = windowStartTs + 300;

    let priceHistory: Array<{ t: number; p: number }>;
    try {
      priceHistory = await fetchHistoricalPrices(marketId, windowStartTs, windowEndTs);
    } catch (err) {
      console.warn(`[Backtest] ${windowId}: failed to fetch prices — ${err}`);
      windowOpenMs += windowDurationMs;
      skipCount++;
      continue;
    }

    if (priceHistory.length === 0) {
      windowOpenMs += windowDurationMs;
      skipCount++;
      continue;
    }

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

    // Fetch BTC reference price at window open
    let referencePrice: number;
    try {
      referencePrice = await fetchBtcPriceAt(windowStartTs);
    } catch {
      windowOpenMs += windowDurationMs;
      skipCount++;
      continue;
    }

    // Simulate entry at entryWindowStartSec
    const entrySec = config.entryWindowStartSec;
    const entryNowMs = windowOpenMs + entrySec * 1000;
    const windowInfo = detectWindow(entryNowMs, config, referencePrice, marketId);

    // Build simulated data provider for this window
    let currentSimPrice = getPriceAt(entrySec);
    const simClient = createSimClient('historical', {
      getCurrentPrice: (_id) => currentSimPrice,
      getMarketForWindow: (t) => windowMarketMap.get(t) ?? null,
      getInitialBankroll: () => riskState.totalBankroll,
    });

    const orderSize = computePositionSize(riskState, config);
    const book = await simClient.getOrderBook(marketId);

    // Run filters
    const filterResult = runFilters(entryNowMs, windowInfo, book, orderSize, config);
    if (!filterResult.pass) {
      skipCount++;
      windowOpenMs += windowDurationMs;
      continue;
    }

    // Risk check
    const riskCheck = checkRisk(riskState, config);
    if (!riskCheck.allowed) {
      skipCount++;
      windowOpenMs += windowDurationMs;
      continue;
    }

    // Probability estimate using BTC price at entry time
    const btcAtEntry = referencePrice; // use reference as proxy (no intra-window BTC history)
    const estimate = await estimator.estimate(windowInfo, btcAtEntry);
    const decision = evaluateEntry(estimate, book, config);

    if (!decision.enter) {
      skipCount++;
      windowOpenMs += windowDurationMs;
      continue;
    }

    const entryPrice = decision.price!;
    riskState.activePosition = true;

    // Simulate stop check during stop window
    let stopTriggered = false;
    let exitPrice: number | null = null;

    for (let sec = config.stopWindowStartSec; sec <= config.stopWindowEndSec; sec += 5) {
      const checkMs = windowOpenMs + sec * 1000;
      currentSimPrice = getPriceAt(sec);
      const currentEdge = decision.pModel - (currentSimPrice + config.estimatedFee);
      const stopResult = evaluateStop(
        checkMs, windowInfo, entryPrice, currentSimPrice,
        decision.edge, currentEdge, config,
      );
      if (stopResult.shouldExit) {
        stopTriggered = true;
        exitPrice = currentSimPrice;
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
  };
}
