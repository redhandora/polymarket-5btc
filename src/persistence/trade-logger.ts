import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TradeRecord } from '../types.js';
import type { TradingConfig } from '../config.js';

export interface TradeLogger {
  log(record: TradeRecord): void;
}

export function createTradeLogger(config: TradingConfig): TradeLogger {
  const dir = config.tradeLogDir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  return {
    log(record: TradeRecord): void {
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const filePath = join(dir, `trades-${date}.jsonl`);
      appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
    },
  };
}
