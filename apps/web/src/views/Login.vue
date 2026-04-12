<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Rocket, LogIn } from 'lucide-vue-next'
import { useProjectStore } from '../store/project'

const router = useRouter()
const projectStore = useProjectStore()
const token = ref('')
const isLoading = ref(false)
const errorMsg = ref('')

onMounted(() => {
  // If we already have a valid token, auto-redirect
  if (projectStore.adminToken) {
    router.replace('/')
  }
})

const handleLogin = async () => {
  if (!token.value) return
  
  isLoading.value = true
  errorMsg.value = ''
  
  try {
    // 模拟调用后端 API
    // 实际应为：await axios.post('/api/auth/login', { token: token.value })
    const success = await projectStore.login(token.value)
    
    if (success) {
      router.replace('/')
    } else {
      errorMsg.value = 'Token 校验失败，请检查配置。'
    }
  } catch (err: any) {
    errorMsg.value = err.message || '登录异常，请稍后重试。'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-base flex flex-col items-center justify-center p-4">
    <div class="w-full max-w-md">
      <!-- Logo Section -->
      <div class="flex flex-col items-center justify-center mb-8">
        <div class="w-16 h-16 bg-primary/10 border border-primary/20 rounded-2xl flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
          <Rocket class="w-8 h-8 text-primary" />
        </div>
        <h1 class="text-3xl font-bold text-white tracking-tight">Kite Deploy</h1>
        <p class="text-textMuted text-sm mt-2">云原生极简部署管理面板</p>
      </div>

      <!-- Login Card -->
      <div class="bg-panel border border-border rounded-2xl p-8 shadow-xl">
        <h2 class="text-lg font-medium text-white mb-6">管理员登录</h2>
        
        <form @submit.prevent="handleLogin" class="space-y-5">
          <div>
            <label class="block text-sm font-medium text-textMuted mb-2">Admin Token</label>
            <input 
              v-model="token"
              type="password" 
              placeholder="请输入服务端生成的 ADMIN_TOKEN"
              class="w-full bg-base border border-border rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-textMuted/50 placeholder:font-sans"
              :class="{'border-danger focus:border-danger focus:ring-danger/50': errorMsg}"
            />
            <p v-if="errorMsg" class="text-danger text-xs mt-2 flex items-center">
              {{ errorMsg }}
            </p>
          </div>

          <button 
            type="submit"
            :disabled="!token || isLoading"
            class="w-full flex items-center justify-center px-4 py-3 bg-primary text-white rounded-lg font-medium transition-all hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(59,130,246,0.3)]"
          >
            <LogIn v-if="!isLoading" class="w-5 h-5 mr-2" />
            <svg v-else class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {{ isLoading ? '验证中...' : '进入控制台' }}
          </button>
        </form>
        
        <div class="mt-6 text-center">
          <p class="text-xs text-textMuted">
            Token 可以在服务端启动目录的 <code class="font-mono bg-base px-1 py-0.5 rounded border border-border">.env.local</code> 文件中找到。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>