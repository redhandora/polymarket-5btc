import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RiskState } from '../risk/risk-manager.js';

const STATE_FILE = 'data/state.json';

export interface PersistedState {
  riskState: RiskState;
  lastWindowId: string | null;
  lastTradeDate: string | null;
}

export function saveState(state: PersistedState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function loadState(): PersistedState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}
