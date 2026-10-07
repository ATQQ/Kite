<script setup lang="ts">
import { computed } from 'vue'
import { Bot } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  provider: string
  size?: number
}>(), {
  size: 18,
})

const modules = import.meta.glob('../assets/providers/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const markups: Record<string, string> = {}
for (const [path, raw] of Object.entries(modules)) {
  const name = path.split('/').pop()!.replace(/\.svg$/, '')
  markups[name] = raw.replace(/<svg([^>]*)>/, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/g, '')
    return `<svg${cleaned} width="100%" height="100%">`
  })
}

const markup = computed(() => markups[props.provider] ?? '')
</script>

<template>
  <span
    v-if="markup"
    class="inline-flex shrink-0 items-center justify-center"
    :style="{ width: `${size}px`, height: `${size}px` }"
    v-html="markup"
  />
  <Bot
    v-else
    class="shrink-0 text-textMuted"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>
