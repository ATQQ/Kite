<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { LayoutDashboard, FolderArchive, TerminalSquare, ScrollText, Database, HardDrive, Settings, LogOut, Sun, Moon, Monitor, Menu, X, Terminal as TerminalIcon } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import { useThemeStore, type ThemeMode } from '../store/theme'
import { APP_VERSION } from '../constants'
import LogoSvg from '../assets/logo.svg'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const themeStore = useThemeStore()

const menus = [
  { name: '概览', path: '/', icon: LayoutDashboard },
  { name: '项目管理', path: '/projects', icon: FolderArchive },
  { name: '部署日志', path: '/logs', icon: TerminalSquare },
  { name: '终端', path: '/terminal', icon: TerminalIcon },
  { name: '操作日志', path: '/audit', icon: ScrollText },
  { name: '存储', path: '/storage', icon: HardDrive },
  { name: '数据迁移', path: '/migration', icon: Database },
]

const THEME_CYCLE: ThemeMode[] = ['light', 'dark', 'system']
const THEME_LABEL: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
}
const themeIcon = computed(() => {
  if (themeStore.mode === 'system') return Monitor
  return themeStore.mode === 'dark' ? Moon : Sun
})
const themeTitle = computed(() => `外观：${THEME_LABEL[themeStore.mode]}（点击切换）`)
const cycleTheme = () => {
  const idx = THEME_CYCLE.indexOf(themeStore.mode)
  const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]
  themeStore.setMode(next)
}

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
          @click="cycleTheme"
          :title="themeTitle"
          :aria-label="themeTitle"
          class="ml-auto p-1.5 rounded-md text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          <component :is="themeIcon" class="w-4 h-4" />
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
          系统设置
        </router-link>
        <button @click="handleLogout" class="flex items-center w-full px-3 py-2 text-sm text-danger hover:bg-danger/10 rounded-md transition-colors">
          <LogOut class="w-5 h-5 mr-3" />
          退出登录
        </button>
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
      aria-label="移动端导航"
    >
      <div class="h-16 flex items-center px-4 border-b border-border">
        <router-link to="/" class="flex items-center min-w-0 hover:opacity-90 transition-opacity" @click="closeMobileMenu">
          <img :src="LogoSvg" alt="Kite Logo" class="w-6 h-6 mr-2" />
          <span class="text-lg font-bold text-textMain tracking-wide">KITE</span>
          <span class="ml-2 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">v{{ APP_VERSION }}</span>
        </router-link>
        <button
          @click="closeMobileMenu"
          aria-label="关闭菜单"
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
          系统设置
        </router-link>
        <button @click="handleLogout" class="flex items-center w-full px-3 py-2 text-sm text-danger hover:bg-danger/10 rounded-md transition-colors">
          <LogOut class="w-5 h-5 mr-3" />
          退出登录
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
      <!-- Mobile Header -->
      <header class="h-16 border-b border-border bg-panel flex items-center px-4 md:hidden">
        <button
          @click="openMobileMenu"
          aria-label="打开菜单"
          class="p-1.5 mr-2 rounded-md text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          <Menu class="w-5 h-5" />
        </button>
        <router-link to="/" class="flex items-center min-w-0 hover:opacity-90 transition-opacity">
          <img :src="LogoSvg" alt="Kite Logo" class="w-6 h-6 mr-2" />
          <span class="text-lg font-bold text-textMain">KITE</span>
        </router-link>
        <button
          @click="cycleTheme"
          :title="themeTitle"
          :aria-label="themeTitle"
          class="ml-auto p-1.5 rounded-md text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
        >
          <component :is="themeIcon" class="w-4 h-4" />
        </button>
      </header>
      
      <!-- Content Scrollable Area -->
      <div class="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
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
