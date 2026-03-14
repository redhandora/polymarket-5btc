import 'dotenv/config';

export interface TradingConfig {
  // Polymarket
  polymarketApiUrl: string;
  polymarketApiKey: string;
  polymarketApiSecret: string;
  polymarketPassphrase: string;
  chainId: number;

  // BTC price feed
  btcPriceUrl: string;

  // Entry timing (seconds into the 5-min window)
  entryWindowStartSec: number;
  entryWindowEndSec: number;

  // Entry price bands [min, max]
  makerPriceBand: [number, number];
  mixedPriceBand: [number, number];

  // Edge thresholds
  makerMinEdge: number;
  takerMinEdge: number;
  estimatedFee: number;
  estimatedSlippage: number;

  // Order placement
  orderTtlMs: number;
  maxEntryAttempts: number;
  allowTakerFallback: boolean;

  // No-trade filters
  maxSpread: number;
  minDepthMultiplier: number;
  minTimeToSettlementSec: number;

  // Exit / stop
  stopWindowStartSec: number;
  stopWindowEndSec: number;
  stopAdverseMove: number;
  stopEdgeDelta: number;

  // Risk
  perTradeRiskPct: number;
  dailyMaxLossPct: number;
  maxConsecutiveLosses: number;
  maxTotalLossPct: number;
  maxDailyTrades: number;
  maxBankroll: number | null;  // cap on bankroll from env; null = no cap

  // Persistence
  tradeLogDir: string;

  // Polling
  pollIntervalMs: number;
}

function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  return v !== undefined ? Number(v) : fallback;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(overrides: Partial<TradingConfig> = {}): TradingConfig {
  return {
    polymarketApiUrl: envStr('POLYMARKET_API_URL', 'https://clob.polymarket.com'),
    polymarketApiKey: envStr('POLYMARKET_API_KEY', ''),
    polymarketApiSecret: envStr('POLYMARKET_API_SECRET', ''),
    polymarketPassphrase: envStr('POLYMARKET_PASSPHRASE', ''),
    chainId: envNum('CHAIN_ID', 137),

    btcPriceUrl: envStr('BTC_PRICE_URL', 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),

    entryWindowStartSec: 35,
    entryWindowEndSec: 75,

    makerPriceBand: [0.53, 0.60],
    mixedPriceBand: [0.56, 0.62],

    makerMinEdge: 0.02,
    takerMinEdge: 0.05,
    estimatedFee: 0.02,
    estimatedSlippage: 0.01,

    orderTtlMs: 12_000,
    maxEntryAttempts: 2,
    allowTakerFallback: false,

    maxSpread: 0.02,
    minDepthMultiplier: 3,
    minTimeToSettlementSec: 75,

    stopWindowStartSec: 150,
    stopWindowEndSec: 180,
    stopAdverseMove: 0.08,
    stopEdgeDelta: 0.03,

    perTradeRiskPct: 0.0075,
    dailyMaxLossPct: 0.03,
    maxConsecutiveLosses: 3,
    maxTotalLossPct: 0.20,
    maxDailyTrades: 288,
    maxBankroll: process.env.MAX_BANKROLL !== undefined ? Number(process.env.MAX_BANKROLL) : null,

    tradeLogDir: envStr('TRADE_LOG_DIR', './data/trades'),

    pollIntervalMs: 1000,

    ...overrides,
  };
}
