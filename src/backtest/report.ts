/**
 * Backtest report: types and printer.
 */

export interface BacktestTrade {
  windowId: string;
  side: 'up' | 'down';
  entryPrice: number;
  exitPrice: number | null;
  pnlNet: number;
  stopTriggered: boolean;
}

export interface BacktestResult {
  startDate: string;
  endDate: string;
  initialBankroll: number;
  finalBankroll: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  skipCount: number;
  trades: BacktestTrade[];
}

export function printBacktestReport(result: BacktestResult): void {
  const { startDate, endDate, initialBankroll, finalBankroll, totalPnl, winCount, lossCount, skipCount, trades } = result;

  const totalTrades = winCount + lossCount;
  const pnlPct = (totalPnl / initialBankroll) * 100;
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;

  const wins = trades.filter((t) => t.pnlNet > 0);
  const losses = trades.filter((t) => t.pnlNet < 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlNet, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlNet, 0) / losses.length : 0;

  const sign = totalPnl >= 0 ? '+' : '';

  console.log('── Backtest Report ──────────────────');
  console.log(`Period:     ${startDate} → ${endDate}`);
  console.log(`Bankroll:   $${initialBankroll.toFixed(2)} → $${finalBankroll.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`);
  console.log(`Trades:     ${totalTrades} total (${winCount} wins, ${lossCount} losses, ${skipCount} skipped)`);
  console.log(`Win rate:   ${winRate.toFixed(1)}%`);
  console.log(`Avg win:    $${avgWin.toFixed(2)}  |  Avg loss: $${avgLoss.toFixed(2)}`);
  console.log('─────────────────────────────────────');

  if (trades.length > 0) {
    console.log('\nTrade log:');
    for (const t of trades) {
      const pnlStr = t.pnlNet >= 0 ? `+$${t.pnlNet.toFixed(2)}` : `-$${Math.abs(t.pnlNet).toFixed(2)}`;
      const stop = t.stopTriggered ? ' [STOP]' : '';
      console.log(`  ${t.windowId}  ${t.side.padEnd(4)}  entry=${t.entryPrice.toFixed(4)}  exit=${t.exitPrice?.toFixed(4) ?? 'n/a'}  pnl=${pnlStr}${stop}`);
    }
  }
}
