<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '../store/project'
import { useThemeStore } from '../store/theme'
import type { ThemeMode } from '../store/theme'
import { useLocaleStore, SUPPORTED_LOCALES, type SupportedLocale } from '../store/locale'
import { Settings, Server, Key, HardDrive, Webhook, Save, CheckCircle2, AlertTriangle, Activity, Sun, Moon, Monitor, RefreshCw, Eye, EyeOff, Copy, HeartPulse, Terminal as TerminalIcon, Plus, X, Languages } from 'lucide-vue-next'

const { t } = useI18n()
const projectStore = useProjectStore()
const themeStore = useThemeStore()
const localeStore = useLocaleStore()

const themeOptions = computed<{ value: ThemeMode; label: string; icon: typeof Sun; desc: string }[]>(() => [
  { value: 'light', label: t('settings.themeLight'), icon: Sun, desc: t('theme.light') },
  { value: 'dark', label: t('settings.themeDark'), icon: Moon, desc: t('theme.dark') },
  { value: 'system', label: t('settings.themeSystem'), icon: Monitor, desc: t('theme.system') },
])

const localeOptions = computed<{ value: SupportedLocale; label: string }[]>(() =>
  SUPPORTED_LOCALES.map(v => ({ value: v, label: t(`locale.${v}`) }))
)

// System status
const status = ref<any>(null)
const health = ref<any>(null)
const healthLoading = ref(false)

const refreshHealth = async () => {
  healthLoading.value = true
  health.value = await projectStore.fetchHealthDetail()
  healthLoading.value = false
}

