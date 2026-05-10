<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import { ArrowLeft, Save, Key, Copy, RefreshCw, Trash2, CheckCircle2, TerminalSquare } from 'lucide-vue-next'

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

onMounted(async () => {
  serverUrl.value = window.location.origin
  await projectStore.fetchProjects()
  if (project.value) {
    formData.value.destPath = project.value.destPath || ''
    formData.value.preDeploy = project.value.preDeploy || ''
    formData.value.postDeploy = project.value.postDeploy || ''
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

const installCommand = 'npm install -g @kitecd/cli'
const initCommand = computed(() => `kite init --project ${projectId} --out ./dist --server ${serverUrl.value}`)
const globalTokenCommand = 'kite config set token <DEPLOY_TOKEN>'
const localTokenCommand = 'printf "KITE_DEPLOY_TOKEN=<DEPLOY_TOKEN>\\n" >> .env.local'
const pushCommand = 'kite push'
const directPushCommand = computed(() => `kite push --server ${serverUrl.value} --project ${projectId} --token <DEPLOY_TOKEN> --out ./dist`)
const configExample = computed(() => JSON.stringify({
  projectId,
  outputDir: './dist',
  files: ['**/*'],
  postDeploy: project.value?.postDeploy || 'pm2 restart your-service'
}, null, 2))

const refreshToken = async () => {
  if (confirm('重新生成 Token 将导致旧 Token 立即失效，是否继续？')) {
    await projectStore.generateToken(projectId)
    isTokenVisible.value = true
  }
}

const removeProject = async () => {
  if (confirm(`确定要永久删除项目 ${project.value?.name} 吗？此操作不可恢复。`)) {
    const success = await projectStore.removeProject(projectId)
    if (success) {
      router.replace('/projects')
    } else {
      alert('删除失败，请稍后重试')
    }
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
              <strong class="text-primary font-medium">CLI 用法:</strong><br />
              <code class="bg-base px-1.5 py-0.5 rounded font-mono text-xs text-textMain mt-2 inline-block border border-border">kite config set token &lt;你的 Token&gt;</code>
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
          <p class="text-sm text-textMuted mt-1">Token 不建议写入 <code class="font-mono">kite.config.json</code>。可以保存到全局 <code class="font-mono">~/.kite/config.json</code>，或当前项目的 <code class="font-mono">.env.local</code>。</p>
        </div>

        <div class="p-6 space-y-5">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="rounded-lg border border-border bg-base p-4">
              <p class="text-sm font-medium text-textMain mb-2">1. 安装 CLI</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs text-success font-mono break-all">{{ installCommand }}</code>
                <button @click="copyCommand('install', installCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'install' ? '已复制' : '复制' }}
                </button>
              </div>
            </div>

            <div class="rounded-lg border border-border bg-base p-4">
              <p class="text-sm font-medium text-textMain mb-2">2. 初始化项目配置</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs text-success font-mono break-all">{{ initCommand }}</code>
                <button @click="copyCommand('init', initCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'init' ? '已复制' : '复制' }}
                </button>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-border bg-base p-4">
            <p class="text-sm font-medium text-textMain mb-3">3. 保存 Deploy Token（二选一）</p>
            <div class="space-y-3">
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-24 shrink-0">全局配置</span>
                <code class="flex-1 text-xs text-success font-mono break-all">{{ globalTokenCommand }}</code>
                <button @click="copyCommand('global-token', globalTokenCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'global-token' ? '已复制' : '复制' }}
                </button>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-24 shrink-0">项目本地</span>
                <code class="flex-1 text-xs text-success font-mono break-all">{{ localTokenCommand }}</code>
                <button @click="copyCommand('local-token', localTokenCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'local-token' ? '已复制' : '复制' }}
                </button>
              </div>
            </div>
            <p class="text-xs text-textMuted mt-3">将上方 <code class="font-mono">&lt;DEPLOY_TOKEN&gt;</code> 替换为本页 Token。为避免泄露，示例命令不会直接填入真实 Token。</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="rounded-lg border border-border bg-base p-4">
              <p class="text-sm font-medium text-textMain mb-2">4. 使用默认配置部署</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs text-success font-mono break-all">{{ pushCommand }}</code>
                <button @click="copyCommand('push', pushCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'push' ? '已复制' : '复制' }}
                </button>
              </div>
            </div>

            <div class="rounded-lg border border-border bg-base p-4">
              <p class="text-sm font-medium text-textMain mb-2">直接通过 CLI 覆盖配置</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs text-success font-mono break-all">{{ directPushCommand }}</code>
                <button @click="copyCommand('direct-push', directPushCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'direct-push' ? '已复制' : '复制' }}
                </button>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-border bg-base p-4">
            <div class="flex items-center justify-between mb-2">
              <p class="text-sm font-medium text-textMain">kite.config.json 示例（不包含 Token）</p>
              <button @click="copyCommand('config', configExample)" class="text-xs text-primary hover:text-textMain">
                {{ copiedCommand === 'config' ? '已复制' : '复制' }}
              </button>
            </div>
            <pre class="text-xs text-success font-mono whitespace-pre-wrap overflow-x-auto">{{ configExample }}</pre>
          </div>

          <div class="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <p class="text-sm text-textMuted leading-relaxed">
              配置优先级：<strong class="text-primary">CLI 参数</strong> &gt; <strong class="text-primary">本地配置 / .env.local</strong> &gt; <strong class="text-primary">服务端项目默认配置</strong>。未在 CLI 或本地配置中传入的部署脚本，会回退到本页保存的云端默认脚本。
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
          <div class="mt-4 flex items-center justify-between">
            <p class="text-sm text-textMuted">删除该项目将清空所有配置与日志，且不可恢复。</p>
            <button @click="removeProject" class="px-4 py-2 bg-danger/10 hover:bg-danger text-danger hover:text-white border border-danger/20 hover:border-danger rounded-md transition-colors text-sm font-medium">
              删除项目
            </button>
          </div>
        </div>
      </div>
      
    </div>
  </div>
</template>