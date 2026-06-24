import { onMounted, onBeforeUnmount } from 'vue'

/**
 * 用 requestAnimationFrame 驱动一个 ~intervalMs 周期的调用。
 * 浏览器会在页面切到后台时自动暂停 rAF，所以这是一种廉价的「后台节流」实现。
 *
 * - 默认 immediate=true：start() 时同步立即触发一次（不等 rAF 帧），后续按 interval 节流。
 * - immediate=false：等到第一个 interval 结束才触发。
 * - 卸载时自动 cancel；不会在组件销毁后还触发回调。
 */
export interface UseIntervalRafOptions {
  immediate?: boolean
  // 异常回调，便于在 dev 时打印
  onError?: (err: unknown) => void
}

export function useIntervalRaf(
  fn: () => void | Promise<void>,
  intervalMs: number,
  options: UseIntervalRafOptions = {},
) {
  const { immediate = true, onError } = options
  let rafId: number | null = null
  let running = false
  let lastRunAt = 0
  let inFlight = false

  const invoke = async () => {
    if (inFlight) return
    inFlight = true
    lastRunAt = performance.now()
    try {
      await fn()
    } catch (err) {
      if (onError) onError(err)
    } finally {
      inFlight = false
    }
  }

  const tick = () => {
    if (!running) return
    const now = performance.now()
    if (now - lastRunAt >= intervalMs) {
      void invoke()
    }
    rafId = requestAnimationFrame(tick)
  }

  const start = () => {
    if (running) return
    running = true
    if (immediate) {
      // 同步立即触发一次，避免等 rAF 首帧带来的可感知延迟
      void invoke()
    } else {
      lastRunAt = performance.now()
    }
    rafId = requestAnimationFrame(tick)
  }

  const stop = () => {
    running = false
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  onMounted(() => start())
  onBeforeUnmount(() => stop())

  return { start, stop }
}
