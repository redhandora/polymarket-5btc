import type { WindowInfo, ProbabilityEstimate } from '../types.js';

export interface ProbabilityEstimator {
  estimate(window: WindowInfo, currentBtcPrice: number): Promise<ProbabilityEstimate>;
}
