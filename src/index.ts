import { loadConfig } from './config.js';
import { createBtcPriceFeed } from './market-data/btc-price.js';
import { createPolymarketClient } from './market-data/polymarket-client.js';
import { createPlaceholderEstimator } from './signal/placeholder.js';
import { detectWindow, createWindowState, isInEntryWindow, isInStopWindow, msUntilEntryWindow } from './strategy/window.js';
import { runFilters } from './strategy/filters.js';
import { evaluateEntry } from './strategy/entry.js';
import { evaluateStop } from './strategy/exit.js';
import { attemptEntry, placeExitOrder } from './execution/order-manager.js';
import { createRiskState, checkRisk, computePositionSize, recordTradeResult, resetDaily } from './risk/risk-manager.js';
import { createTradeLogger } from './persistence/trade-logger.js';
import { saveState, loadState } from './persistence/state.js';
import { floorToWindow, nextWindowOpen, sleep, windowIdFromEpoch } from './utils/time.js';
import type { TradeRecord, Side } from './types.js';

// ── PLACEHOLDER_CONTENT ──

async function resolveBankroll(
  polyClient: ReturnType<typeof createPolymarketClient>,
  config: ReturnType<typeof loadConfig>,
): Promise<number> {
  let accountBalance: number;
  try {
    accountBalance = await polyClient.getBalance();
    console.log(`Polymarket account balance: $${accountBalance.toFixed(2)}`);
  } catch {
    throw new Error('Failed to fetch Polymarket account balance — cannot start without knowing available funds');
  }

  const bankroll = config.maxBankroll !== null
    ? Math.min(accountBalance, config.maxBankroll)
    : accountBalance;

  if (bankroll <= 0) {
    throw new Error(`Resolved bankroll is $${bankroll.toFixed(2)} — insufficient funds to trade`);
  }

  if (config.maxBankroll !== null && config.maxBankroll < accountBalance) {
    console.log(`Bankroll capped at $${bankroll.toFixed(2)} (MAX_BANKROLL env limit)`);
  } else {
    console.log(`Bankroll set to $${bankroll.toFixed(2)} (full account balance)`);
  }

  return bankroll;
}

async function main() {
  const config = loadConfig();
  const btcFeed = createBtcPriceFeed(config);
  const polyClient = createPolymarketClient(config);
  const estimator = createPlaceholderEstimator();
  const logger = createTradeLogger(config);

  // Restore or initialize risk state
  const persisted = loadState();
  const bankroll = await resolveBankroll(polyClient, config);
  const riskState = persisted?.riskState ?? createRiskState(bankroll);
  let lastWindowId = persisted?.lastWindowId ?? null;
  let lastTradeDate = persisted?.lastTradeDate ?? null;

  console.log('Polymarket 5-min BTC trading system started');
  console.log(`Config: entry window ${config.entryWindowStartSec}-${config.entryWindowEndSec}s, poll ${config.pollIntervalMs}ms`);

  let running = true;
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    running = false;
  });

  while (running) {
    try {
      await tick(config, btcFeed, polyClient, estimator, logger, riskState, lastWindowId, lastTradeDate);
    } catch (err) {
      console.error('Tick error:', err);
    }
    await sleep(config.pollIntervalMs);
  }

  // Persist state on exit
  saveState({ riskState, lastWindowId, lastTradeDate });
  console.log('State saved. Goodbye.');
}

// ── TICK_PLACEHOLDER ──