const formatBytes = (bytes: number | null) => {
  if (bytes == null) return 'N/A'
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(1)} MB`
}

const diskTone = (pct: number | null) => {
  if (pct == null) return 'text-textMuted'
  if (pct >= 95) return 'text-danger'
  if (pct >= 85) return 'text-yellow-400'
  return 'text-success'
}

// Settings form
const form = ref({
  webhook_url: '',
  webhook_events: [] as string[],
  default_deploy_path: '',
  max_upload_size: '50',
  global_deploy_token: '',
  artifact_keep_n: '10',
  deployment_stuck_threshold_min: '10',
})

const showGlobalToken = ref(false)
const isGlobalTokenCopied = ref(false)

const copyGlobalToken = () => {
  if (!form.value.global_deploy_token) return
  navigator.clipboard.writeText(form.value.global_deploy_token)
  isGlobalTokenCopied.value = true
  setTimeout(() => isGlobalTokenCopied.value = false, 2000)
}

// Token change form
const tokenForm = ref({
  oldToken: '',
  newToken: '',
  confirmPassword: ''
})
const tokenMessage = ref('')
const tokenMessageType = ref<'success' | 'error'>('success')

// Save state
const isSaving = ref(false)
const saveMessage = ref('')

const eventOptions = computed(() => [
  { key: 'deploy_success', label: t('settings.webhookEventDeploySuccess') },
  { key: 'deploy_failure', label: t('settings.webhookEventDeployFailure') },
])

onMounted(async () => {
  const [settingsData, statusData] = await Promise.all([
    projectStore.fetchSettings(),
    projectStore.fetchSystemStatus()
  ])
  status.value = statusData
  if (settingsData) {
    form.value.webhook_url = settingsData.webhook_url || ''
    form.value.webhook_events = settingsData.webhook_events ? settingsData.webhook_events.split(',') : []
    form.value.default_deploy_path = settingsData.default_deploy_path || ''
    form.value.max_upload_size = settingsData.max_upload_size || '50'
    form.value.global_deploy_token = settingsData.global_deploy_token || ''
    form.value.artifact_keep_n = settingsData.artifact_keep_n || '10'
    form.value.deployment_stuck_threshold_min = settingsData.deployment_stuck_threshold_min || '10'
  }
  refreshHealth()
  refreshTerminalAllowlist()
})

const saveSettings = async () => {
  isSaving.value = true
  saveMessage.value = ''
  const thresholdNum = Number(form.value.deployment_stuck_threshold_min)
  if (!Number.isInteger(thresholdNum) || thresholdNum < 1 || thresholdNum > 1440) {
    saveMessage.value = t('settings.stuckThresholdInvalid')
    isSaving.value = false
    setTimeout(() => saveMessage.value = '', 3000)
    return
  }
  const success = await projectStore.updateSettings({
    webhook_url: form.value.webhook_url,
    webhook_events: form.value.webhook_events.join(','),
    default_deploy_path: form.value.default_deploy_path,
    max_upload_size: form.value.max_upload_size,
    global_deploy_token: form.value.global_deploy_token,
    artifact_keep_n: form.value.artifact_keep_n,
    deployment_stuck_threshold_min: String(thresholdNum),
  })
  saveMessage.value = success ? t('settings.saveOk') : t('settings.saveFail')
  isSaving.value = false
  setTimeout(() => saveMessage.value = '', 3000)
}

const changeToken = async () => {
  tokenMessage.value = ''
  if (tokenForm.value.newToken !== tokenForm.value.confirmPassword) {
    tokenMessage.value = t('settings.tokenMismatch')
    tokenMessageType.value = 'error'
    return
  }
  if (tokenForm.value.newToken.length < 8) {
    tokenMessage.value = t('settings.tokenTooShort')
    tokenMessageType.value = 'error'
    return
  }
  const result = await projectStore.changeAdminToken(tokenForm.value.oldToken, tokenForm.value.newToken)
  if (result.success) {
    tokenMessage.value = result.message || t('settings.tokenUpdated')
    tokenMessageType.value = 'success'
    tokenForm.value = { oldToken: '', newToken: '', confirmPassword: '' }
  } else {
    tokenMessage.value = result.error || t('settings.tokenChangeFailed')
    tokenMessageType.value = 'error'
  }
}

const generateGlobalToken = () => {
  const uuid = crypto.randomUUID().replace(/-/g, '')
  form.value.global_deploy_token = `kt_${uuid}`
}

const toggleEvent = (event: string) => {
  const idx = form.value.webhook_events.indexOf(event)
  if (idx >= 0) {
    form.value.webhook_events.splice(idx, 1)
  } else {
    form.value.webhook_events.push(event)
  }
}

const webhookTesting = ref(false)
const webhookTestResult = ref<{ success: boolean; message: string } | null>(null)

async function runWebhookTest() {
  if (!form.value.webhook_url || !form.value.webhook_url.trim()) {
    webhookTestResult.value = { success: false, message: t('settings.webhookFillFirst') }
    return
  }
  webhookTesting.value = true
  webhookTestResult.value = null
  try {
    const r: any = await projectStore.testWebhook()
    if (r?.success) {
      webhookTestResult.value = {
        success: true,
        message: t('settings.webhookSendSuccess', { code: r.statusCode, ms: r.durationMs, attempts: r.attempts }),
      }
    } else {
      webhookTestResult.value = {
        success: false,
        message: r?.error || (r?.statusCode ? t('settings.webhookSendFailedWithCode', { code: r.statusCode }) : t('settings.webhookSendFailed')),
      }
    }
  } finally {
    webhookTesting.value = false
  }
}

// Terminal IP allowlist
const terminalAllowlist = ref<string[]>([])
const terminalAllowlistInput = ref('')
const terminalAllowlistMessage = ref('')
const terminalAllowlistMessageType = ref<'success' | 'error'>('success')
const terminalAllowlistSaving = ref(false)
const terminalAllowlistLoading = ref(false)
const terminalWhoami = ref<{ socketIp: string | null; forwardedIp: string | null; trustedIp: string | null } | null>(null)
const terminalAvailable = ref<boolean | null>(null)

async function refreshTerminalAllowlist() {
  terminalAllowlistLoading.value = true
  const [list, who, info] = await Promise.all([
    projectStore.fetchTerminalAllowlist(),
    projectStore.fetchTerminalWhoami(),
    projectStore.fetchTerminalInfo(),
  ])
  if (list) terminalAllowlist.value = list.entries
  terminalWhoami.value = who
  terminalAvailable.value = info?.available ?? null
  terminalAllowlistLoading.value = false
}

function showTerminalMsg(msg: string, type: 'success' | 'error') {
  terminalAllowlistMessage.value = msg
  terminalAllowlistMessageType.value = type
  setTimeout(() => { terminalAllowlistMessage.value = '' }, 3000)
}

function addTerminalAllowlistEntry(value?: string) {
  const candidate = (value ?? terminalAllowlistInput.value).trim()
  if (!candidate) return
  if (terminalAllowlist.value.includes(candidate)) {
    showTerminalMsg(t('settings.terminalDupEntry'), 'error')
    return
  }
  terminalAllowlist.value = [...terminalAllowlist.value, candidate]
  terminalAllowlistInput.value = ''
}

function removeTerminalAllowlistEntry(entry: string) {
  terminalAllowlist.value = terminalAllowlist.value.filter(e => e !== entry)
}

async function saveTerminalAllowlist() {
  terminalAllowlistSaving.value = true
  const result = await projectStore.updateTerminalAllowlist(terminalAllowlist.value)
  terminalAllowlistSaving.value = false
  if (result.success) {
    if (result.entries) terminalAllowlist.value = result.entries
    showTerminalMsg(t('settings.terminalSaveSuccess'), 'success')
  } else {
    showTerminalMsg(result.error || t('settings.saveFail'), 'error')
  }
}

function addCurrentIpToAllowlist() {
  const ip = terminalWhoami.value?.trustedIp || terminalWhoami.value?.socketIp
  if (!ip) {
    showTerminalMsg(t('settings.terminalCurrentIpUnknown'), 'error')
    return
  }
  addTerminalAllowlistEntry(ip)
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6 pb-12 p-4 sm:p-0">
    <!-- Header -->
    <div class="flex items-center space-x-3 mb-8">
      <Settings class="w-7 h-7 text-primary" />
      <h1 class="text-2xl font-bold text-textMain tracking-tight">{{ t('settings.pageTitle') }}</h1>
    </div>

    <!-- System Status Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain flex items-center">
          <Server class="w-5 h-5 mr-2 text-primary" />
          {{ t('settings.systemInfoTitle') }}
        </h2>
      </div>
      <div class="p-4 sm:p-6">
        <div v-if="status" class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-primary">{{ status.version }}</p>
            <p class="text-xs text-textMuted mt-1">{{ t('settings.versionNumber') }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-textMain">{{ status.uptime }}</p>
            <p class="text-xs text-textMuted mt-1">{{ t('settings.uptimeLabel') }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-textMain">{{ status.projectCount }}</p>
            <p class="text-xs text-textMuted mt-1">{{ t('settings.projectsCount') }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-textMain">{{ status.deploymentCount }}</p>
            <p class="text-xs text-textMuted mt-1">{{ t('settings.deploysCount') }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-success">{{ status.successCount }}</p>
            <p class="text-xs text-textMuted mt-1">{{ t('settings.successDeploys') }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-danger">{{ status.failedCount }}</p>
            <p class="text-xs text-textMuted mt-1">{{ t('settings.failedCount') }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center col-span-2">
            <div class="flex items-center justify-center space-x-2">
              <Activity class="w-5 h-5 text-primary" />
              <p class="text-2xl font-bold text-textMain">{{ status.successRate }}%</p>
            </div>
            <p class="text-xs text-textMuted mt-1">{{ t('settings.successRate') }}</p>
          </div>
        </div>
        <div v-else class="text-textMuted text-sm py-4 text-center">{{ t('settings.loading') }}</div>
      </div>
    </div>

    <!-- Health Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02] flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <HeartPulse class="w-5 h-5 mr-2 text-primary" />
            {{ t('settings.healthTitle') }}
          </h2>
          <p class="text-sm text-textMuted mt-1">
            <i18n-t keypath="settings.healthDesc" tag="span">
              <template #cmd><code class="font-mono text-primary">kite doctor</code></template>
            </i18n-t>
          </p>
        </div>
        <button
          @click="refreshHealth"
          :disabled="healthLoading"
          class="self-start sm:self-auto flex items-center px-3 py-2 bg-base border border-border rounded-md text-textMuted hover:text-textMain hover:border-primary/50 transition-all disabled:opacity-50"
          type="button"
        >
          <RefreshCw class="w-4 h-4" :class="healthLoading ? 'animate-spin' : ''" />
        </button>
      </div>
      <div class="p-4 sm:p-6">
        <div v-if="!health && !healthLoading" class="text-textMuted text-sm py-4 text-center">{{ t('settings.healthEmpty') }}</div>
        <div v-else-if="healthLoading && !health" class="text-textMuted text-sm py-4 text-center">{{ t('settings.loading') }}</div>
        <div v-else class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-base border border-border rounded-lg p-4">
            <div class="flex items-center justify-between mb-1">
              <p class="text-xs text-textMuted">DB</p>
              <CheckCircle2 v-if="health.db?.ok" class="w-4 h-4 text-success" />
              <AlertTriangle v-else class="w-4 h-4 text-danger" />
            </div>
            <p class="text-sm font-mono text-textMain truncate" :title="health.db?.path">{{ health.db?.path || 'N/A' }}</p>
            <p class="text-xs text-textMuted mt-1">{{ health.db?.latencyMs ?? '?' }} ms</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4">
            <div class="flex items-center justify-between mb-1">
              <p class="text-xs text-textMuted">{{ t('settings.healthKiteHome') }}</p>
              <CheckCircle2 v-if="health.kiteHome?.writable" class="w-4 h-4 text-success" />
              <AlertTriangle v-else class="w-4 h-4 text-danger" />
            </div>
            <p class="text-sm font-mono text-textMain truncate" :title="health.kiteHome?.path">{{ health.kiteHome?.path || 'N/A' }}</p>
            <p class="text-xs text-textMuted mt-1">{{ health.kiteHome?.tmpWritable ? t('settings.healthTmpWritable') : t('settings.healthTmpNotWritable') }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4">
            <div class="flex items-center justify-between mb-1">
              <p class="text-xs text-textMuted">{{ t('settings.healthDisk') }}</p>
              <Activity class="w-4 h-4" :class="diskTone(health.disk?.percentUsed)" />
            </div>
            <p class="text-sm font-mono" :class="diskTone(health.disk?.percentUsed)">
              {{ health.disk?.percentUsed != null ? health.disk.percentUsed + '%' : 'N/A' }}
            </p>
            <p class="text-xs text-textMuted mt-1">{{ t('settings.healthDiskAvail', { value: formatBytes(health.disk?.freeBytes) }) }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4">
            <div class="flex items-center justify-between mb-1">
              <p class="text-xs text-textMuted">{{ t('settings.healthRecent5') }}</p>
              <Activity class="w-4 h-4 text-primary" />
            </div>
            <p class="text-sm font-mono text-textMain">
              {{ health.deploy?.successRate != null ? Math.round(health.deploy.successRate * 100) + '%' : 'N/A' }}
            </p>
            <p class="text-xs text-textMuted mt-1">{{ t('settings.healthRecentTotal', { n: health.deploy?.last5?.length ?? 0 }) }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 col-span-2">
            <p class="text-xs text-textMuted mb-1">{{ t('settings.healthRuntime') }}</p>
            <p class="text-sm font-mono text-textMain">{{ health.runtime?.name }} {{ health.runtime?.version }}</p>
            <p class="text-xs text-textMuted mt-1">{{ t('settings.healthRuntimeStats', { uptime: health.uptimeSec, rss: health.memoryMB?.rss, heap: health.memoryMB?.heapUsed }) }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 col-span-2">
            <p class="text-xs text-textMuted mb-1">{{ t('settings.healthServerTime') }}</p>
            <p class="text-sm font-mono text-textMain">{{ health.serverTime }}</p>
            <p class="text-xs text-textMuted mt-1">version {{ health.version }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Theme Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain flex items-center">
          <Sun class="w-5 h-5 mr-2 text-primary" />
          {{ t('settings.sectionAppearance') }}
        </h2>
        <p class="text-sm text-textMuted mt-1">{{ t('settings.sectionAppearanceDesc') }}</p>
      </div>
      <div class="p-4 sm:p-6 space-y-6">
        <div>
          <label class="block text-sm font-medium text-textMain mb-3">{{ t('settings.themeLabel') }}</label>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              v-for="opt in themeOptions"
              :key="opt.value"
              @click="themeStore.setMode(opt.value)"
              class="relative flex flex-col items-center p-4 rounded-lg border-2 transition-all"
              :class="themeStore.mode === opt.value
                ? 'border-primary bg-primary/5 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                : 'border-border hover:border-textMuted/50 bg-base'"
            >
              <component
                :is="opt.icon"
                class="w-6 h-6 mb-2"
                :class="themeStore.mode === opt.value ? 'text-primary' : 'text-textMuted'"
              />
              <span class="text-sm font-medium" :class="themeStore.mode === opt.value ? 'text-primary' : 'text-textMain'">{{ opt.label }}</span>
              <span class="text-xs text-textMuted mt-1">{{ opt.desc }}</span>
              <CheckCircle2
                v-if="themeStore.mode === opt.value"
                class="absolute top-2 right-2 w-4 h-4 text-primary"
              />
            </button>
          </div>
        </div>
        <div>
          <label class="text-sm font-medium text-textMain mb-3 flex items-center">
            <Languages class="w-4 h-4 mr-2 text-primary" />
            {{ t('settings.languageLabel') }}
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              v-for="opt in localeOptions"
              :key="opt.value"
              @click="localeStore.setLocale(opt.value)"
              class="relative flex items-center justify-center p-3 rounded-lg border-2 transition-all"
              :class="localeStore.locale === opt.value
                ? 'border-primary bg-primary/5 shadow-[0_0_12px_rgba(59,130,246,0.15)] text-primary'
                : 'border-border hover:border-textMuted/50 bg-base text-textMain'"
            >
              <span class="text-sm font-medium">{{ opt.label }}</span>
              <CheckCircle2
                v-if="localeStore.locale === opt.value"
                class="absolute top-2 right-2 w-4 h-4 text-primary"
              />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Admin Token Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain flex items-center">
          <Key class="w-5 h-5 mr-2 text-primary" />
          {{ t('settings.adminTokenTitle') }}
        </h2>
        <p class="text-sm text-textMuted mt-1">{{ t('settings.adminTokenDesc') }}</p>
      </div>
      <div class="p-4 sm:p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">{{ t('settings.currentTokenLabel') }}</label>
          <input
            v-model="tokenForm.oldToken"
            type="password"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            :placeholder="t('settings.currentTokenPlaceholder')"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">{{ t('settings.newTokenLabel') }}</label>
          <input
            v-model="tokenForm.newToken"
            type="password"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            :placeholder="t('settings.newTokenPlaceholder')"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">{{ t('settings.confirmTokenLabel') }}</label>
          <input
            v-model="tokenForm.confirmPassword"
            type="password"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            :placeholder="t('settings.confirmTokenPlaceholder')"
          />
        </div>
        <div v-if="tokenMessage" class="flex items-center space-x-2 text-sm" :class="tokenMessageType === 'success' ? 'text-success' : 'text-danger'">
          <CheckCircle2 v-if="tokenMessageType === 'success'" class="w-4 h-4" />
          <AlertTriangle v-else class="w-4 h-4" />
          <span>{{ tokenMessage }}</span>
        </div>
        <div class="pt-2 flex justify-end">
          <button
            @click="changeToken"
            class="flex items-center px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-md transition-all font-medium shadow-[0_0_15px_rgba(59,130,246,0.3)]"
          >
            <Key class="w-4 h-4 mr-2" />
            {{ t('settings.changeTokenBtn') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Deploy Config Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain flex items-center">
          <HardDrive class="w-5 h-5 mr-2 text-primary" />
          {{ t('settings.deployConfigTitle') }}
        </h2>
        <p class="text-sm text-textMuted mt-1">{{ t('settings.deployConfigDesc') }}</p>
      </div>
      <div class="p-4 sm:p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">{{ t('settings.globalDeployToken') }}</label>
          <div class="flex gap-2">
            <div class="relative flex-1">
              <input
                v-model="form.global_deploy_token"
                :type="showGlobalToken ? 'text' : 'password'"
                class="w-full bg-base border border-border rounded-md px-4 py-3 pr-10 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                :placeholder="t('settings.globalDeployTokenPlaceholder')"
              />
              <button
                @click="showGlobalToken = !showGlobalToken"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-textMain transition-colors"
                type="button"
              >
                <EyeOff v-if="showGlobalToken" class="w-4 h-4" />
                <Eye v-else class="w-4 h-4" />
              </button>
            </div>
            <button
              @click="generateGlobalToken"
              class="flex items-center px-3 bg-base border border-border rounded-md text-textMuted hover:text-textMain hover:border-primary/50 transition-all"
              :title="t('settings.genRandomToken')"
              type="button"
            >
              <RefreshCw class="w-4 h-4" />
            </button>
            <button
              @click="copyGlobalToken"
              :disabled="!form.global_deploy_token"
              class="flex items-center px-3 bg-base border border-border rounded-md text-textMuted hover:text-textMain hover:border-primary/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              :title="t('settings.copyToken')"
              type="button"
            >
              <CheckCircle2 v-if="isGlobalTokenCopied" class="w-4 h-4 text-success" />
              <Copy v-else class="w-4 h-4" />
            </button>
          </div>
          <p class="text-xs text-textMuted mt-2">{{ t('settings.globalDeployTokenHint') }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">{{ t('settings.defaultDeployPath') }}</label>
          <input
            v-model="form.default_deploy_path"
            type="text"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="e.g. .deployments"
          />
          <p class="text-xs text-textMuted mt-2">{{ t('settings.defaultDeployPathHint') }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">{{ t('settings.maxUploadSize') }}</label>
          <input
            v-model="form.max_upload_size"
            type="number"
            min="1"
            max="500"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="50"
          />
          <p class="text-xs text-textMuted mt-2">{{ t('settings.maxUploadSizeHint') }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">{{ t('settings.artifactKeepN') }}</label>
          <input
            v-model="form.artifact_keep_n"
            type="number"
            min="1"
            max="500"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="10"
          />
          <p class="text-xs text-textMuted mt-2">
            {{ t('settings.artifactKeepNHint1') }} <code class="font-mono text-textMain">~/.kite/deployments/&lt;projectId&gt;/artifacts/</code>{{ t('settings.artifactKeepNHint2') }} <code class="font-mono text-textMain">rollback</code> {{ t('settings.artifactKeepNHint3') }}
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">{{ t('settings.stuckThreshold') }}</label>
          <input
            v-model="form.deployment_stuck_threshold_min"
            type="number"
            min="1"
            max="1440"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="10"
          />
          <p class="text-xs text-textMuted mt-2">
            {{ t('settings.stuckThresholdHint') }}<strong class="text-textMain">{{ t('settings.stuckThresholdMark') }}</strong>{{ t('settings.stuckThresholdHint2') }}
          </p>
        </div>
      </div>
    </div>

    <!-- Webhook Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain flex items-center">
          <Webhook class="w-5 h-5 mr-2 text-primary" />
          {{ t('settings.webhookTitle') }}
        </h2>
        <p class="text-sm text-textMuted mt-1">{{ t('settings.webhookDesc') }}</p>
      </div>
      <div class="p-4 sm:p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">{{ t('settings.webhookUrlLabel') }}</label>
          <input
            v-model="form.webhook_url"
            type="url"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="https://example.com/webhook"
          />
          <p class="text-xs text-textMuted mt-2">{{ t('settings.webhookUrlHint') }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-3">{{ t('settings.webhookEvents') }}</label>
          <div class="flex flex-wrap gap-3">
            <button
              v-for="opt in eventOptions"
              :key="opt.key"
              @click="toggleEvent(opt.key)"
              class="flex items-center px-4 py-2 rounded-md text-sm font-medium border transition-all"
              :class="form.webhook_events.includes(opt.key)
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-base border-border text-textMuted hover:border-primary/30 hover:text-textMain'"
            >
              <CheckCircle2 v-if="form.webhook_events.includes(opt.key)" class="w-4 h-4 mr-2" />
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="pt-2 border-t border-border/60 flex flex-col gap-2">
          <div class="flex items-center gap-3">
            <button
              type="button"
              @click="runWebhookTest"
              :disabled="webhookTesting"
              class="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium border border-border bg-base text-textMain hover:border-primary/40 hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {{ webhookTesting ? t('settings.webhookSending') : t('settings.webhookSend') }}
            </button>
            <p class="text-xs text-textMuted">
              <i18n-t keypath="settings.webhookSendHint" tag="span">
                <template #kite><span class="font-mono">Kite</span></template>
              </i18n-t>
            </p>
          </div>
          <p
            v-if="webhookTestResult"
            class="text-xs font-mono"
            :class="webhookTestResult.success ? 'text-green-400' : 'text-red-400'"
          >
            {{ webhookTestResult.message }}
          </p>
        </div>
      </div>
    </div>

    <!-- Terminal IP Allowlist Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02] flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <TerminalIcon class="w-5 h-5 mr-2 text-primary" />
            {{ t('settings.terminalAllowlistTitle') }}
          </h2>
          <p class="text-sm text-textMuted mt-1">
            {{ t('settings.terminalAllowlistDesc1') }}<strong class="text-textMain">{{ t('settings.terminalAllowlistDescStrong') }}</strong>{{ t('settings.terminalAllowlistDesc2') }}
          </p>
        </div>
        <button
          @click="refreshTerminalAllowlist"
          class="flex items-center px-3 py-1.5 text-sm bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all self-start sm:self-auto"
          :disabled="terminalAllowlistLoading"
        >
          <RefreshCw class="w-4 h-4 mr-1.5" :class="terminalAllowlistLoading ? 'animate-spin' : ''" />
          {{ t('settings.terminalRefresh') }}
        </button>
      </div>
      <div class="p-4 sm:p-6 space-y-4">
        <div v-if="terminalAvailable === false" class="flex items-start gap-2 text-sm text-yellow-500 bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3">
          <AlertTriangle class="w-4 h-4 mt-0.5 shrink-0" />
          <span>{{ t('settings.terminalUnavailable') }}</span>
        </div>

        <div class="bg-base border border-border rounded-md p-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="text-sm">
              <div class="text-textMuted">{{ t('settings.terminalCurrentIp') }}</div>
              <div class="font-mono text-textMain mt-1">{{ terminalWhoami?.trustedIp || terminalWhoami?.socketIp || t('settings.terminalUnknownIp') }}</div>
              <div v-if="terminalWhoami?.forwardedIp && terminalWhoami.forwardedIp !== terminalWhoami.trustedIp" class="text-xs text-textMuted mt-1">
                {{ t('settings.terminalXffHint', { ip: terminalWhoami.forwardedIp }) }}
              </div>
            </div>
            <button
              @click="addCurrentIpToAllowlist"
              :disabled="!terminalWhoami?.trustedIp && !terminalWhoami?.socketIp"
              class="flex items-center px-3 py-2 text-sm bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-md transition-all disabled:opacity-50"
            >
              <Plus class="w-4 h-4 mr-1.5" />
              {{ t('settings.terminalAddToAllowlist') }}
            </button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-textMain mb-2">{{ t('settings.terminalAddIpCidr') }}</label>
          <div class="flex gap-2">
            <input
              v-model="terminalAllowlistInput"
              type="text"
              class="flex-1 bg-base border border-border rounded-md px-4 py-2.5 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
              :placeholder="t('settings.terminalIpPlaceholder')"
              @keydown.enter.prevent="addTerminalAllowlistEntry()"
            />
            <button
              @click="addTerminalAllowlistEntry()"
              class="flex items-center px-4 py-2.5 bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
            >
              <Plus class="w-4 h-4 mr-1.5" />
              {{ t('settings.terminalAddBtn') }}
            </button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-textMain mb-2">
            {{ t('settings.terminalAllowlistLabel', { n: terminalAllowlist.length }) }}
            <span v-if="terminalAllowlist.length === 0" class="ml-2 text-xs text-yellow-500 font-normal">{{ t('settings.terminalEmptyMeansDisabled') }}</span>
          </label>
          <div v-if="terminalAllowlist.length === 0" class="text-sm text-textMuted py-3">
            {{ t('settings.terminalNoEntries') }}
          </div>
          <ul v-else class="space-y-1.5">
            <li
              v-for="entry in terminalAllowlist"
              :key="entry"
              class="flex items-center justify-between gap-2 bg-base border border-border rounded-md px-3 py-2"
            >
              <span class="font-mono text-sm text-textMain truncate">{{ entry }}</span>
              <button
                @click="removeTerminalAllowlistEntry(entry)"
                class="p-1 text-textMuted hover:text-danger rounded transition-colors"
                :title="t('settings.terminalRemove')"
              >
                <X class="w-4 h-4" />
              </button>
            </li>
          </ul>
        </div>

        <div class="flex items-center justify-end gap-3 pt-2">
          <span v-if="terminalAllowlistMessage" class="text-sm" :class="terminalAllowlistMessageType === 'success' ? 'text-success' : 'text-danger'">
            {{ terminalAllowlistMessage }}
          </span>
          <button
            @click="saveTerminalAllowlist"
            :disabled="terminalAllowlistSaving"
            class="flex items-center px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-md transition-all font-medium disabled:opacity-50"
          >
            <Save class="w-4 h-4 mr-2" />
            {{ terminalAllowlistSaving ? t('settings.terminalSaving') : t('settings.terminalSaveAllowlist') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Save Bar -->
    <div class="flex items-center justify-end space-x-4 pt-4">
      <span v-if="saveMessage" class="text-sm" :class="saveMessage === t('settings.saveOk') ? 'text-success' : 'text-danger'">
        {{ saveMessage }}
      </span>
      <button
        @click="saveSettings"
        :disabled="isSaving"
        class="flex items-center px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-md transition-all font-medium shadow-[0_0_15px_rgba(59,130,246,0.3)] disabled:opacity-50"
      >
        <Save class="w-4 h-4 mr-2" />
        {{ isSaving ? t('settings.saveBtnPending') : t('settings.saveBtn') }}
      </button>
    </div>
  </div>
</template>
