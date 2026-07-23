<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { LayoutDashboard, FolderArchive, TerminalSquare, ScrollText, Database, HardDrive, Settings, LogOut, Sun, Moon, Monitor, Menu, X, Terminal as TerminalIcon, Languages, Github, Scale, Star, Search, BarChart3 } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import { useThemeStore, type ThemeMode } from '../store/theme'
import { useLocaleStore } from '../store/locale'
import { usePaletteStore } from '../store/palette'
import { APP_VERSION, GITHUB_URL, LICENSE_NAME } from '../constants'
import { useGithubStars, formatStars } from '../composables/useGithubStars'
import LogoSvg from '../assets/logo.svg'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const themeStore = useThemeStore()
const localeStore = useLocaleStore()
const palette = usePaletteStore()

const menus = computed(() => [
  { name: t('nav.dashboard'), path: '/', icon: LayoutDashboard },
  { name: t('nav.projects'), path: '/projects', icon: FolderArchive },
  { name: t('nav.deployLogs'), path: '/logs', icon: TerminalSquare },
  { name: t('nav.terminal'), path: '/terminal', icon: TerminalIcon },
  { name: t('nav.auditLog'), path: '/audit', icon: ScrollText },
  { name: t('nav.storage'), path: '/storage', icon: HardDrive },
  { name: t('nav.migration'), path: '/migration', icon: Database },
])

const THEME_CYCLE: ThemeMode[] = ['light', 'dark', 'system']
const themeIcon = computed(() => {
  if (themeStore.mode === 'system') return Monitor
  return themeStore.mode === 'dark' ? Moon : Sun
})
const themeLabel = computed(() => t(`theme.${themeStore.mode}`))
const themeTitle = computed(() => t('theme.title', { label: themeLabel.value }))
const cycleTheme = () => {
  const idx = THEME_CYCLE.indexOf(themeStore.mode)
  const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]
  themeStore.setMode(next)
}

const localeLabel = computed(() => t(`locale.${localeStore.locale}`))
const localeTitle = computed(() => t('locale.title', { label: localeLabel.value }))
const cycleLocale = () => {
  localeStore.toggleLocale()
}

const { stars } = useGithubStars()
const licenseUrl = `${GITHUB_URL}/blob/main/LICENSE`

const handleLogout = () => {
  projectStore.logout()
  router.push('/login')
}

const isActive = (path: string) => route.path === path || (path !== '/' && route.path.startsWith(path))

const mobileMenuOpen = ref(false)
const openMobileMenu = () => { mobileMenuOpen.value = true }
const closeMobileMenu = () => { mobileMenuOpen.value = false }

watch(() => route.fullPath, () => { mobileMenuOpen.value = false })

watch(mobileMenuOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) document.body.style.overflow = 'hidden'
  else document.body.style.overflow = ''
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>

