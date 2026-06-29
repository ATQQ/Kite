<script setup lang="ts">
import { ref, computed, onBeforeUnmount, nextTick, watch } from 'vue'
import { Plus, Tag as TagIcon, X as XIcon, Check } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useProjectStore, type Tag as TagType } from '../store/project'
import { chipClass as tagChipClass } from '../utils/color-chip'
import { useToast } from '../composables/useToast'

interface Props {
  modelValue: string[]
  size?: 'sm' | 'md'
  // 是否禁止内联保存（详情页表单走「保存配置」按钮统一保存时设为 true）
  readOnlySave?: boolean
  // 当 readOnlySave=false 时调用方在每次变更后做的持久化回调
  onPersist?: (next: string[]) => Promise<void> | void
  // 触发节点的可访问标签
  ariaLabel?: string
}
const props = withDefaults(defineProps<Props>(), {
  size: 'sm',
  readOnlySave: false,
  onPersist: undefined,
  ariaLabel: undefined,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const { t: tt } = useI18n()
const projectStore = useProjectStore()
const toast = useToast()

const resolvedAriaLabel = computed(() => props.ariaLabel ?? tt('project.tagsEditor.ariaLabel'))

const tagMap = computed(() => {
  const m = new Map<string, TagType>()
  for (const t of projectStore.tags) m.set(t.id, t)
  return m
})

const selected = computed<string[]>(() => Array.isArray(props.modelValue) ? props.modelValue : [])

const open = ref(false)
const popoverEl = ref<HTMLElement | null>(null)
const triggerEl = ref<HTMLElement | null>(null)
const newName = ref('')
const submitting = ref(false)

// 弹层定位：fixed + 实时计算坐标，避免被外层 overflow-hidden / transform 截断
const popStyle = ref<Record<string, string>>({})
function recomputePosition() {
  if (!triggerEl.value) return
  const r = triggerEl.value.getBoundingClientRect()
  const width = 280
  let left = r.left
  // 防止超出右边
  const maxLeft = window.innerWidth - width - 8
  if (left > maxLeft) left = Math.max(8, maxLeft)
  let top = r.bottom + 4
  // 防止超出下方
  if (top + 320 > window.innerHeight) {
    top = Math.max(8, r.top - 4 - 320)
  }
  popStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    'z-index': '60',
  }
}

async function openPicker(e: Event) {
  e.stopPropagation()
  if (open.value) {
    closePicker()
    return
  }
  if (projectStore.tags.length === 0) {
    await projectStore.fetchTags()
  }
  open.value = true
  await nextTick()
  recomputePosition()
}
function closePicker() {
  open.value = false
  newName.value = ''
}
function onDocClick(ev: MouseEvent) {
  if (!open.value) return
  const target = ev.target as Node
  if (popoverEl.value?.contains(target)) return
  if (triggerEl.value?.contains(target)) return
  closePicker()
}
function onWindowChange() {
  if (open.value) recomputePosition()
}
function onKey(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') closePicker()
}
document.addEventListener('click', onDocClick, true)
window.addEventListener('resize', onWindowChange)
window.addEventListener('scroll', onWindowChange, true)
document.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  window.removeEventListener('resize', onWindowChange)
  window.removeEventListener('scroll', onWindowChange, true)
  document.removeEventListener('keydown', onKey)
})

async function commit(next: string[]) {
  emit('update:modelValue', next)
  if (props.readOnlySave) return
  if (!props.onPersist) return
  try {
    await props.onPersist(next)
  } catch (err: any) {
    toast.error(tt('project.tagsEditor.saveFailed'), err?.message || tt('project.tagsEditor.retryHint'))
  }
}

async function toggleExisting(id: string) {
  const cur = [...selected.value]
  const idx = cur.indexOf(id)
  if (idx === -1) cur.push(id)
  else cur.splice(idx, 1)
  await commit(cur)
}

async function removeOne(id: string, ev?: Event) {
  ev?.stopPropagation()
  await commit(selected.value.filter((x) => x !== id))
}

