# AGENTS.md

## Project intent
This repo implements an automated trading system for Polymarket short-duration BTC markets.

## Rules
- Prefer minimal, local changes over broad refactors.
- Keep strategy logic configurable.
- Do not hardcode thresholds in business logic.
- Separate strategy, execution, market data, risk, and persistence concerns.
- Avoid taker fallback unless explicitly enabled by config.
- Never add pyramiding or reverse-position logic unless explicitly requested.

## Validation
- Run tests after changes.
- If tests do not exist, add focused tests for new strategy behavior.
- Summarize changed files and rationale at the end.

## Documentation
- `README.md` and `README_zh.md` must be kept in sync. When updating one, update the other accordingly.

## Coding style
- Follow existing repository conventions.
- Add comments for non-obvious trading logic.
- Favor small functions and explicit naming.
