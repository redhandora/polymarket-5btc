/**
 * Paper trading engine (Mode 2): real-time simulation.
 * Mirrors the live tick() loop but uses a simulated client — no real orders.
 *
 * Usage:
 *   npx tsx src/index.ts --paper 1000
 */

import { loadConfig } from '../config.js';
import { createBtcPriceFeed } from '../market-data/btc-price.js';
import { createMarketPriceEstimator } from '../signal/market-price-estimator.js';
import type { MarketPriceEstimator } from '../signal/market-price-estimator.js';
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
  const estimator = createMarketPriceEstimator();
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
  estimator: MarketPriceEstimator,
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

  // Market lookup — try real client first, fall back to synthetic ID
  let marketId: string;
  let market: { marketId: string } | null = null;
  if (realPolyClient) {
    try {
      market = await realPolyClient.getWindowMarket(windowOpen);
    } catch {
      // real client not configured — fall through to synthetic
    }
  }
  if (market) {
    marketId = market.marketId;
  } else {
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

  const tag = `${PREFIX} [${windowId}]`;
  const elapsedSec = ((now - window.openTime) / 1000).toFixed(1);
  console.log(`${tag} ── Entry phase ── market=${marketId} refBTC=${referencePrice.toFixed(2)} elapsed=${elapsedSec}s`);

  const orderSize = computePositionSize(riskState, config);
  console.log(`${tag} Position size: $${orderSize.toFixed(2)} (bankroll=$${riskState.totalBankroll.toFixed(2)} × ${(config.perTradeRiskPct * 100).toFixed(2)}%)`);

  // Update sim price from BTC feed (use mid-price heuristic)
  const currentBtc = await btcFeed.getPrice();
  const deltaPct = (currentBtc - referencePrice) / referencePrice;
  const simPrice = 0.5 + Math.max(-0.15, Math.min(0.15, deltaPct * 10));
  setSimPrice(simPrice);
  estimator.setTokenPrice(simPrice);
  console.log(`${tag} BTC now=${currentBtc.toFixed(2)} delta=${(deltaPct * 100).toFixed(4)}% → tokenPrice=${simPrice.toFixed(4)}`);

  const book = await simClient.getOrderBook(marketId);
  console.log(`${tag} Book: bestBid=${book.bestBid.toFixed(4)} bestAsk=${book.bestAsk.toFixed(4)} spread=${book.spread.toFixed(4)} bidDepth=${book.bidDepth.toFixed(2)} askDepth=${book.askDepth.toFixed(2)}`);

  const filterResult = runFilters(now, window, book, orderSize, config);
  if (!filterResult.pass) {
    console.log(`${tag} Filtered: ${filterResult.reason}`);
    return;
  }
  console.log(`${tag} Filters: PASS`);

  const riskCheck = checkRisk(riskState, config);
  if (!riskCheck.allowed) {
    console.log(`${tag} Risk blocked: ${riskCheck.reason}`);
    return;
  }
  console.log(`${tag} Risk: PASS (dailyPnl=$${riskState.dailyPnl.toFixed(2)} consLoss=${riskState.consecutiveLosses} dailyTrades=${riskState.dailyTrades})`);

  const estimate = await estimator.estimate(window, currentBtc);
  console.log(`${tag} Estimate: up=${estimate.up.toFixed(4)} down=${estimate.down.toFixed(4)}`);

  const decision = evaluateEntry(estimate, book, config);
  console.log(`${tag} Entry decision: enter=${decision.enter} side=${decision.side} pModel=${decision.pModel.toFixed(4)} pMarket=${decision.pMarket.toFixed(4)} edge=${decision.edge.toFixed(4)} minEdge=${config.makerMinEdge}${decision.reason ? ` reason="${decision.reason}"` : ''}`);

  if (!decision.enter) {
    return;
  }

  riskState.activePosition = true;
  const { result, attempts } = await attemptEntry(simClient, marketId, 'buy', decision.price!, orderSize, config);

  if (!result.filled) {
    console.log(`${tag} Entry FAILED after ${attempts} attempts`);
    riskState.activePosition = false;
    return;
  }
  console.log(`${tag} Entry FILLED @ ${result.fillPrice} (attempt ${attempts}/${config.maxEntryAttempts})`);

  // Hold & stop check
  let stopTriggered = false;
  let exitPrice: number | null = null;
  let exitTime: number | null = null;
  let stopChecks = 0;

  console.log(`${tag} ── Hold phase ── waiting for stop window (${config.stopWindowStartSec}s-${config.stopWindowEndSec}s) or settlement...`);

  while (Date.now() < window.closeTime) {
    const checkNow = Date.now();
    if (isInStopWindow(checkNow, window, config)) {
      const btcNow = await btcFeed.getPrice().catch(() => currentBtc);
      const deltaNow = (btcNow - referencePrice) / referencePrice;
      const priceNow = 0.5 + Math.max(-0.15, Math.min(0.15, deltaNow * 10));
      setSimPrice(priceNow);
      estimator.setTokenPrice(priceNow);

      const adverseMove = result.fillPrice! - priceNow;
      const currentEdge = decision.pModel - (priceNow + config.estimatedFee);
      const edgeDelta = decision.edge - currentEdge;
      stopChecks++;

      const stopResult = evaluateStop(
        checkNow, window, result.fillPrice!, priceNow,
        decision.edge, currentEdge, config,
      );

      const stopElapsed = ((checkNow - window.openTime) / 1000).toFixed(1);
      console.log(`${tag} Stop check #${stopChecks} @${stopElapsed}s: BTC=${btcNow.toFixed(2)} token=${priceNow.toFixed(4)} adverse=${adverseMove.toFixed(4)}(thr=${config.stopAdverseMove}) edgeDelta=${edgeDelta.toFixed(4)}(thr=${config.stopEdgeDelta}) → ${stopResult.shouldExit ? 'EXIT' : 'hold'}`);

      if (stopResult.shouldExit) {
        const exitResult = await placeExitOrder(simClient, marketId, 'sell', priceNow, orderSize, config);
        stopTriggered = true;
        exitPrice = exitResult.fillPrice;
        exitTime = exitResult.fillTime;
        console.log(`${tag} Stop exit FILLED @ ${exitPrice}`);
        break;
      }
    }
    await sleep(config.pollIntervalMs);
  }

  if (!stopTriggered) {
    console.log(`${tag} Window closed — no stop triggered (${stopChecks} checks)`);
  }

  const pnlGross = exitPrice != null ? exitPrice - result.fillPrice! : null;
  const fees = config.estimatedFee * orderSize;
  const pnlNet = pnlGross != null ? pnlGross - fees : null;

  if (pnlNet != null) {
    recordTradeResult(riskState, pnlNet);
  } else {
    riskState.activePosition = false;
  }

  setLastWindowId(windowId);
  setLastTradeDate(today);

  const pnlGrossStr = pnlGross != null ? `$${pnlGross.toFixed(4)}` : 'n/a';
  const pnlNetStr = pnlNet != null ? (pnlNet >= 0 ? `+$${pnlNet.toFixed(2)}` : `-$${Math.abs(pnlNet).toFixed(2)}`) : 'pending';
  console.log(`${tag} ── Result ── entry=${result.fillPrice!.toFixed(4)} exit=${exitPrice?.toFixed(4) ?? 'settlement'} stop=${stopTriggered} grossPnl=${pnlGrossStr} fees=$${fees.toFixed(4)} netPnl=${pnlNetStr} | bankroll=$${riskState.totalBankroll.toFixed(2)} dailyPnl=$${riskState.dailyPnl.toFixed(2)} consLoss=${riskState.consecutiveLosses}`);
}
