/**
 * Paper trading engine (Mode 2): real-time simulation.
 * Mirrors the live tick() loop but uses a simulated client — no real orders.
 *
 * Usage:
 *   npx tsx src/index.ts --paper 1000
 */

import { loadConfig } from '../config.js';
import { createBtcPriceFeed } from '../market-data/btc-price.js';
import { createPlaceholderEstimator } from '../signal/placeholder.js';
import { detectWindow, isInEntryWindow, isInStopWindow, msUntilEntryWindow } from '../strategy/window.js';
import { runFilters } from '../strategy/filters.js';
import { evaluateEntry } from '../strategy/entry.js';
import { evaluateStop } from '../strategy/exit.js';
import { attemptEntry, placeExitOrder } from '../execution/order-manager.js';
import { createRiskState, checkRisk, computePositionSize, recordTradeResult, resetDaily } from '../risk/risk-manager.js';
import { floorToWindow, windowIdFromEpoch, sleep } from '../utils/time.js';
import { createSimClient } from './sim-client.js';
import type { TradeRecord, Side } from '../types.js';

const PREFIX = '[PAPER]';

export async function runPaperTrading(initialBankroll: number): Promise<void> {
  const config = loadConfig();
  const btcFeed = createBtcPriceFeed(config);
  const estimator = createPlaceholderEstimator();
  const riskState = createRiskState(initialBankroll);

  let lastWindowId: string | null = null;
  let lastTradeDate: string | null = null;

  // Current simulated market price (updated each tick via real order book or btc feed)
  let currentSimPrice = 0.55; // default mid-price

  const simClient = createSimClient('paper', {
    getCurrentPrice: (_marketId) => currentSimPrice,
    getMarketForWindow: (_windowOpenTime) => null, // overridden below
    getInitialBankroll: () => riskState.totalBankroll,
  });

  // We need a real market lookup — use the live Polymarket client for market discovery only,
  // but fall back to a synthetic marketId for paper trading when no real connection exists.
  let realPolyClient: { getWindowMarket: (t: number) => Promise<{ marketId: string } | null> } | null = null;
  try {
    const { createPolymarketClient } = await import('../market-data/polymarket-client.js');
    realPolyClient = createPolymarketClient(config);
  } catch {
    // no real client available
  }

  console.log(`${PREFIX} Paper trading started with $${initialBankroll.toFixed(2)} bankroll`);
  console.log(`${PREFIX} No real orders will be placed`);

  let running = true;
  process.on('SIGINT', () => {
    running = false;
    console.log(`\n${PREFIX} Shutting down...`);
    console.log(`${PREFIX} Final bankroll: $${riskState.totalBankroll.toFixed(2)}`);
    const pnl = riskState.totalBankroll - initialBankroll;
    const pct = (pnl / initialBankroll) * 100;
    console.log(`${PREFIX} Total PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pct.toFixed(2)}%)`);
  });

  while (running) {
    try {
      await paperTick(
        config, btcFeed, simClient, realPolyClient, estimator,
        riskState, { lastWindowId, lastTradeDate },
        (wid) => { lastWindowId = wid; },
        (date) => { lastTradeDate = date; },
        (price) => { currentSimPrice = price; },
      );
    } catch (err) {
      console.error(`${PREFIX} Tick error:`, err);
    }
    await sleep(config.pollIntervalMs);
  }
}

