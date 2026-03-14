// ── Side & Order Types ──

export type Side = 'up' | 'down';
export type OrderMode = 'maker' | 'taker' | 'post_only';

// ── Market Window ──

export interface WindowInfo {
  windowId: string;        // ISO timestamp, e.g. "2026-03-14T12:05:00Z"
  marketId: string;        // Polymarket condition ID
  openTime: number;        // epoch ms
  closeTime: number;       // epoch ms (openTime + 300_000)
  referencePrice: number;  // BTC price at window open
}

// ── Order Book ──

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  bestBid: number;
  bestAsk: number;
  bidDepth: number;
  askDepth: number;
}

// ── Probability Estimate ──

export interface ProbabilityEstimate {
  up: number;
  down: number;
}

// ── Trade Record ──

export interface TradeRecord {
  windowId: string;
  marketId: string;
  side: Side;
  openTime: number;
  entryAttemptTime: number;
  entryFillTime: number | null;
  entryPrice: number | null;
  exitTime: number | null;
  exitPrice: number | null;
  orderMode: OrderMode;
  spread: number;
  estimatedFee: number;
  pModel: number;
  pMarket: number;
  edge: number;
  stopTriggered: boolean;
  pnlGross: number | null;
  pnlNet: number | null;
  rejectionReason: string | null;
  noTradeReason: string | null;
}
