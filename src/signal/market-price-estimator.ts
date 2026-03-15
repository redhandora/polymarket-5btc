import type { ProbabilityEstimator } from './estimator.js';
import type { WindowInfo, ProbabilityEstimate } from '../types.js';

/**
 * Market-price estimator: uses Polymarket token price as a probability signal.
 *
 * tokenPrice = "Up" token price at entrySec (i.e. market-implied probability).
 * Signal = tokenPrice deviation from 0.50, amplified by sensitivity.
 *
 * vs placeholder (BTC delta):
 *   - placeholder: BTC 35s move ~0.05% → nudge ~0.005 → rarely enough edge
 *   - market-price: token 0.50→0.55 → nudge 0.05 → frequently enough edge
 *
 * Token price swings are much larger than BTC % moves because they directly
 * reflect market participants' probability judgments.
 */

export interface MarketPriceEstimator extends ProbabilityEstimator {
  setTokenPrice(price: number): void;
}

export function createMarketPriceEstimator(sensitivity = 1): MarketPriceEstimator {
  let tokenPrice = 0.5;

  return {
    setTokenPrice(price: number): void {
      tokenPrice = price;
    },

    async estimate(_window: WindowInfo, _currentBtcPrice: number): Promise<ProbabilityEstimate> {
      const nudge = Math.max(-0.15, Math.min(0.15, (tokenPrice - 0.5) * sensitivity));
      const up = 0.5 + nudge;
      return { up, down: 1 - up };
    },
  };
}
