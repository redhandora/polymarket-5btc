# Polymarket 5-Min BTC Trading System

Automated trading system for Polymarket 5-minute BTC Up/Down binary markets.

## Setup

```bash
npm install
cp .env.example .env
# Fill in your Polymarket API credentials in .env
```

## Configuration

All parameters are in `src/config.ts` with sensible defaults. Override via `.env` or pass overrides to `loadConfig()`.

Key parameters:
- Entry window: 35-75s into each 5-min window
- Price bands: maker [0.53, 0.60]
- Edge threshold: 2% (maker), 5% (taker)
- Risk: 0.75% per trade, 3% daily max loss, 3 consecutive loss halt

## Run

```bash
# Live trading (requires Polymarket API credentials)
npx tsx src/index.ts

# Paper trading — real-time simulation, no real orders
npx tsx src/index.ts --paper 1000

# Historical backtest
npx tsx src/index.ts --backtest 1000 2024-01-01 2024-01-31

# Type-check
npm run typecheck

# Tests
npm test
```

### Live trading

Requires `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, and `POLYMARKET_PASSPHRASE` set in `.env`. Bankroll is read from your Polymarket account balance. Optionally cap it with `MAX_BANKROLL=500`.

### Paper trading (`--paper <bankroll>`)

Uses the real BTC price feed and real Polymarket market discovery, but all orders are simulated. Every log line is prefixed with `[PAPER]`. Press `Ctrl+C` to stop and see the final PnL summary.

### Historical backtest (`--backtest <bankroll> <start> <end>`)

Fetches historical Polymarket market data via `data-api.polymarket.com` and BTC prices via Binance klines. Runs the full strategy pipeline (filters → risk → entry → stop) on each 5-min window and prints a report:

```
── Backtest Report ──────────────────
Period:     2024-01-01 → 2024-01-07
Bankroll:   $1000.00 → $1043.20 (+4.32%)
Trades:     18 total (12 wins, 6 losses, 55 skipped)
Win rate:   66.7%
Avg win:    $6.80  |  Avg loss: $-4.20
─────────────────────────────────────
```

No API credentials needed — both data sources are public.

## Architecture

```
src/
├── index.ts              # Entry point — dispatches to live / paper / backtest
├── config.ts             # Typed config with defaults
├── types.ts              # Shared interfaces
├── market-data/
│   ├── polymarket-client.ts   # Polymarket CLOB interface
│   ├── btc-price.ts           # Binance BTC price feed
│   └── polymarket-history.ts  # Historical price fetcher (backtest)
├── signal/               # Pluggable probability estimator
├── strategy/             # Window detection, filters, entry/exit logic
├── execution/            # Order placement and fill tracking
├── risk/                 # Position sizing, daily loss, consecutive loss
├── persistence/          # Trade logging (JSONL) and state recovery
└── backtest/
    ├── sim-client.ts     # Simulated PolymarketClient (no real orders)
    ├── historical.ts     # Historical backtest engine
    ├── paper-trading.ts  # Real-time paper trading engine
    └── report.ts         # Backtest report printer
```

## Signal Model

The system uses a pluggable `ProbabilityEstimator` interface. The included placeholder uses BTC price delta to nudge from 50/50. Replace `src/signal/placeholder.ts` with your own model.
