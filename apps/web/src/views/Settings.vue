<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useProjectStore } from '../store/project'
import { useThemeStore } from '../store/theme'
import type { ThemeMode } from '../store/theme'
import { Settings, Server, Key, HardDrive, Webhook, Save, CheckCircle2, AlertTriangle, Activity, Sun, Moon, Monitor, RefreshCw, Eye, EyeOff, Copy, HeartPulse } from 'lucide-vue-next'

const projectStore = useProjectStore()
const themeStore = useThemeStore()

// Theme options
const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun; desc: string }[] = [
  { value: 'light', label: '浅色模式', icon: Sun, desc: '始终使用浅色主题' },
  { value: 'dark', label: '深色模式', icon: Moon, desc: '始终使用深色主题' },
  { value: 'system', label: '跟随系统', icon: Monitor, desc: '自动匹配系统外观设置' },
]

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

const eventOptions = [
  { key: 'deploy_success', label: '部署成功' },
  { key: 'deploy_failure', label: '部署失败' },
]

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
})

const saveSettings = async () => {
  isSaving.value = true
  saveMessage.value = ''
  const thresholdNum = Number(form.value.deployment_stuck_threshold_min)
  if (!Number.isInteger(thresholdNum) || thresholdNum < 1 || thresholdNum > 1440) {
    saveMessage.value = '卡死阈值需在 1~1440 分钟之间'
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
  saveMessage.value = success ? '保存成功' : '保存失败'
  isSaving.value = false
  setTimeout(() => saveMessage.value = '', 3000)
}

const changeToken = async () => {
  tokenMessage.value = ''
  if (tokenForm.value.newToken !== tokenForm.value.confirmPassword) {
    tokenMessage.value = '两次输入的新 Token 不一致'
    tokenMessageType.value = 'error'
    return
  }
  if (tokenForm.value.newToken.length < 8) {
    tokenMessage.value = '新 Token 长度不能少于 8 位'
    tokenMessageType.value = 'error'
    return
  }
  const result = await projectStore.changeAdminToken(tokenForm.value.oldToken, tokenForm.value.newToken)
  if (result.success) {
    tokenMessage.value = result.message || 'Token 已更新'
    tokenMessageType.value = 'success'
    tokenForm.value = { oldToken: '', newToken: '', confirmPassword: '' }
  } else {
    tokenMessage.value = result.error || '修改失败'
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
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6 pb-12 p-4 sm:p-0">
    <!-- Header -->
    <div class="flex items-center space-x-3 mb-8">
      <Settings class="w-7 h-7 text-primary" />
      <h1 class="text-2xl font-bold text-textMain tracking-tight">系统设置</h1>
    </div>

    <!-- System Status Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain flex items-center">
          <Server class="w-5 h-5 mr-2 text-primary" />
          系统信息
        </h2>
      </div>
      <div class="p-4 sm:p-6">
        <div v-if="status" class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-primary">{{ status.version }}</p>
            <p class="text-xs text-textMuted mt-1">版本号</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-textMain">{{ status.uptime }}</p>
            <p class="text-xs text-textMuted mt-1">运行时间</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-textMain">{{ status.projectCount }}</p>
            <p class="text-xs text-textMuted mt-1">项目总数</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-textMain">{{ status.deploymentCount }}</p>
            <p class="text-xs text-textMuted mt-1">部署总次数</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-success">{{ status.successCount }}</p>
            <p class="text-xs text-textMuted mt-1">成功部署</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center">
            <p class="text-2xl font-bold text-danger">{{ status.failedCount }}</p>
            <p class="text-xs text-textMuted mt-1">失败次数</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 text-center col-span-2">
            <div class="flex items-center justify-center space-x-2">
              <Activity class="w-5 h-5 text-primary" />
              <p class="text-2xl font-bold text-textMain">{{ status.successRate }}%</p>
            </div>
            <p class="text-xs text-textMuted mt-1">部署成功率</p>
          </div>
        </div>
        <div v-else class="text-textMuted text-sm py-4 text-center">加载中...</div>
      </div>
    </div>

    <!-- Health Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02] flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <HeartPulse class="w-5 h-5 mr-2 text-primary" />
            服务健康
          </h2>
          <p class="text-sm text-textMuted mt-1">实时探活 DB、磁盘、Kite Home 与最近部署成功率，等同 <code class="font-mono text-primary">kite doctor</code> 远端段。</p>
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
        <div v-if="!health && !healthLoading" class="text-textMuted text-sm py-4 text-center">暂无数据</div>
        <div v-else-if="healthLoading && !health" class="text-textMuted text-sm py-4 text-center">加载中...</div>
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
              <p class="text-xs text-textMuted">Kite Home</p>
              <CheckCircle2 v-if="health.kiteHome?.writable" class="w-4 h-4 text-success" />
              <AlertTriangle v-else class="w-4 h-4 text-danger" />
            </div>
            <p class="text-sm font-mono text-textMain truncate" :title="health.kiteHome?.path">{{ health.kiteHome?.path || 'N/A' }}</p>
            <p class="text-xs text-textMuted mt-1">tmp {{ health.kiteHome?.tmpWritable ? '可写' : '不可写' }}</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4">
            <div class="flex items-center justify-between mb-1">
              <p class="text-xs text-textMuted">磁盘</p>
              <Activity class="w-4 h-4" :class="diskTone(health.disk?.percentUsed)" />
            </div>
            <p class="text-sm font-mono" :class="diskTone(health.disk?.percentUsed)">
              {{ health.disk?.percentUsed != null ? health.disk.percentUsed + '%' : 'N/A' }}
            </p>
            <p class="text-xs text-textMuted mt-1">{{ formatBytes(health.disk?.freeBytes) }} 可用</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4">
            <div class="flex items-center justify-between mb-1">
              <p class="text-xs text-textMuted">最近 5 次部署</p>
              <Activity class="w-4 h-4 text-primary" />
            </div>
            <p class="text-sm font-mono text-textMain">
              {{ health.deploy?.successRate != null ? Math.round(health.deploy.successRate * 100) + '%' : 'N/A' }}
            </p>
            <p class="text-xs text-textMuted mt-1">共 {{ health.deploy?.last5?.length ?? 0 }} 条</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 col-span-2">
            <p class="text-xs text-textMuted mb-1">Runtime</p>
            <p class="text-sm font-mono text-textMain">{{ health.runtime?.name }} {{ health.runtime?.version }}</p>
            <p class="text-xs text-textMuted mt-1">uptime {{ health.uptimeSec }}s · 内存 RSS {{ health.memoryMB?.rss }}MB / Heap {{ health.memoryMB?.heapUsed }}MB</p>
          </div>
          <div class="bg-base border border-border rounded-lg p-4 col-span-2">
            <p class="text-xs text-textMuted mb-1">服务器时间</p>
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
          外观设置
        </h2>
        <p class="text-sm text-textMuted mt-1">选择界面的色彩方案，或跟随系统自动切换。</p>
      </div>
      <div class="p-4 sm:p-6">
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
    </div>

    <!-- Admin Token Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain flex items-center">
          <Key class="w-5 h-5 mr-2 text-primary" />
          管理员 Token
        </h2>
        <p class="text-sm text-textMuted mt-1">修改管理后台的登录凭证。修改后需使用新 Token 重新登录。</p>
      </div>
      <div class="p-4 sm:p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">当前 Token</label>
          <input
            v-model="tokenForm.oldToken"
            type="password"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="请输入当前 Token"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">新 Token</label>
          <input
            v-model="tokenForm.newToken"
            type="password"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="请输入新 Token（至少 8 位）"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">确认新 Token</label>
          <input
            v-model="tokenForm.confirmPassword"
            type="password"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="请再次输入新 Token"
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
            修改 Token
          </button>
        </div>
      </div>
    </div>

    <!-- Deploy Config Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain flex items-center">
          <HardDrive class="w-5 h-5 mr-2 text-primary" />
          全局部署配置
        </h2>
        <p class="text-sm text-textMuted mt-1">设置全局默认的部署参数，可在项目级别覆盖。</p>
      </div>
      <div class="p-4 sm:p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">全局部署 Token</label>
          <div class="flex gap-2">
            <div class="relative flex-1">
              <input
                v-model="form.global_deploy_token"
                :type="showGlobalToken ? 'text' : 'password'"
                class="w-full bg-base border border-border rounded-md px-4 py-3 pr-10 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                placeholder="留空则不启用全局 Token"
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
              title="生成随机 Token"
              type="button"
            >
              <RefreshCw class="w-4 h-4" />
            </button>
            <button
              @click="copyGlobalToken"
              :disabled="!form.global_deploy_token"
              class="flex items-center px-3 bg-base border border-border rounded-md text-textMuted hover:text-textMain hover:border-primary/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="复制 Token"
              type="button"
            >
              <CheckCircle2 v-if="isGlobalTokenCopied" class="w-4 h-4 text-success" />
              <Copy v-else class="w-4 h-4" />
            </button>
          </div>
          <p class="text-xs text-textMuted mt-2">所有项目共用的部署 Token。CLI 使用全局 Token 时，配合 --project 指定项目即可部署，无需为每个项目单独配置 Token。留空则禁用。</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">默认部署路径</label>
          <input
            v-model="form.default_deploy_path"
            type="text"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="e.g. .deployments"
          />
          <p class="text-xs text-textMuted mt-2">新项目创建时的默认部署目录（相对于工作目录）。</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">最大上传大小 (MB)</label>
          <input
            v-model="form.max_upload_size"
            type="number"
            min="1"
            max="500"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="50"
          />
          <p class="text-xs text-textMuted mt-2">单次部署上传的 ZIP 文件大小上限。</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">归档保留份数 (artifact_keep_n)</label>
          <input
            v-model="form.artifact_keep_n"
            type="number"
            min="1"
            max="500"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="10"
          />
          <p class="text-xs text-textMuted mt-2">
            每个项目保留最近多少份部署归档 ZIP（位于 <code class="font-mono text-textMain">~/.kite/deployments/&lt;projectId&gt;/artifacts/</code>），超出部分按时间倒序清理。
            归档保留越多，可回滚的历史越长，占用磁盘也越大。被任何 <code class="font-mono text-textMain">rollback</code> 引用的归档不会被清理。
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">卡死部署阈值 (分钟)</label>
          <input
            v-model="form.deployment_stuck_threshold_min"
            type="number"
            min="1"
            max="1440"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="10"
          />
          <p class="text-xs text-textMuted mt-2">
            部署日志页面中，运行时长超过该分钟数的"进行中"部署会显示<strong class="text-textMain">「标记为成功 / 失败」</strong>按钮，用于修正服务异常退出残留的状态。范围 1~1440，默认 10。
          </p>
        </div>
      </div>
    </div>

    <!-- Webhook Card -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain flex items-center">
          <Webhook class="w-5 h-5 mr-2 text-primary" />
          Webhook 通知
        </h2>
        <p class="text-sm text-textMuted mt-1">部署事件发生时，向指定 URL 发送 POST 通知。</p>
      </div>
      <div class="p-4 sm:p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">Webhook URL</label>
          <input
            v-model="form.webhook_url"
            type="url"
            class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            placeholder="https://example.com/webhook"
          />
          <p class="text-xs text-textMuted mt-2">留空则不发送通知。支持飞书、钉钉、Slack 等标准 Webhook。</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-textMain mb-3">触发事件</label>
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
      </div>
    </div>

    <!-- Save Bar -->
    <div class="flex items-center justify-end space-x-4 pt-4">
      <span v-if="saveMessage" class="text-sm" :class="saveMessage === '保存成功' ? 'text-success' : 'text-danger'">
        {{ saveMessage }}
      </span>
      <button
        @click="saveSettings"
        :disabled="isSaving"
        class="flex items-center px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-md transition-all font-medium shadow-[0_0_15px_rgba(59,130,246,0.3)] disabled:opacity-50"
      >
        <Save class="w-4 h-4 mr-2" />
        {{ isSaving ? '保存中...' : '保存配置' }}
      </button>
    </div>
  </div>
</template>
