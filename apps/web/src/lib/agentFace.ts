import type { AgentProvider } from '../store/workspace'

// provider 品牌图标（取自 apps/web/src/assets/providers），用 import.meta.glob 同步取源码
const providerMarkups = import.meta.glob('../assets/providers/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const FACE_SIZE = 128

const FALLBACKS: Record<string, { label: string; bg: string; accent: string; fg: string }> = {
  cursor: { label: 'CU', bg: '#0f172a', accent: '#e2e8f0', fg: '#f8fafc' },
  claude: { label: 'CC', bg: '#0f172a', accent: '#D97757', fg: '#ffffff' },
  codex: { label: 'CX', bg: '#0f172a', accent: '#e2e8f0', fg: '#f8fafc' },
  workbuddy: { label: 'WB', bg: '#0f172a', accent: '#2563eb', fg: '#ffffff' },
  trae: { label: 'TR', bg: '#0f172a', accent: '#32F08C', fg: '#052e1b' },
  unknown: { label: '', bg: '#334155', accent: '#64748b', fg: '#e2e8f0' },
}

const UNKNOWN_FALLBACK = FALLBACKS.unknown

function fallbackFor(name: string) {
  return (FALLBACKS as Record<string, { label: string; bg: string; accent: string; fg: string }>)[name] || UNKNOWN_FALLBACK
}

/**
 * 生成小人头部贴图：provider 品牌图标 + 纯色底盘。
 * 返回一个 Promise，SVG 解码失败时回退到首字字母贴图。
 */
export async function makeAgentFace(provider: AgentProvider | string) {
  const name = String(provider || 'unknown')
  const fallback = fallbackFor(name === 'custom' ? 'unknown' : name)
  const canvas = document.createElement('canvas')
  canvas.width = FACE_SIZE
  canvas.height = FACE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.fillStyle = fallback.bg
  ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)

  const svg = Object.entries(providerMarkups).find(([path]) => path.endsWith(`/${name}.svg`))?.[1]
  const image = svg ? await loadSvg(svg, fallback.fg) : null
  if (image) {
    const inset = FACE_SIZE * 0.14
    ctx.drawImage(image, inset, inset, FACE_SIZE - inset * 2, FACE_SIZE - inset * 2)
  } else if (fallback.label) {
    ctx.fillStyle = fallback.fg
    ctx.font = `700 ${FACE_SIZE * 0.42}px Inter, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(fallback.label, FACE_SIZE / 2, FACE_SIZE / 2 + FACE_SIZE * 0.02)
  } else {
    drawBotFace(ctx, fallback.fg)
  }

  ctx.fillStyle = fallback.accent
  ctx.fillRect(0, FACE_SIZE * 0.88, FACE_SIZE, FACE_SIZE * 0.12)
  return canvas
}

function drawBotFace(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(FACE_SIZE * 0.46, FACE_SIZE * 0.14, FACE_SIZE * 0.08, FACE_SIZE * 0.16)
  ctx.beginPath()
  ctx.arc(FACE_SIZE / 2, FACE_SIZE * 0.14, FACE_SIZE * 0.05, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(FACE_SIZE * 0.24, FACE_SIZE * 0.4, FACE_SIZE * 0.16, FACE_SIZE * 0.22)
  ctx.fillRect(FACE_SIZE * 0.6, FACE_SIZE * 0.4, FACE_SIZE * 0.16, FACE_SIZE * 0.22)
  ctx.fillRect(FACE_SIZE * 0.36, FACE_SIZE * 0.7, FACE_SIZE * 0.28, FACE_SIZE * 0.07)
}

async function loadSvg(svg: string, tint: string): Promise<HTMLImageElement | null> {
  const mono = svg.includes('currentColor') ? svg.replace(/currentColor/g, tint) : svg
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mono)}`
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    return null
  }
  return image
}
