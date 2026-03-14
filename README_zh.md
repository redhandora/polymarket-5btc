# Polymarket 5 分钟 BTC 交易系统

针对 Polymarket 5 分钟 BTC 涨/跌二元市场的自动化交易系统。

## 安装

```bash
npm install
cp .env.example .env
# 在 .env 中填入你的 Polymarket API 凭证
```

## 配置

所有参数定义在 `src/config.ts`，均有默认值。可通过 `.env` 或调用 `loadConfig()` 时传入覆盖。

核心参数：
- 入场窗口：每个 5 分钟窗口的第 35-75 秒
- 价格区间：maker [0.53, 0.60]
- 边际阈值：2%（maker）、5%（taker）
- 风控：单笔 0.75%、日亏上限 3%、连亏 3 次暂停

## 运行

```bash
# 开发模式（无 API Key 时为模拟运行）
npm run dev

# 类型检查
npm run typecheck

# 运行测试
npm test
```

## 架构

```
src/
├── index.ts              # 主循环
├── config.ts             # 带默认值的类型化配置
├── types.ts              # 共享接口
├── market-data/          # Polymarket CLOB + Binance BTC 行情
├── signal/               # 可插拔概率估计器
├── strategy/             # 窗口检测、过滤器、入场/退出逻辑
├── execution/            # 下单与成交追踪
├── risk/                 # 仓位管理、日亏损、连亏追踪
└── persistence/          # 交易日志（JSONL）与状态恢复
```

## 信号模型

系统使用可插拔的 `ProbabilityEstimator` 接口。内置的占位实现基于 BTC 价格变动偏移 50/50 概率。替换 `src/signal/placeholder.ts` 即可接入自定义模型。