async function createAndAttach() {
  const name = newName.value.trim()
  if (!name || submitting.value) return
  submitting.value = true
  try {
    const exist = projectStore.tags.find((t) => t.name === name)
    if (exist) {
      if (!selected.value.includes(exist.id)) {
        await commit([...selected.value, exist.id])
      }
      newName.value = ''
      return
    }
    const res = await projectStore.createTag({ name })
    if (res.ok && res.tag) {
      await commit([...selected.value, res.tag.id])
      newName.value = ''
      return
    }
    // 409 服务端冲突：兜底从最新 tags 里按名找
    if (res.conflictTag) {
      await projectStore.fetchTags()
      const found = projectStore.tags.find((t) => t.name === res.conflictTag)
      if (found) {
        if (!selected.value.includes(found.id)) {
          await commit([...selected.value, found.id])
        }
        newName.value = ''
        return
      }
    }
    toast.error(tt('project.tagsEditor.createFailed'), res.error || tt('project.tagsEditor.retryHint'))
  } finally {
    submitting.value = false
  }
}

const chipPaddingClass = computed(() => props.size === 'md' ? 'px-2 py-0.5 text-xs' : 'px-2 py-0.5 text-[10px]')

watch(() => props.modelValue, () => {
  if (open.value) nextTick(recomputePosition)
})
</script>

<template>
  <div class="inline-flex items-center flex-wrap gap-1.5 align-middle" @click.stop>
    <template v-for="tid in selected" :key="tid">
      <span
        v-if="tagMap.get(tid)"
        class="group/tag inline-flex items-center rounded border transition-colors"
        :class="[chipPaddingClass, tagChipClass(tagMap.get(tid)?.color)]"
      >
        <TagIcon class="w-3 h-3 mr-1" />
        {{ tagMap.get(tid)?.name }}
        <button
          type="button"
          class="ml-1 -mr-0.5 opacity-60 hover:opacity-100 hover:text-danger transition-opacity"
          :title="tt('project.tagsEditor.removeTitle', { name: tagMap.get(tid)?.name })"
          @click="removeOne(tid, $event)"
        >
          <XIcon class="w-3 h-3" />
        </button>
      </span>
    </template>
    <button
      ref="triggerEl"
      type="button"
      class="inline-flex items-center rounded border border-dashed border-border text-textMuted hover:text-primary hover:border-primary/50 transition-colors"
      :class="chipPaddingClass"
      :aria-label="resolvedAriaLabel"
      :title="resolvedAriaLabel"
      @click="openPicker"
    >
      <Plus class="w-3 h-3 mr-0.5" />
      <span>{{ tt('project.tagsEditor.triggerLabel') }}</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="popoverEl"
        :style="popStyle"
        class="bg-panel border border-border rounded-lg shadow-xl p-3 text-xs"
        @click.stop
      >
        <div class="flex items-center justify-between mb-2">
          <span class="text-textMuted">{{ tt('project.tagsEditor.pickHint') }}</span>
          <button type="button" class="text-textMuted hover:text-textMain" @click="closePicker" :title="tt('project.tagsEditor.closeTitle')">
            <XIcon class="w-3.5 h-3.5" />
          </button>
        </div>
        <div class="flex items-center flex-wrap gap-1.5 max-h-40 overflow-auto mb-2 pr-1">
          <template v-if="projectStore.tags.length > 0">
            <button
              v-for="t in projectStore.tags"
              :key="t.id"
              type="button"
              @click="toggleExisting(t.id)"
              class="inline-flex items-center px-2 py-0.5 rounded border transition-colors"
              :class="selected.includes(t.id) ? `${tagChipClass(t.color)} ring-1 ring-primary/40` : 'bg-base text-textMuted border-border hover:text-textMain hover:border-textMuted/40'"
            >
              <Check v-if="selected.includes(t.id)" class="w-3 h-3 mr-1" />
              <TagIcon v-else class="w-3 h-3 mr-1" />
              {{ t.name }}
            </button>
          </template>
          <span v-else class="text-textMuted">{{ tt('project.tagsEditor.emptyHint') }}</span>
        </div>
        <form class="flex items-center gap-1.5" @submit.prevent="createAndAttach">
          <input
            v-model="newName"
            type="text"
            maxlength="30"
            :placeholder="tt('project.tagsEditor.newPlaceholder')"
            class="flex-1 min-w-0 bg-base border border-border rounded px-2 py-1 text-xs text-textMain placeholder-textMuted/60 focus:outline-none focus:border-primary/60"
          />
          <button
            type="submit"
            class="inline-flex items-center px-2 py-1 rounded bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!newName.trim() || submitting"
            :title="tt('project.tagsEditor.addTitle')"
          >
            <Plus class="w-3 h-3 mr-0.5" /> {{ tt('project.tagsEditor.addBtn') }}
          </button>
        </form>
      </div>
    </Teleport>
  </div>
</template>