<template>
  <div class="min-h-screen bg-base flex">
    <!-- Desktop Sidebar -->
    <aside class="w-64 border-r border-border bg-panel flex-col hidden md:flex">
      <div class="h-16 flex items-center px-6 border-b border-border">
        <router-link to="/" class="flex items-center min-w-0 hover:opacity-90 transition-opacity">
          <img :src="LogoSvg" alt="Kite Logo" class="w-6 h-6 mr-2" />
          <span class="text-lg font-bold text-textMain tracking-wide">KITE</span>
          <span class="ml-2 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">v{{ APP_VERSION }}</span>
        </router-link>
        <button
          @click="cycleLocale"
          :title="localeTitle"
          :aria-label="localeTitle"
          class="ml-auto p-1.5 rounded-md text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          <Languages class="w-4 h-4" />
        </button>
        <button
          @click="cycleTheme"
          :title="themeTitle"
          :aria-label="themeTitle"
          class="ml-1 p-1.5 rounded-md text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          <component :is="themeIcon" class="w-4 h-4" />
        </button>
      </div>

      <div class="px-3 pt-3">
        <button
          @click="palette.open()"
          :title="t('search.shortcutHint')"
          :aria-label="t('search.triggerLabel')"
          class="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-base text-textMuted hover:text-textMain hover:border-primary/40 transition-colors text-sm"
        >
          <Search class="w-4 h-4" />
          <span class="flex-1 text-left truncate">{{ t('search.triggerLabel') }}…</span>
          <kbd class="text-[10px] px-1.5 py-0.5 rounded border border-border bg-panel">⌘K</kbd>
        </button>
      </div>

      <nav class="flex-1 py-6 px-3 space-y-1">
        <router-link
          v-for="menu in menus"
          :key="menu.path"
          :to="menu.path"
          class="flex items-center px-3 py-2.5 rounded-md transition-all duration-200 group"
          :class="[
            isActive(menu.path)
              ? 'bg-primary/10 text-primary shadow-[inset_2px_0_0_0_#3b82f6]'
              : 'text-textMuted dark:hover:bg-white/5 hover:bg-black/5 hover:text-textMain'
          ]"
        >
          <component :is="menu.icon" class="w-5 h-5 mr-3" :class="isActive(menu.path) ? 'text-primary' : 'text-textMuted group-hover:text-textMain'" />
          <span class="font-medium text-sm">{{ menu.name }}</span>
        </router-link>
      </nav>
      
      <div class="p-4 border-t border-border space-y-1">
        <router-link
          to="/settings"
          class="flex items-center w-full px-3 py-2 text-sm rounded-md transition-colors"
          :class="route.path === '/settings'
            ? 'bg-primary/10 text-primary shadow-[inset_2px_0_0_0_#3b82f6]'
            : 'text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5'"
        >
          <Settings class="w-5 h-5 mr-3" :class="route.path === '/settings' ? 'text-primary' : 'text-textMuted'" />
          {{ t('nav.settings') }}
        </router-link>
        <button @click="handleLogout" class="flex items-center w-full px-3 py-2 text-sm text-danger hover:bg-danger/10 rounded-md transition-colors">
          <LogOut class="w-5 h-5 mr-3" />
          {{ t('nav.logout') }}
        </button>
        <div class="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-textMuted">
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
              class="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-base border border-border text-[10px] tabular-nums"
              :title="t('oss.starsTitle', { count: stars })"
            >
              <Star class="w-2.5 h-2.5" />
              {{ formatStars(stars) }}
            </span>
          </a>
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
          <a
            href="https://docs.kite.sugarat.top/stats"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 hover:text-textMain transition-colors"
            :title="t('oss.statsTitle')"
          >
            <BarChart3 class="w-3.5 h-3.5" />
            <span>{{ t('oss.stats') }}</span>
          </a>
        </div>
      </div>
    </aside>

    <!-- Mobile Drawer Overlay -->
    <transition name="fade">
      <div
        v-if="mobileMenuOpen"
        class="fixed inset-0 z-40 bg-black/60 md:hidden"
        @click="closeMobileMenu"
      />
    </transition>

    <!-- Mobile Drawer Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-panel flex flex-col transform transition-transform duration-200 md:hidden"
      :class="mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'"
      :aria-label="t('nav.mobileMenu')"
    >
      <div class="h-16 flex items-center px-4 border-b border-border">
        <router-link to="/" class="flex items-center min-w-0 hover:opacity-90 transition-opacity" @click="closeMobileMenu">
          <img :src="LogoSvg" alt="Kite Logo" class="w-6 h-6 mr-2" />
          <span class="text-lg font-bold text-textMain tracking-wide">KITE</span>
          <span class="ml-2 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">v{{ APP_VERSION }}</span>
        </router-link>
        <button
          @click="closeMobileMenu"
          :aria-label="t('nav.closeMenu')"
          class="ml-auto p-1.5 rounded-md text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <nav class="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
        <router-link
          v-for="menu in menus"
          :key="menu.path"
          :to="menu.path"
          class="flex items-center px-3 py-2.5 rounded-md transition-all duration-200 group"
          :class="[
            isActive(menu.path)
              ? 'bg-primary/10 text-primary shadow-[inset_2px_0_0_0_#3b82f6]'
              : 'text-textMuted dark:hover:bg-white/5 hover:bg-black/5 hover:text-textMain'
          ]"
        >
          <component :is="menu.icon" class="w-5 h-5 mr-3" :class="isActive(menu.path) ? 'text-primary' : 'text-textMuted group-hover:text-textMain'" />
          <span class="font-medium text-sm">{{ menu.name }}</span>
        </router-link>
      </nav>

      <div class="p-4 border-t border-border space-y-1">
        <router-link
          to="/settings"
          class="flex items-center w-full px-3 py-2 text-sm rounded-md transition-colors"
          :class="route.path === '/settings'
            ? 'bg-primary/10 text-primary shadow-[inset_2px_0_0_0_#3b82f6]'
            : 'text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5'"
        >
          <Settings class="w-5 h-5 mr-3" :class="route.path === '/settings' ? 'text-primary' : 'text-textMuted'" />
          {{ t('nav.settings') }}
        </router-link>
        <button @click="handleLogout" class="flex items-center w-full px-3 py-2 text-sm text-danger hover:bg-danger/10 rounded-md transition-colors">
          <LogOut class="w-5 h-5 mr-3" />
          {{ t('nav.logout') }}
        </button>
        <div class="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-textMuted">
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
              class="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-base border border-border text-[10px] tabular-nums"
              :title="t('oss.starsTitle', { count: stars })"
            >
              <Star class="w-2.5 h-2.5" />
              {{ formatStars(stars) }}
            </span>
          </a>
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
          <a
            href="https://docs.kite.sugarat.top/stats"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 hover:text-textMain transition-colors"
            :title="t('oss.statsTitle')"
          >
            <BarChart3 class="w-3.5 h-3.5" />
            <span>{{ t('oss.stats') }}</span>
          </a>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
      <!-- Mobile Header -->
      <header class="h-16 border-b border-border bg-panel flex items-center px-4 md:hidden">
        <button
          @click="openMobileMenu"
          :aria-label="t('nav.openMenu')"
          class="p-1.5 mr-2 rounded-md text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          <Menu class="w-5 h-5" />
        </button>
        <router-link to="/" class="flex items-center min-w-0 hover:opacity-90 transition-opacity">
          <img :src="LogoSvg" alt="Kite Logo" class="w-6 h-6 mr-2" />
          <span class="text-lg font-bold text-textMain">KITE</span>
        </router-link>
        <button
          @click="palette.open()"
          :title="t('search.shortcutHint')"
          :aria-label="t('search.triggerLabel')"
          class="ml-auto p-1.5 rounded-md text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          <Search class="w-4 h-4" />
        </button>
        <button
          @click="cycleLocale"
          :title="localeTitle"
          :aria-label="localeTitle"
          class="ml-1 p-1.5 rounded-md text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          <Languages class="w-4 h-4" />
        </button>
        <button
          @click="cycleTheme"
          :title="themeTitle"
          :aria-label="themeTitle"
          class="ml-1 p-1.5 rounded-md text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          <component :is="themeIcon" class="w-4 h-4" />
        </button>
      </header>
      
      <!-- Content Scrollable Area -->
      <div class="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </transition>
        </router-view>
      </div>
    </main>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
