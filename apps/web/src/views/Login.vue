<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Rocket, LogIn, Github, Scale, Star } from 'lucide-vue-next'
import { useProjectStore } from '../store/project'
import { GITHUB_URL, LICENSE_NAME } from '../constants'
import { useGithubStars, formatStars } from '../composables/useGithubStars'

const { t } = useI18n()
const router = useRouter()
const projectStore = useProjectStore()
const token = ref('')
const isLoading = ref(false)
const errorMsg = ref('')
const { stars } = useGithubStars()
const licenseUrl = `${GITHUB_URL}/blob/main/LICENSE`

onMounted(() => {
  if (projectStore.adminToken) {
    router.replace('/')
  }
})

const handleLogin = async () => {
  if (!token.value) return

  isLoading.value = true
  errorMsg.value = ''

  try {
    const success = await projectStore.login(token.value)

    if (success) {
      router.replace('/')
    } else {
      errorMsg.value = t('auth.invalidToken')
    }
  } catch (err: any) {
    errorMsg.value = err.message || t('auth.loginError')
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
        <h1 class="text-3xl font-bold text-textMain tracking-tight">{{ t('auth.appName') }}</h1>
        <p class="text-textMuted text-sm mt-2">{{ t('auth.tagline') }}</p>
      </div>

      <!-- Login Card -->
      <div class="bg-panel border border-border rounded-2xl p-6 sm:p-8 shadow-xl">
        <h2 class="text-lg font-medium text-textMain mb-6">{{ t('auth.adminLogin') }}</h2>

        <form @submit.prevent="handleLogin" class="space-y-5">
          <div>
            <label class="block text-sm font-medium text-textMuted mb-2">{{ t('auth.adminTokenLabel') }}</label>
            <input
              v-model="token"
              type="password"
              :placeholder="t('auth.adminTokenPlaceholder')"
              class="w-full bg-base border border-border rounded-lg px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-textMuted/50 placeholder:font-sans"
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
            {{ isLoading ? t('auth.submitting') : t('auth.submit') }}
          </button>
        </form>

        <div class="mt-6 text-center">
          <p class="text-xs text-textMuted">
            {{ t('auth.hint') }}
          </p>
        </div>
      </div>

      <div class="mt-6 flex items-center justify-center gap-4 text-xs text-textMuted">
        <a
          :href="GITHUB_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1.5 hover:text-textMain transition-colors"
          :title="t('oss.githubTitle')"
        >
          <Github class="w-3.5 h-3.5" />
          <span>{{ t('oss.github') }}</span>
          <span
            v-if="stars !== null"
            class="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-panel border border-border text-[10px] tabular-nums"
            :title="t('oss.starsTitle', { count: stars })"
          >
            <Star class="w-2.5 h-2.5" />
            {{ formatStars(stars) }}
          </span>
        </a>
        <span class="text-textMuted/40">·</span>
        <a
          :href="licenseUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1 hover:text-textMain transition-colors"
          :title="t('oss.licenseTitle')"
        >
          <Scale class="w-3.5 h-3.5" />
          <span>{{ t('oss.license', { name: LICENSE_NAME }) }}</span>
        </a>
      </div>
    </div>
  </div>
</template>
