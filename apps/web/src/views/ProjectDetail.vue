<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import { ArrowLeft, Save, Key, Copy, RefreshCw, Trash2, CheckCircle2, TerminalSquare, FolderOpen, AlertTriangle, XCircle } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()

const projectId = route.params.id as string
const project = computed(() => projectStore.getProjectById(projectId))

const formData = ref({
  destPath: '',
  preDeploy: '',
  postDeploy: ''
})

const isTokenVisible = ref(false)
const isCopied = ref(false)
const copiedCommand = ref('')
const serverUrl = ref('http://127.0.0.1:3000')
const cliEnv = ref('')

onMounted(async () => {
  serverUrl.value = window.location.origin
  await projectStore.fetchProjects()
  if (project.value) {
    formData.value.destPath = project.value.destPath || ''
    formData.value.preDeploy = project.value.preDeploy || ''
    formData.value.postDeploy = project.value.postDeploy || ''
    cliEnv.value = project.value.env || ''
  } else {
    router.replace('/projects')
  }
})

const saveConfig = async () => {
  await projectStore.updateProject(projectId, formData.value)
  alert('配置已保存')
}

const copyToken = () => {
  if (project.value?.token) {
    navigator.clipboard.writeText(project.value.token)
    isCopied.value = true
    setTimeout(() => isCopied.value = false, 2000)
  }
}

const copyCommand = (key: string, value: string) => {
  navigator.clipboard.writeText(value)
  copiedCommand.value = key
  setTimeout(() => copiedCommand.value = '', 2000)
}

const envSuffix = computed(() => cliEnv.value.trim() ? ` --env ${cliEnv.value.trim()}` : '')
const configFileName = computed(() => cliEnv.value.trim() ? `kite.config.${cliEnv.value.trim()}.json` : 'kite.config.json')

const installCommand = 'npm install -g @kitecd/cli'
const initCommand = computed(() => `kite init --project ${projectId}${envSuffix.value} --out ./dist --server ${serverUrl.value} --token ${project.value?.token || '<DEPLOY_TOKEN>'}`)
const pushCommand = computed(() => `kite push${envSuffix.value}`)
const directPushCommand = computed(() => `kite push --server ${serverUrl.value} --project ${projectId}${envSuffix.value} --out ./dist`)
const directPushWithTokenCommand = computed(() => `kite push --server ${serverUrl.value} --project ${projectId} --token ${project.value?.token || '<DEPLOY_TOKEN>'}${envSuffix.value} --out ./dist`)
const configExample = computed(() => JSON.stringify({
  projectId,
  outputDir: './dist',
  files: ['**/*'],
  postDeploy: project.value?.postDeploy || 'pm2 restart your-service'
}, null, 2))

const configFilesExamples = [
  { label: '打包所有文件', files: ['**/*'] },
  { label: '只上传 dist 目录', files: ['dist/**/*'] },
  { label: '指定多个目录', files: ['dist/**/*', 'public/**/*'] },
  { label: '单个文件', files: ['index.html'] },
  { label: '混合配置', files: ['dist/**/*', 'server.js', 'config/*.json'] },
]

const refreshToken = async () => {
  if (confirm('重新生成 Token 将导致旧 Token 立即失效，是否继续？')) {
    await projectStore.generateToken(projectId)
    isTokenVisible.value = true
  }
}

const showDeleteModal = ref(false)
const deleteConfirmText = ref('')
const isDeleting = ref(false)
const deleteError = ref('')

const expectedConfirmName = computed(() => project.value?.name?.trim() || '')
const canConfirmDelete = computed(() =>
  !isDeleting.value &&
  expectedConfirmName.value.length > 0 &&
  deleteConfirmText.value.trim() === expectedConfirmName.value
)

function openDeleteModal() {
  deleteConfirmText.value = ''
  deleteError.value = ''
  isDeleting.value = false
  showDeleteModal.value = true
}

function closeDeleteModal() {
  if (isDeleting.value) return
  showDeleteModal.value = false
  deleteConfirmText.value = ''
  deleteError.value = ''
}

