import type { TradingConfig } from '../config.js';
import type { Side, OrderBookSnapshot, ProbabilityEstimate } from '../types.js';

export interface EntryDecision {
  enter: boolean;
  side: Side | null;
  price: number | null;
  edge: number;
  pModel: number;
  pMarket: number;
  reason: string | null;
}

/** Determine the favored side and its market price from the order book. */
export function determineSide(
  estimate: ProbabilityEstimate,
): { side: Side; pModel: number } {
  // Pick the side where our model gives higher probability
  if (estimate.up >= estimate.down) {
    return { side: 'up', pModel: estimate.up };
  }
  return { side: 'down', pModel: estimate.down };
}

/** Get the market price for buying the favored side (best ask). */
export function getMarketPrice(book: OrderBookSnapshot, side: Side): number {
  // To buy "up" tokens, we look at the ask side
  // To buy "down" tokens, we also look at the ask side of the down book
  // In a binary market, buying "up" at ask = selling "down" at (1 - ask)
  // For simplicity, we treat bestAsk as the entry price for the favored side
  return book.bestAsk;
}

/** Check if the market price falls within the acceptable price band. */
export function priceBandFilter(
  price: number,
  config: TradingConfig,
): { pass: boolean; reason: string | null } {
  const [min, max] = config.makerPriceBand;
  if (price < min || price > max) {
    return { pass: false, reason: `price ${price.toFixed(4)} outside band [${min}, ${max}]` };
  }
  return { pass: true, reason: null };
}

/** Compute edge = pModel - (marketPrice + fee + slippage). */
export function computeEdge(pModel: number, marketPrice: number, config: TradingConfig): number {
  return pModel - (marketPrice + config.estimatedFee + config.estimatedSlippage);
}

/** Full entry decision. */
export function evaluateEntry(
  estimate: ProbabilityEstimate,
  book: OrderBookSnapshot,
  config: TradingConfig,
): EntryDecision {
  const { side, pModel } = determineSide(estimate);
  const pMarket = getMarketPrice(book, side);

  // Price band check
  const bandCheck = priceBandFilter(pMarket, config);
  if (!bandCheck.pass) {
    return { enter: false, side, price: pMarket, edge: 0, pModel, pMarket, reason: bandCheck.reason };
  }

  // Edge check
  const edge = computeEdge(pModel, pMarket, config);
  if (edge < config.makerMinEdge) {
    return {
      enter: false,
      side,
      price: pMarket,
      edge,
      pModel,
      pMarket,
      reason: `edge ${edge.toFixed(4)} < min ${config.makerMinEdge}`,
    };
  }

  return { enter: true, side, price: pMarket, edge, pModel, pMarket, reason: null };
}
