import { computed, ref, watch, type Ref } from 'vue'

export interface BulkSelectionApi<T extends { id: string }> {
  selectedIds: Ref<Set<string>>
  selectedCount: Ref<number>
  selectedItems: Ref<T[]>
  isSelected: (id: string) => boolean
  toggle: (id: string) => void
  select: (id: string) => void
  deselect: (id: string) => void
  selectAll: () => void
  clear: () => void
  isAllSelected: Ref<boolean>
  isIndeterminate: Ref<boolean>
}

export function useBulkSelection<T extends { id: string }>(
  source: Ref<readonly T[]>
): BulkSelectionApi<T> {
  const selectedIds = ref<Set<string>>(new Set())

  watch(source, (next) => {
    if (selectedIds.value.size === 0) return
    const validIds = new Set(next.map((item) => item.id))
    const filtered = new Set<string>()
    let changed = false
    for (const id of selectedIds.value) {
      if (validIds.has(id)) filtered.add(id)
      else changed = true
    }
    if (changed) selectedIds.value = filtered
  })

  const selectedCount = computed(() => selectedIds.value.size)

  const selectedItems = computed(() =>
    source.value.filter((item) => selectedIds.value.has(item.id))
  )

  const isAllSelected = computed(() => {
    if (source.value.length === 0) return false
    return source.value.every((item) => selectedIds.value.has(item.id))
  })

  const isIndeterminate = computed(() => {
    const count = selectedIds.value.size
    return count > 0 && count < source.value.length
  })

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id)
  }

  function toggle(id: string) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function select(id: string) {
    if (selectedIds.value.has(id)) return
    const next = new Set(selectedIds.value)
    next.add(id)
    selectedIds.value = next
  }

  function deselect(id: string) {
    if (!selectedIds.value.has(id)) return
    const next = new Set(selectedIds.value)
    next.delete(id)
    selectedIds.value = next
  }

  function selectAll() {
    selectedIds.value = new Set(source.value.map((item) => item.id))
  }

  function clear() {
    if (selectedIds.value.size === 0) return
    selectedIds.value = new Set()
  }

  return {
    selectedIds,
    selectedCount,
    selectedItems,
    isSelected,
    toggle,
    select,
    deselect,
    selectAll,
    clear,
    isAllSelected,
    isIndeterminate,
  }
}