async function confirmDelete() {
  if (!canConfirmDelete.value) return
  isDeleting.value = true
  deleteError.value = ''
  try {
    const success = await projectStore.removeProject(projectId)
    if (success) {
      showDeleteModal.value = false
      router.replace('/projects')
    } else {
      deleteError.value = '删除失败，请稍后重试'
    }
  } catch (e: any) {
    deleteError.value = e?.message || '删除失败，请稍后重试'
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <div v-if="project" class="max-w-4xl mx-auto space-y-6 pb-12">
    <!-- Header -->
    <div class="flex items-center space-x-4 mb-8">
      <button 
        @click="router.back()"
        class="p-2 dark:hover:bg-white/10 hover:bg-black/10 rounded-full transition-colors text-textMuted hover:text-textMain"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div>
        <div class="flex items-center space-x-3">
          <h1 class="text-2xl font-bold text-textMain tracking-tight">{{ project.name }}</h1>
          <span
            class="px-2.5 py-0.5 text-xs rounded-md border"
            :class="project.status === 'success' ? 'bg-success/10 border-success/20 text-success' : 'bg-primary/10 border-primary/20 text-primary'"
          >
            {{ project.status }}
          </span>
          <router-link
            :to="`/projects/${projectId}/files`"
            class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
          >
            <FolderOpen class="w-3.5 h-3.5 mr-1.5" />
            查看文件
          </router-link>
        </div>
        <p class="text-sm text-textMuted mt-1 font-mono">{{ project.id }}</p>
      </div>
    </div>

    <!-- Main Content -->
    <div class="grid grid-cols-1 gap-8">
      
      <!-- Token Management Card -->
      <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <Key class="w-5 h-5 mr-2 text-primary" />
            鉴权 Token 管理
          </h2>
          <p class="text-sm text-textMuted mt-1">用于 CLI 或 Webhook 触发自动化部署的专属凭证。</p>
        </div>
        
        <div class="p-6">
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center space-y-4 sm:space-y-0 sm:space-x-4">
            <div class="relative flex-1">
              <input 
                :type="isTokenVisible ? 'text' : 'password'"
                readonly
                :value="project.token || '暂无 Token，请生成'"
                class="w-full bg-base border border-border rounded-md pl-4 pr-12 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary/50 transition-colors"
                :class="{'opacity-50 blur-[2px] select-none': !isTokenVisible && project.token}"
              />
              <button 
                v-if="project.token"
                @click="isTokenVisible = !isTokenVisible"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-textMain text-xs font-medium px-2 py-1 rounded transition-colors"
              >
                {{ isTokenVisible ? '隐藏' : '显示' }}
              </button>
            </div>
            
            <div class="flex items-center space-x-2">
              <button 
                @click="copyToken"
                :disabled="!project.token"
                class="flex items-center justify-center px-4 py-3 bg-base border border-border hover:border-primary/50 hover:text-primary text-textMain rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
              >
                <CheckCircle2 v-if="isCopied" class="w-4 h-4 mr-2 text-success" />
                <Copy v-else class="w-4 h-4 mr-2" />
                {{ isCopied ? '已复制' : '复制' }}
              </button>
              <button 
                @click="refreshToken"
                class="flex items-center justify-center px-4 py-3 bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-white rounded-md transition-all w-full sm:w-auto font-medium shadow-[0_0_10px_rgba(59,130,246,0.1)] hover:shadow-[0_0_15px_rgba(59,130,246,0.4)]"
              >
                <RefreshCw class="w-4 h-4 mr-2" />
                重新生成
              </button>
            </div>
          </div>
          
          <div class="mt-4 p-4 rounded-md bg-primary/5 border border-primary/10 text-sm">
            <p class="text-textMuted leading-relaxed">
              <strong class="text-primary font-medium">CLI 用法:</strong> 将此 Token 保存到全局配置后，<code class="bg-base px-1 py-0.5 rounded font-mono text-xs text-textMain border border-border">kite push</code> 时无需再传。
            </p>
          </div>
        </div>
      </div>

      <!-- CLI Help Card -->
      <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <TerminalSquare class="w-5 h-5 mr-2 text-primary" />
            CLI 快速部署指引
          </h2>
          <p class="text-sm text-textMuted mt-1">三步完成部署：安装 CLI、初始化配置、推送部署。</p>
        </div>

        <div class="p-6 space-y-5">
          <!-- Env selector -->
          <div class="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <label class="block text-sm font-medium text-textMain mb-2">部署环境 (可选)</label>
            <div class="flex items-center gap-3">
              <input
                v-model="cliEnv"
                type="text"
                class="flex-1 bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                placeholder="留空为默认环境，或输入如 test、staging、prod"
              />
            </div>
            <p class="text-xs text-textMuted mt-2">
              填写后下方所有指令将自动带上 <code class="font-mono text-textMain">--env</code> 参数，生成的配置文件为
              <code class="font-mono text-textMain">{{ configFileName }}</code>。
              适用于同一项目需要部署到不同环境（测试/预发/生产）的场景。
            </p>
          </div>

          <!-- Step 1: 安装 CLI -->
          <div class="rounded-lg border border-border bg-base p-4">
            <p class="text-sm font-medium text-textMain mb-2">1. 安装 CLI</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 text-xs text-success font-mono break-all">{{ installCommand }}</code>
              <button @click="copyCommand('install', installCommand)" class="text-xs text-primary hover:text-textMain">
                {{ copiedCommand === 'install' ? '已复制' : '复制' }}
              </button>
            </div>
          </div>

          <!-- Step 2: 初始化配置 -->
          <div class="rounded-lg border border-border bg-base p-4">
            <p class="text-sm font-medium text-textMain mb-2">2. 初始化项目配置</p>
            <div class="flex items-center gap-2 mb-4">
              <code class="flex-1 text-xs text-success font-mono break-all">{{ initCommand }}</code>
              <button @click="copyCommand('init', initCommand)" class="text-xs text-primary hover:text-textMain">
                {{ copiedCommand === 'init' ? '已复制' : '复制' }}
              </button>
            </div>
            <p class="text-xs text-textMuted mb-3">执行后会在当前目录生成 <code class="font-mono text-textMain bg-panel px-1 py-0.5 rounded border border-border">{{ configFileName }}</code>，请确认生成的配置：</p>
            <pre class="text-xs text-success font-mono whitespace-pre-wrap overflow-x-auto bg-panel rounded-md p-3 border border-border mb-3">{{ configExample }}</pre>
            <div class="space-y-2 text-xs text-textMuted">
              <p><code class="font-mono text-textMain">projectId</code> — 项目唯一标识，由服务端分配</p>
              <p><code class="font-mono text-textMain">outputDir</code> — 本地打包输出目录，默认 <code class="font-mono">./dist</code></p>
              <p><code class="font-mono text-textMain">files</code> — 要打包上传的文件 glob 模式列表，示例：</p>
              <div class="pl-3 space-y-1">
                <div v-for="ex in configFilesExamples" :key="ex.label" class="flex items-center gap-2">
                  <span class="text-textMuted w-24 shrink-0">{{ ex.label }}</span>
                  <code class="text-success font-mono">"files": {{ JSON.stringify(ex.files) }}</code>
                </div>
              </div>
              <p><code class="font-mono text-textMain">postDeploy</code> — 服务端解压后执行的命令，如重启服务</p>
            </div>
          </div>

          <!-- Step 3: 部署 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="rounded-lg border border-border bg-base p-4">
              <p class="text-sm font-medium text-textMain mb-2">3. 部署 — 使用已保存的配置</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs text-success font-mono break-all">{{ pushCommand }}</code>
                <button @click="copyCommand('push', pushCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'push' ? '已复制' : '复制' }}
                </button>
              </div>
              <p class="text-xs text-textMuted mt-2">需先通过 <code class="font-mono">kite config:set token</code> 或 <code class="font-mono">--token-store global</code> 保存过 Token。</p>
            </div>

            <div class="rounded-lg border border-border bg-base p-4 space-y-3">
              <p class="text-sm font-medium text-textMain mb-2">3. 部署 — CLI 覆盖配置</p>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-20 shrink-0">使用全局 Token</span>
                <code class="flex-1 text-xs text-success font-mono break-all">{{ directPushCommand }}</code>
                <button @click="copyCommand('direct-push', directPushCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'direct-push' ? '已复制' : '复制' }}
                </button>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-20 shrink-0">指定项目 Token</span>
                <code class="flex-1 text-xs text-success font-mono break-all">{{ directPushWithTokenCommand }}</code>
                <button @click="copyCommand('direct-push-token', directPushWithTokenCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'direct-push-token' ? '已复制' : '复制' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Tip: Token 设置方式 -->
          <div class="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
            <p class="text-sm text-textMuted leading-relaxed">
              <strong class="text-primary font-medium">Token 设置方式：</strong>
              <code class="font-mono text-xs bg-base px-1 py-0.5 rounded border border-border">kite config:set token &lt;token&gt;</code> 按项目保存，
              <code class="font-mono text-xs bg-base px-1 py-0.5 rounded border border-border">kite config:set token &lt;token&gt; --global</code> 设置全局 fallback。
              也可在 <code class="font-mono">.env.local</code> 中写入 <code class="font-mono">KITE_DEPLOY_TOKEN=&lt;token&gt;</code>。
            </p>
            <p class="text-sm text-textMuted leading-relaxed">
              配置优先级：<strong class="text-primary">CLI 参数</strong> &gt; <strong class="text-primary">.env.local</strong> &gt; <strong class="text-primary">项目级 Token</strong> &gt; <strong class="text-primary">全局 Token</strong>。未在 CLI 传入的部署脚本，会回退到本页保存的云端默认脚本。
            </p>
          </div>
        </div>
      </div>

      <!-- Execution Scripts Card -->
      <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <TerminalSquare class="w-5 h-5 mr-2 text-primary" />
            部署脚本配置 (云端默认)
          </h2>
          <p class="text-sm text-textMuted mt-1">配置此项目在服务端接收到文件后，默认执行的 Shell 指令。可被 CLI 参数覆盖。</p>
        </div>
        
        <div class="p-6 space-y-6">
          <div>
            <label class="block text-sm font-medium text-textMain mb-2">部署目录 (Destination Path)</label>
            <input
              v-model="formData.destPath"
              type="text"
              class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
              placeholder="e.g. /var/www/my-project"
            />
            <p class="text-xs text-textMuted mt-2">在服务端解压和部署该项目文件的绝对路径。</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMain mb-2">前置脚本 (Pre-Deploy)</label>
            <div class="relative">
              <div class="absolute left-0 top-0 bottom-0 w-8 bg-base border-r border-border rounded-l-md flex flex-col items-center py-3 text-textMuted font-mono text-xs select-none">
                <span>1</span>
              </div>
              <textarea 
                v-model="formData.preDeploy"
                class="w-full bg-base border border-border rounded-md pl-11 pr-4 py-3 text-success font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all min-h-[100px] resize-y"
                placeholder="# e.g. npm install && npm run build"
                spellcheck="false"
              ></textarea>
            </div>
            <p class="text-xs text-textMuted mt-2">在打包上传之前，于本地执行的构建命令（通常配置在本地 CLI，此处作为备用参考）。</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMain mb-2">后置脚本 (Post-Deploy)</label>
            <div class="relative">
              <div class="absolute left-0 top-0 bottom-0 w-8 bg-base border-r border-border rounded-l-md flex flex-col items-center py-3 text-textMuted font-mono text-xs select-none">
                <span>1</span>
              </div>
              <textarea 
                v-model="formData.postDeploy"
                class="w-full bg-base border border-border rounded-md pl-11 pr-4 py-3 text-success font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all min-h-[100px] resize-y"
                placeholder="# e.g. pm2 restart api-server"
                spellcheck="false"
              ></textarea>
            </div>
            <p class="text-xs text-textMuted mt-2">服务端解压文件后，在目标目录执行的重启或服务加载命令。</p>
          </div>

          <div class="pt-4 border-t border-border flex justify-end">
            <button 
              @click="saveConfig"
              class="flex items-center px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-md transition-all font-medium shadow-[0_0_15px_rgba(59,130,246,0.3)]"
            >
              <Save class="w-4 h-4 mr-2" />
              保存配置
            </button>
          </div>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="bg-panel border border-danger/20 rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-4">
          <h3 class="text-danger font-medium flex items-center">
            <Trash2 class="w-4 h-4 mr-2" />
            危险操作区
          </h3>
          <div class="mt-4 flex items-start justify-between gap-4">
            <div class="text-sm text-textMuted space-y-1">
              <p>删除该项目将同时清空数据库中的项目配置与全部部署历史日志，且不可恢复。</p>
              <p class="text-textMuted/80">部署目录中的实际文件不会被删除，需要时请手动清理。</p>
            </div>
            <button @click="openDeleteModal" class="shrink-0 px-4 py-2 bg-danger/10 hover:bg-danger text-danger hover:text-white border border-danger/20 hover:border-danger rounded-md transition-colors text-sm font-medium">
              删除项目
            </button>
          </div>
        </div>
      </div>

    </div>

    <!-- Delete Confirmation Modal -->
    <div
      v-if="showDeleteModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="closeDeleteModal"
    >
      <div class="bg-panel border border-danger/30 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <div class="flex items-start space-x-3 mb-5">
          <div class="p-2 rounded-lg bg-danger/10 border border-danger/20 shrink-0">
            <AlertTriangle class="w-5 h-5 text-danger" />
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-textMain">确认删除项目</h2>
            <p class="text-sm text-textMuted mt-1">
              即将删除项目
              <span class="font-mono text-textMain">{{ project?.name }}</span>
              （<span class="font-mono text-textMuted">{{ projectId }}</span>），此操作不可恢复。
            </p>
          </div>
        </div>

        <div class="space-y-3 mb-5">
          <div class="bg-danger/5 border border-danger/20 rounded-lg p-3">
            <p class="text-xs font-medium text-danger mb-2 flex items-center">
              <XCircle class="w-3.5 h-3.5 mr-1.5" />
              将被永久删除的内容
            </p>
            <ul class="text-xs text-textMain/90 space-y-1 list-disc list-inside marker:text-danger/60">
              <li>该项目在数据库中的配置（名称、描述、部署目录、部署脚本、Token、环境标识等）</li>
              <li>该项目的<span class="font-medium">全部部署历史日志</span>（部署日志面板中将不再可见）</li>
            </ul>
          </div>

          <div class="bg-success/5 border border-success/20 rounded-lg p-3">
            <p class="text-xs font-medium text-success mb-2 flex items-center">
              <CheckCircle2 class="w-3.5 h-3.5 mr-1.5" />
              不会被删除的内容
            </p>
            <ul class="text-xs text-textMain/90 space-y-1 list-disc list-inside marker:text-success/60">
              <li>
                部署目录
                <code class="font-mono text-textMain bg-base px-1 py-0.5 rounded text-[11px]">{{ project?.destPath || '—' }}</code>
                下的所有实际文件
              </li>
              <li>其他项目的数据、全局设置、Admin Token</li>
              <li>项目源码中的 <code class="font-mono text-textMain bg-base px-1 py-0.5 rounded text-[11px]">kite.config*.json</code> / <code class="font-mono text-textMain bg-base px-1 py-0.5 rounded text-[11px]">.env.local</code> 等本地配置</li>
            </ul>
          </div>
        </div>

        <div class="mb-2">
          <label class="block text-sm font-medium text-textMuted mb-1.5">
            请输入项目名称
            <span class="font-mono text-textMain">{{ expectedConfirmName }}</span>
            以确认删除
          </label>
          <input
            v-model="deleteConfirmText"
            type="text"
            :disabled="isDeleting"
            :placeholder="expectedConfirmName"
            class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono focus:outline-none focus:border-danger focus:ring-1 focus:ring-danger/50 transition-all text-sm disabled:opacity-60"
            @keydown.enter.prevent="confirmDelete"
          />
        </div>

        <p v-if="deleteError" class="text-xs text-danger mt-2">{{ deleteError }}</p>

        <div class="mt-6 flex justify-end space-x-3">
          <button
            @click="closeDeleteModal"
            :disabled="isDeleting"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            取消
          </button>
          <button
            @click="confirmDelete"
            :disabled="!canConfirmDelete"
            class="px-4 py-2 text-sm font-medium bg-danger text-white rounded-md hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
          >
            <RefreshCw v-if="isDeleting" class="w-4 h-4 mr-2 animate-spin" />
            <Trash2 v-else class="w-4 h-4 mr-2" />
            {{ isDeleting ? '正在删除...' : '永久删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>