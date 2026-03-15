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
- Write a CHANGELOG entry for significant changes (new features, breaking changes, important fixes).
- When changes affect behavior described in `README.md`, update `README.md` (and `README_zh.md`) to stay consistent.

## Polymarket API notes

### Gamma API slug ≠ 窗口开始时间
- slug 格式 `btc-updown-5m-{ts}` 中的 `{ts}` 不是交易窗口的开始时间
- 实际交易窗口在 `events[0].startTime`（开始）和 `endDate`（结束）
- 例：slug `btc-updown-5m-1772295000`（epoch = 2026-03-01 00:10 UTC）实际对应 **Feb 28, 11:10AM-11:15AM ET**（`startTime: 2026-02-28T16:10:00Z`）
- 回测中用 slug 时间戳当作窗口开始时间来构建 `windowMarketMap` 是错误的，会导致价格查询时间错位
- 正确做法：用 `events[0].startTime` 解析实际窗口开始时间，或者用 `eventStartTime` 字段

### CLOB prices-history 参数
- 不要使用 `interval=max&fidelity=10`，这会导致 5 分钟窗口只返回 1 个聚合价格点
- 不带 interval/fidelity 参数时，每个窗口返回 2~5 个原始成交价格点，价格波动范围真实（如 0.025~0.995）
- 当前已修复：`fetchHistoricalPrices` 只传 `market`、`startTs`、`endTs`

## Coding style
- Follow existing repository conventions.
- Add comments for non-obvious trading logic.
- Favor small functions and explicit naming.
