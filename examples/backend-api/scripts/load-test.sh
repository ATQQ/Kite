#!/usr/bin/env bash
# 简易负载脚本：对本地 kite-backend-api（PM2 fork x4，reusePort 共享 4301 端口）打请求，
# 用于验证 Kite 「运行日志」页面的 PM2 自动关联 + 分屏对比展示。
#
# 用法：
#   ./scripts/load-test.sh                    # 默认 200 请求、并发 8、间隔 20ms
#   ./scripts/load-test.sh 500                # 总数=500
#   ./scripts/load-test.sh 500 16             # 总数=500，并发=16
#   ./scripts/load-test.sh 500 16 50          # 每批间隔 50ms
#
# 环境变量：
#   HOST=127.0.0.1  PORT=4301
#
# 每 20 个请求中，会随机穿插一次 /error（触发 stderr 日志），
# 便于观察 Kite 分屏面板里不同实例 out/err 日志的差异。

set -euo pipefail

TOTAL="${1:-200}"
CONCURRENCY="${2:-8}"
SLEEP_MS="${3:-20}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4301}"

BASE="http://${HOST}:${PORT}"

echo "==> load-test start"
echo "    target       : ${BASE}"
echo "    total        : ${TOTAL}"
echo "    concurrency  : ${CONCURRENCY}"
echo "    interval(ms) : ${SLEEP_MS}"
echo

# 探活：确认服务在线
if ! curl -sS --max-time 2 "${BASE}/health" >/dev/null; then
  echo "!! ${BASE}/health 不可达，请先启动 pm2 start ecosystem.config.cjs" >&2
  exit 1
fi

sent=0
batch=0
while [ "${sent}" -lt "${TOTAL}" ]; do
  batch=$((batch + 1))
  pids=()
  for _ in $(seq 1 "${CONCURRENCY}"); do
    if [ "${sent}" -ge "${TOTAL}" ]; then break; fi
    # 每 20 个请求穿插一次 /error
    if [ "$(( sent % 20 ))" -eq 19 ]; then
      path='/error'
    else
      case "$(( RANDOM % 3 ))" in
        0) path='/' ;;
        1) path='/health' ;;
        *) path="/probe/${RANDOM}" ;;
      esac
    fi
    (
      code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "${BASE}${path}" || echo 'ERR')
      printf '  [batch=%03d] %-24s -> %s\n' "${batch}" "${path}" "${code}"
    ) &
    pids+=("$!")
    sent=$((sent + 1))
  done
  # 等本批全部完成再进入下一批，形成清晰的时间片
  for p in "${pids[@]}"; do
    wait "${p}" || true
  done
  if [ "${SLEEP_MS}" -gt 0 ] && [ "${sent}" -lt "${TOTAL}" ]; then
    # sleep 支持小数（macOS/Linux GNU sleep 均可）
    sleep "$(awk "BEGIN{ printf \"%.3f\", ${SLEEP_MS}/1000 }")"
  fi
done

echo
echo "==> done. sent=${sent}"
echo "    在 Kite 管理端「运行日志」页勾选 4 个实例日志，点击「分屏对比」查看各进程分布。"
