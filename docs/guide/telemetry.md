# 使用统计（Telemetry）

Kite 提供**可选的匿名使用统计**，用于让维护者了解 CLI 的真实使用规模与基本的运行环境分布。**默认完全关闭**，需要你主动开启。

> 设计目标：**单向、匿名、字段最少、随时可关**。不收集任何项目名、路径、Token、源码或部署日志。

## 一、统计什么

只在以下两个时刻上报一次：

- 启动内置服务（`kite serve`）→ 事件 `kite.serve.startup`
- 触发一次部署（`kite push`，**仅在调用入口**上报，与执行结果/耗时无关）→ 事件 `kite.push.start`

两个事件的字段**完全一致**，只有 `event` 字符串不同：

| 字段 | 示例 | 说明 |
|------|------|------|
| `event` | `kite.serve.startup` / `kite.push.start` | 事件名 |
| `ts` | `1735574400000` | 上报时间戳（毫秒） |
| `kiteVersion` | `0.2.3` | CLI 版本号 |
| `instanceId` | `b6f1c2d3-...` | 本地一次性生成的 UUID v4，**首次开启时**生成并持久化到 `~/.kite/config.json` |
| `os` | `darwin` / `linux` / `win32` | `process.platform` |
| `arch` | `x64` / `arm64` | `process.arch` |

## 二、不统计什么

- ❌ 不收集 IP / 主机名 / 用户名 / 邮箱
- ❌ 不收集项目 ID / 项目名 / 项目路径 / 文件名
- ❌ 不收集任何 Token / 密码 / 环境变量
- ❌ 不收集 push 的成功失败 / 耗时 / 体积 / 错误信息
- ❌ 不收集任何源码或部署日志
- ❌ 不使用 cookie / 浏览器指纹 / 设备指纹

## 三、如何开关

```bash
# 开启（首次开启会生成匿名 instanceId）
kite telemetry on

# 关闭
kite telemetry off

# 查看当前状态与匿名 ID（仅显示前 8 位）
kite telemetry status
```

开关状态写在 `~/.kite/config.json` 的 `telemetry` 字段。`kite serve` 启动时若 telemetry 开启，会在 banner 中提示当前状态与本页链接。

## 四、重置匿名 instanceId

匿名 ID 完全是本地随机 UUID，与服务器无任何绑定。如需重置：

1. `kite telemetry off`
2. 编辑 `~/.kite/config.json`，删除 `telemetryInstanceId` 字段
3. `kite telemetry on`（会生成新的 UUID）

## 五、上报端点

- 地址：`https://kite.sugarat.top/api/telemetry`
- 方法：`POST application/json`
- 行为：**fire-and-forget**——3 秒超时，失败完全忽略，**不影响**任何 CLI 命令的正常执行
- 不依赖第三方 SDK；只使用 Node 18+ 自带的 `globalThis.fetch`

## 六、数据如何对外公开

所有上报数据会做匿名聚合后**完全公开**：

- 可视化面板：[/stats](/stats)
- 原始 JSON：[/stats.json](/stats.json)
- 原始 CSV：[/stats.csv](/stats.csv)

我们承诺面板与原始数据**保持公开**；维护者本人也只能看到与公开面板**相同**的聚合数据。

## 七、对 CI / 离线环境的影响

- CI 环境与离线环境**完全不需要做任何特殊处理**——telemetry 默认就是关的
- 即便手动开启，请求失败也会被静默忽略，**不会**让 `kite serve` 或 `kite push` 失败或变慢

## 八、字段约束

字段清单受 [plan/2026-06-30-f27-telemetry.md](https://github.com/ATQQ/Kite/blob/main/plan/2026-06-30-f27-telemetry.md) 第 §2 节治理。**新增字段必须先更新该计划文档**，并通过开源仓库 PR 公开评审。
