import type { ProbabilityEstimator } from './estimator.js';
import type { WindowInfo, ProbabilityEstimate } from '../types.js';

/**
 * Placeholder estimator: uses the BTC price delta since window open
 * to nudge probability away from 50/50.
 *
 * p_up = 0.5 + clamp(delta_pct * sensitivity, -0.15, 0.15)
 * p_down = 1 - p_up
 */
export function createPlaceholderEstimator(sensitivity = 10): ProbabilityEstimator {
  return {
    async estimate(window: WindowInfo, currentBtcPrice: number): Promise<ProbabilityEstimate> {
      const deltaPct = (currentBtcPrice - window.referencePrice) / window.referencePrice;
      const nudge = Math.max(-0.15, Math.min(0.15, deltaPct * sensitivity));
      const up = 0.5 + nudge;
      return { up, down: 1 - up };
    },
  };
}
