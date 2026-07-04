---
title: 使用统计
outline: deep
---

# Kite 使用统计

Kite 的匿名使用统计完全公开透明。本页优先从**实时聚合 API** [`/api/public/telemetry/overview`](https://kite.sugarat.top/api/public/telemetry/overview?days=30) 拉取近 30 天数据；接口不可用时会自动回退到静态兜底文件 [/stats.json](/stats.json)（同源，另提供 [/stats.csv](/stats.csv)）。

> 数据由用户主动开启 `kite telemetry:on` 后的匿名上报聚合而来，**不含任何敏感字段**。详见[隐私说明](/guide/telemetry)。

<StatsPanel />