async function paperTick(
  config: ReturnType<typeof loadConfig>,
  btcFeed: ReturnType<typeof createBtcPriceFeed>,
  simClient: ReturnType<typeof createSimClient>,
  realPolyClient: { getWindowMarket: (t: number) => Promise<{ marketId: string } | null> } | null,
  estimator: ReturnType<typeof createPlaceholderEstimator>,
  riskState: ReturnType<typeof createRiskState>,
  state: { lastWindowId: string | null; lastTradeDate: string | null },
  setLastWindowId: (id: string) => void,
  setLastTradeDate: (date: string) => void,
  setSimPrice: (p: number) => void,
): Promise<void> {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  if (state.lastTradeDate && state.lastTradeDate !== today) {
    resetDaily(riskState);
    console.log(`${PREFIX} New trading day: ${today}`);
  }

  const windowOpen = floorToWindow(now);
  const windowId = windowIdFromEpoch(windowOpen);

  if (windowId === state.lastWindowId) return;

  // Market lookup
  let marketId: string;
  if (realPolyClient) {
    let market: { marketId: string } | null = null;
    try {
      market = await realPolyClient.getWindowMarket(windowOpen);
    } catch {
      // ignore
    }
    if (!market) {
      console.log(`${PREFIX} [${windowId}] No market found`);
      return;
    }
    marketId = market.marketId;
  } else {
    // Synthetic market ID for dry-run paper trading
    marketId = `paper-${windowId}`;
  }

  // BTC reference price
  let referencePrice: number;
  try {
    referencePrice = await btcFeed.getPrice();
  } catch (err) {
    console.error(`${PREFIX} [${windowId}] Failed to fetch BTC price:`, err);
    return;
  }

  const window = detectWindow(now, config, referencePrice, marketId);

  const waitMs = msUntilEntryWindow(now, window, config);
  if (waitMs > 0) {
    console.log(`${PREFIX} [${windowId}] Waiting ${(waitMs / 1000).toFixed(0)}s for entry window...`);
    return;
  }

  if (!isInEntryWindow(now, window, config)) return;

  console.log(`${PREFIX} [${windowId}] Entry phase — evaluating...`);

  const orderSize = computePositionSize(riskState, config);

  // Update sim price from BTC feed (use mid-price heuristic)
  const currentBtc = await btcFeed.getPrice();
  const deltaPct = (currentBtc - referencePrice) / referencePrice;
  const simPrice = 0.5 + Math.max(-0.15, Math.min(0.15, deltaPct * 10));
  setSimPrice(simPrice);

  const book = await simClient.getOrderBook(marketId);

  const filterResult = runFilters(now, window, book, orderSize, config);
  if (!filterResult.pass) {
    console.log(`${PREFIX} [${windowId}] Filtered: ${filterResult.reason}`);
    return;
  }

  const riskCheck = checkRisk(riskState, config);
  if (!riskCheck.allowed) {
    console.log(`${PREFIX} [${windowId}] Risk blocked: ${riskCheck.reason}`);
    return;
  }

  const estimate = await estimator.estimate(window, currentBtc);
  const decision = evaluateEntry(estimate, book, config);

  if (!decision.enter) {
    console.log(`${PREFIX} [${windowId}] No entry: ${decision.reason}`);
    return;
  }

  console.log(`${PREFIX} [${windowId}] Entering ${decision.side} @ ${decision.price} (edge: ${decision.edge.toFixed(4)})`);

  riskState.activePosition = true;
  const { result, attempts } = await attemptEntry(simClient, marketId, 'buy', decision.price!, orderSize, config);

  if (!result.filled) {
    console.log(`${PREFIX} [${windowId}] Entry failed after ${attempts} attempts`);
    riskState.activePosition = false;
    return;
  }

  console.log(`${PREFIX} [${windowId}] Filled @ ${result.fillPrice} (attempt ${attempts})`);

  // Hold & stop check
  let stopTriggered = false;
  let exitPrice: number | null = null;
  let exitTime: number | null = null;

  while (Date.now() < window.closeTime) {
    const checkNow = Date.now();
    if (isInStopWindow(checkNow, window, config)) {
      const btcNow = await btcFeed.getPrice().catch(() => currentBtc);
      const deltaNow = (btcNow - referencePrice) / referencePrice;
      const priceNow = 0.5 + Math.max(-0.15, Math.min(0.15, deltaNow * 10));
      setSimPrice(priceNow);

      const currentEdge = decision.pModel - (priceNow + config.estimatedFee);
      const stopResult = evaluateStop(
        checkNow, window, result.fillPrice!, priceNow,
        decision.edge, currentEdge, config,
      );
      if (stopResult.shouldExit) {
        console.log(`${PREFIX} [${windowId}] ${stopResult.reason}`);
        const exitResult = await placeExitOrder(simClient, marketId, 'sell', priceNow, orderSize, config);
        stopTriggered = true;
        exitPrice = exitResult.fillPrice;
        exitTime = exitResult.fillTime;
        break;
      }
    }
    await sleep(config.pollIntervalMs);
  }

  const pnlGross = exitPrice != null ? exitPrice - result.fillPrice! : null;
  const pnlNet = pnlGross != null ? pnlGross - config.estimatedFee * orderSize : null;

  if (pnlNet != null) {
    recordTradeResult(riskState, pnlNet);
  } else {
    riskState.activePosition = false;
  }

  setLastWindowId(windowId);
  setLastTradeDate(today);

  const pnlStr = pnlNet != null ? (pnlNet >= 0 ? `+$${pnlNet.toFixed(2)}` : `-$${Math.abs(pnlNet).toFixed(2)}`) : 'pending';
  console.log(`${PREFIX} [${windowId}] Trade done. PnL: ${pnlStr} | Bankroll: $${riskState.totalBankroll.toFixed(2)}`);
}