async function tick(
  config: ReturnType<typeof loadConfig>,
  btcFeed: ReturnType<typeof createBtcPriceFeed>,
  polyClient: ReturnType<typeof createPolymarketClient>,
  estimator: ReturnType<typeof createPlaceholderEstimator>,
  logger: ReturnType<typeof createTradeLogger>,
  riskState: ReturnType<typeof createRiskState>,
  lastWindowId: string | null,
  lastTradeDate: string | null,
) {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Reset daily counters on new day
  if (lastTradeDate && lastTradeDate !== today) {
    resetDaily(riskState);
    console.log(`New trading day: ${today}`);
  }

  // Detect current window
  const windowOpen = floorToWindow(now);
  const windowId = windowIdFromEpoch(windowOpen);

  // Skip if we already traded this window
  if (windowId === lastWindowId) return;

  // Try to get the market for this window
  let market: { marketId: string } | null = null;
  try {
    market = await polyClient.getWindowMarket(windowOpen);
  } catch {
    // No API keys configured — dry-run mode
    console.log(`[${windowId}] Dry run — no Polymarket connection`);
    return;
  }

  if (!market) {
    console.log(`[${windowId}] No market found for this window`);
    return;
  }

  // Fetch reference BTC price
  let referencePrice: number;
  try {
    referencePrice = await btcFeed.getPrice();
  } catch (err) {
    console.error(`[${windowId}] Failed to fetch BTC price:`, err);
    return;
  }

  const window = detectWindow(now, config, referencePrice, market.marketId);

  // Wait for entry window if needed
  const waitMs = msUntilEntryWindow(now, window, config);
  if (waitMs > 0) {
    console.log(`[${windowId}] Waiting ${(waitMs / 1000).toFixed(0)}s for entry window...`);
    return; // Will re-enter on next tick
  }

  if (!isInEntryWindow(now, window, config)) {
    return; // Past entry window, wait for next
  }

  // ── Entry Phase ──
  console.log(`[${windowId}] Entry phase — evaluating...`);

  const orderSize = computePositionSize(riskState, config);

  // Fetch orderbook
  const book = await polyClient.getOrderBook(market.marketId);

  // Run no-trade filters
  const filterResult = runFilters(now, window, book, orderSize, config);
  if (!filterResult.pass) {
    console.log(`[${windowId}] Filtered: ${filterResult.reason}`);
    return;
  }

  // Risk check
  const riskCheck = checkRisk(riskState, config);
  if (!riskCheck.allowed) {
    console.log(`[${windowId}] Risk blocked: ${riskCheck.reason}`);
    return;
  }

  // Get probability estimate
  const currentBtc = await btcFeed.getPrice();
  const estimate = await estimator.estimate(window, currentBtc);

  // Evaluate entry
  const decision = evaluateEntry(estimate, book, config);
  if (!decision.enter) {
    console.log(`[${windowId}] No entry: ${decision.reason}`);
    return;
  }

  console.log(`[${windowId}] Entering ${decision.side} @ ${decision.price} (edge: ${decision.edge.toFixed(4)})`);

  // Place order
  riskState.activePosition = true;
  const { result, attempts } = await attemptEntry(
    polyClient,
    market.marketId,
    'buy',
    decision.price!,
    orderSize,
    config,
  );

  if (!result.filled) {
    console.log(`[${windowId}] Entry failed after ${attempts} attempts`);
    riskState.activePosition = false;
    return;
  }

  console.log(`[${windowId}] Filled @ ${result.fillPrice} (attempt ${attempts})`);

  // ── Hold & Stop Check Phase ──
  // Monitor until settlement
  let stopTriggered = false;
  let exitPrice: number | null = null;
  let exitTime: number | null = null;

  while (Date.now() < window.closeTime) {
    const checkNow = Date.now();
    if (isInStopWindow(checkNow, window, config)) {
      const currentPrice = await btcFeed.getPrice();
      const currentEstimate = await estimator.estimate(window, currentPrice);
      const currentEdge = decision.pModel - (currentPrice + config.estimatedFee);
      const stopResult = evaluateStop(
        checkNow, window, result.fillPrice!, currentPrice,
        decision.edge, currentEdge, config,
      );
      if (stopResult.shouldExit) {
        console.log(`[${windowId}] ${stopResult.reason}`);
        const exitResult = await placeExitOrder(polyClient, market.marketId, 'sell', currentPrice, orderSize, config);
        stopTriggered = true;
        exitPrice = exitResult.fillPrice;
        exitTime = exitResult.fillTime;
        break;
      }
    }
    await sleep(config.pollIntervalMs);
  }

  // ── Settlement ──
  const pnlGross = exitPrice != null ? exitPrice - result.fillPrice! : null;
  const pnlNet = pnlGross != null ? pnlGross - config.estimatedFee * orderSize : null;

  if (pnlNet != null) {
    recordTradeResult(riskState, pnlNet);
  } else {
    riskState.activePosition = false;
  }

  const record: TradeRecord = {
    windowId,
    marketId: market.marketId,
    side: decision.side!,
    openTime: window.openTime,
    entryAttemptTime: now,
    entryFillTime: result.fillTime,
    entryPrice: result.fillPrice,
    exitTime,
    exitPrice,
    orderMode: 'post_only',
    spread: book.spread,
    estimatedFee: config.estimatedFee,
    pModel: decision.pModel,
    pMarket: decision.pMarket,
    edge: decision.edge,
    stopTriggered,
    pnlGross: pnlGross != null ? pnlGross * orderSize : null,
    pnlNet: pnlNet != null ? pnlNet * orderSize : null,
    rejectionReason: null,
    noTradeReason: null,
  };

  logger.log(record);
  saveState({ riskState, lastWindowId: windowId, lastTradeDate: today });
  console.log(`[${windowId}] Trade logged. PnL: ${pnlNet != null ? (pnlNet * orderSize).toFixed(2) : 'pending settlement'}`);
}

// ── CLI dispatch ──

async function dispatch() {
  const args = process.argv.slice(2);

  if (args[0] === '--paper') {
    const bankroll = args[1] ? parseFloat(args[1]) : NaN;
    if (isNaN(bankroll) || bankroll <= 0) {
      console.error('Usage: --paper <bankroll>  e.g. --paper 1000');
      process.exit(1);
    }
    const { runPaperTrading } = await import('./backtest/paper-trading.js');
    await runPaperTrading(bankroll);
    return;
  }

  if (args[0] === '--backtest') {
    const bankroll = args[1] ? parseFloat(args[1]) : NaN;
    const startDate = args[2];
    const endDate = args[3];
    if (isNaN(bankroll) || bankroll <= 0 || !startDate || !endDate) {
      console.error('Usage: --backtest <bankroll> <YYYY-MM-DD> <YYYY-MM-DD>  e.g. --backtest 1000 2024-01-01 2024-01-31');
      process.exit(1);
    }
    const { runHistoricalBacktest } = await import('./backtest/historical.js');
    const { printBacktestReport } = await import('./backtest/report.js');
    const result = await runHistoricalBacktest({ startDate, endDate, initialBankroll: bankroll });
    printBacktestReport(result);
    return;
  }

  await main();
}

dispatch().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
