<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Boxes, Building2, Copy, Plus, RefreshCw, Trash2, Users } from 'lucide-vue-next'
import { useWorkspaceStore } from '../store/workspace'
import { useToast } from '../composables/useToast'
import WorkspaceBoard3D from '../components/WorkspaceBoard3D.vue'

const { t } = useI18n()
const router = useRouter()
const workspaceStore = useWorkspaceStore()
const toast = useToast()

const showCreate = ref(false)
const creating = ref(false)
const name = ref('')
const description = ref('')
const issuedToken = ref('')

const FLEET_STATES = [
  { key: 'working', dot: 'bg-sky-400', bar: 'bg-sky-400' },
  { key: 'blocked', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  { key: 'stalled', dot: 'bg-red-500', bar: 'bg-red-500' },
  { key: 'idle', dot: 'bg-slate-500', bar: 'bg-slate-500' },
] as const

const fleetByWorkspace = computed(() => {
  const map = new Map<string, ReturnType<typeof buildFleet>>()
  for (const workspace of workspaceStore.workspaces) {
    map.set(workspace.id, buildFleet(workspace.agentStates))
  }
  return map
})

// 只给有 Agent 的工作空间做 3D 预览，默认选最"活跃"的那个（working 多者优先）
const previewCandidates = computed(() =>
  workspaceStore.workspaces
    .filter((workspace) => (workspace.agents?.length || 0) > 0)
    .slice()
    .sort((a, b) => (b.agentStates?.working || 0) - (a.agentStates?.working || 0)),
)

const previewId = ref<string>('')
const previewWorkspace = computed(() =>
  previewCandidates.value.find((workspace) => workspace.id === previewId.value) || previewCandidates.value[0] || null,
)
const previewAgents = computed(() => {
  const workspace = previewWorkspace.value
  if (!workspace) return []
  return (workspace.agents || []).map((agent) => ({
    ...agent,
    workspaceId: workspace.id,
    openTaskIds: [] as string[],
    lastSeenAt: workspace.updatedAt,
  }))
})

watch(
  () => previewCandidates.value.map((workspace) => workspace.id).join(','),
  () => {
    if (!previewCandidates.value.some((workspace) => workspace.id === previewId.value)) {
      previewId.value = previewCandidates.value[0]?.id || ''
    }
  },
  { immediate: true },
)

function onPreviewSelectAgent() {
  if (!previewWorkspace.value) return
  router.push(`/workspaces/${previewWorkspace.value.id}?tab=agents`)
}

function fleetSegments(workspace: { id: string }) {
  return fleetByWorkspace.value.get(workspace.id) || null
}

function buildFleet(states?: { working: number; blocked: number; stalled: number; idle: number }) {
  const total = states ? states.working + states.blocked + states.stalled + states.idle : 0
  if (!states || total === 0) return null
  return {
    total,
    segments: FLEET_STATES.map((state) => ({
      ...state,
      count: states[state.key],
      percent: (states[state.key] / total) * 100,
    })).filter((segment) => segment.count > 0),
  }
}

async function load() {
  await workspaceStore.fetchWorkspaces()
}

async function createWorkspace() {
  if (!name.value.trim()) return
  creating.value = true
  try {
    const result = await workspaceStore.createWorkspace({
      name: name.value.trim(),
      description: description.value.trim() || undefined,
    })
    issuedToken.value = result.token
    name.value = ''
    description.value = ''
    showCreate.value = false
    toast.success(t('workspace.tokenIssued'))
  } catch (error: any) {
    toast.error(error.message || t('workspace.createFailed'))
  } finally {
    creating.value = false
  }
}

async function copyToken() {
  await navigator.clipboard.writeText(issuedToken.value)
  toast.success(t('workspace.tokenCopied'))
}

async function removeWorkspace(id: string) {
  if (!window.confirm(t('workspace.archiveConfirm'))) return
  await workspaceStore.archiveWorkspace(id)
  toast.success(t('workspace.archived'))
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-6">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2 text-textMain">
          <Boxes class="h-5 w-5 text-primary" />
          <h1 class="text-2xl font-semibold">{{ t('workspace.title') }}</h1>
        </div>
        <p class="mt-1 text-sm text-textMuted">{{ t('workspace.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-textMuted hover:text-textMain" @click="load">
          <RefreshCw class="h-4 w-4" />
          {{ t('common.refresh') }}
        </button>
        <button class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90" @click="showCreate = true">
          <Plus class="h-4 w-4" />
          {{ t('workspace.create') }}
        </button>
      </div>
    </header>

    <section v-if="previewWorkspace" class="overflow-hidden rounded-lg border border-border bg-panel">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div class="flex min-w-0 items-center gap-2">
          <Building2 class="h-4 w-4 shrink-0 text-primary" />
          <h2 class="text-sm font-semibold text-textMain">{{ t('workspace.officePreview') }}</h2>
          <span class="truncate text-xs text-textMuted">{{ previewWorkspace.name }}</span>
        </div>
        <div class="flex items-center gap-2">
          <select
            v-model="previewId"
            class="h-8 max-w-[200px] rounded-md border border-border bg-base px-2 text-xs text-textMain outline-none focus:border-primary"
            :title="t('workspace.officeSwitch')"
          >
            <option v-for="workspace in previewCandidates" :key="workspace.id" :value="workspace.id">
              {{ workspace.name }}
            </option>
          </select>
          <button
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-textMuted hover:text-textMain"
            @click="router.push(`/workspaces/${previewWorkspace.id}?tab=agents`)"
          >
            <Users class="h-3.5 w-3.5" />
            {{ t('workspace.agentsTitle') }}
          </button>
        </div>
      </div>
      <div class="h-[260px] sm:h-[340px]">
        <WorkspaceBoard3D
          :agents="previewAgents"
          :tasks="[]"
          :unassigned="[]"
          compact
          @select-agent="onPreviewSelectAgent"
        />
      </div>
      <p class="border-t border-border px-5 py-2 text-[11px] text-textMuted">{{ t('workspace.officePreviewHint') }}</p>
    </section>

    <section v-if="issuedToken" class="rounded-lg border border-warning/40 bg-warning/5 p-4">
      <div class="text-sm font-medium text-textMain">{{ t('workspace.tokenIssued') }}</div>
      <p class="mt-1 text-xs text-textMuted">{{ t('workspace.tokenHint') }}</p>
      <div class="mt-3 flex items-center gap-2">
        <code class="min-w-0 flex-1 truncate rounded-md border border-border bg-base px-3 py-2 font-mono text-xs text-textMain">{{ issuedToken }}</code>
        <button class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-textMain hover:border-primary/50" @click="copyToken">
          <Copy class="h-4 w-4" />
          {{ t('common.copy') }}
        </button>
      </div>
    </section>

    <section v-if="showCreate" class="rounded-lg border border-border bg-panel p-5">
      <h2 class="text-sm font-semibold text-textMain">{{ t('workspace.create') }}</h2>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <label class="space-y-1.5">
          <span class="text-xs text-textMuted">{{ t('workspace.name') }}</span>
          <input v-model="name" class="w-full rounded-md border border-border bg-base px-3 py-2 text-sm text-textMain outline-none focus:border-primary" :placeholder="t('workspace.namePlaceholder')" />
        </label>
        <label class="space-y-1.5">
          <span class="text-xs text-textMuted">{{ t('workspace.description') }}</span>
          <input v-model="description" class="w-full rounded-md border border-border bg-base px-3 py-2 text-sm text-textMain outline-none focus:border-primary" :placeholder="t('workspace.descriptionPlaceholder')" />
        </label>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <button class="h-9 rounded-md border border-border px-3 text-sm text-textMuted hover:text-textMain" @click="showCreate = false">{{ t('common.cancel') }}</button>
        <button class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50" :disabled="creating || !name.trim()" @click="createWorkspace">
          {{ creating ? t('common.creating') : t('common.create') }}
        </button>
      </div>
    </section>

    <div v-if="workspaceStore.loading" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="i in 3" :key="i" class="h-44 animate-pulse rounded-lg border border-border bg-panel" />
    </div>

    <div v-else-if="workspaceStore.workspaces.length === 0" class="rounded-lg border border-dashed border-border bg-panel/60 px-6 py-14 text-center">
      <Boxes class="mx-auto h-8 w-8 text-textMuted" />
      <h2 class="mt-3 text-sm font-medium text-textMain">{{ t('workspace.empty') }}</h2>
      <p class="mt-1 text-xs text-textMuted">{{ t('workspace.emptyHint') }}</p>
    </div>

    <section v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="workspace in workspaceStore.workspaces"
        :key="workspace.id"
        class="group cursor-pointer rounded-lg border border-border bg-panel p-5 transition-colors hover:border-primary/40"
        @click="router.push(`/workspaces/${workspace.id}`)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold text-textMain">{{ workspace.name }}</h2>
            <p class="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-textMuted">{{ workspace.description || t('workspace.noDescription') }}</p>
          </div>
          <button
            class="rounded-md p-1.5 text-textMuted opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
            :title="t('workspace.archive')"
            @click.stop="removeWorkspace(workspace.id)"
          >
            <Trash2 class="h-4 w-4" />
          </button>
        </div>
        <div class="mt-5 grid grid-cols-4 gap-2 border-t border-border pt-4 text-center">
          <div><div class="text-lg font-semibold text-textMain">{{ workspace.projectCount || 0 }}</div><div class="text-[11px] text-textMuted">{{ t('workspace.projects') }}</div></div>
          <div><div class="text-lg font-semibold text-textMain">{{ workspace.requirementCount || 0 }}</div><div class="text-[11px] text-textMuted">{{ t('workspace.requirements') }}</div></div>
          <div><div class="text-lg font-semibold text-textMain">{{ workspace.taskCount || 0 }}</div><div class="text-[11px] text-textMuted">{{ t('workspace.tasks') }}</div></div>
          <div><div class="text-lg font-semibold text-textMain">{{ workspace.documentCount || 0 }}</div><div class="text-[11px] text-textMuted">{{ t('workspace.documents') }}</div></div>
        </div>

        <div v-if="fleetSegments(workspace)" class="mt-4 border-t border-border pt-3">
          <div class="flex items-center justify-between gap-2">
            <span class="inline-flex items-center gap-1.5 text-[11px] text-textMuted">
              <Users class="h-3 w-3" />
              {{ t('workspace.agentFleet') }}
            </span>
            <span class="text-[11px] tabular-nums text-textMuted">{{ fleetSegments(workspace)!.total }}</span>
          </div>
          <div class="mt-2 flex h-1.5 overflow-hidden rounded-full bg-base">
            <div
              v-for="segment in fleetSegments(workspace)!.segments"
              :key="segment.key"
              class="h-full"
              :class="segment.bar"
              :style="{ width: `${segment.percent}%` }"
            />
          </div>
          <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            <span v-for="segment in fleetSegments(workspace)!.segments" :key="segment.key" class="inline-flex items-center gap-1 text-[11px] text-textMuted">
              <i class="h-1.5 w-1.5 rounded-full" :class="segment.dot" />
              {{ t(`workspace.${segment.key}`) }} {{ segment.count }}
            </span>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>
