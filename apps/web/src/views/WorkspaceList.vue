<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Boxes, Copy, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import { useWorkspaceStore } from '../store/workspace'
import { useToast } from '../composables/useToast'

const { t } = useI18n()
const router = useRouter()
const workspaceStore = useWorkspaceStore()
const toast = useToast()

const showCreate = ref(false)
const creating = ref(false)
const name = ref('')
const description = ref('')
const issuedToken = ref('')

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
      </article>
    </section>
  </div>
</template>
