export const CHIP_COLOR_PALETTE = ['blue', 'green', 'yellow', 'purple', 'pink', 'cyan', 'gray'] as const
export type ChipColor = typeof CHIP_COLOR_PALETTE[number]

export const ALLOWED_CHIP_COLORS = new Set<string>(CHIP_COLOR_PALETTE as readonly string[])

const COLOR_CLASS: Record<string, string> = {
  blue: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  green: 'bg-green-500/15 text-green-500 border-green-500/30',
  yellow: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
  purple: 'bg-purple-500/15 text-purple-500 border-purple-500/30',
  pink: 'bg-pink-500/15 text-pink-500 border-pink-500/30',
  cyan: 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30',
  gray: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

export function chipClass(color?: string | null): string {
  if (color && COLOR_CLASS[color]) return COLOR_CLASS[color]
  return 'bg-base text-textMuted border-border'
}

export function chipActiveClass(): string {
  return 'bg-primary/15 text-primary border-primary/40'
}

export function pickFreeColor<T extends { color?: string | null }>(items: T[]): ChipColor {
  const used = new Set<string>()
  for (const it of items) {
    if (it.color) used.add(it.color)
  }
  for (const color of CHIP_COLOR_PALETTE) {
    if (!used.has(color)) return color
  }
  return CHIP_COLOR_PALETTE[items.length % CHIP_COLOR_PALETTE.length]
}
