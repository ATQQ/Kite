<script setup lang="ts">
import { LayoutDashboard, FolderArchive, TerminalSquare, Database, Settings, LogOut } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import { APP_VERSION } from '../constants'
import LogoSvg from '../assets/logo.svg'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()

const menus = [
  { name: '概览', path: '/', icon: LayoutDashboard },
  { name: '项目管理', path: '/projects', icon: FolderArchive },
  { name: '部署日志', path: '/logs', icon: TerminalSquare },
  { name: '数据迁移', path: '/migration', icon: Database },
]

const handleLogout = () => {
  projectStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-base flex">
    <!-- Sidebar -->
    <aside class="w-64 border-r border-border bg-panel flex flex-col hidden md:flex">
      <div class="h-16 flex items-center px-6 border-b border-border">
        <img :src="LogoSvg" alt="Kite Logo" class="w-6 h-6 mr-2" />
        <span class="text-lg font-bold text-textMain tracking-wide">KITE</span>
        <span class="ml-2 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">v{{ APP_VERSION }}</span>
      </div>
      
      <nav class="flex-1 py-6 px-3 space-y-1">
        <router-link
          v-for="menu in menus"
          :key="menu.path"
          :to="menu.path"
          class="flex items-center px-3 py-2.5 rounded-md transition-all duration-200 group"
          :class="[
            route.path === menu.path || (menu.path !== '/' && route.path.startsWith(menu.path))
              ? 'bg-primary/10 text-primary shadow-[inset_2px_0_0_0_#3b82f6]' 
              : 'text-textMuted dark:hover:bg-white/5 hover:bg-black/5 hover:text-textMain'
          ]"
        >
          <component :is="menu.icon" class="w-5 h-5 mr-3" :class="route.path === menu.path || (menu.path !== '/' && route.path.startsWith(menu.path)) ? 'text-primary' : 'text-textMuted group-hover:text-textMain'" />
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
    <main class="flex-1 flex flex-col h-screen overflow-hidden">
      <!-- Mobile Header -->
      <header class="h-16 border-b border-border bg-panel flex items-center px-4 md:hidden">
        <img :src="LogoSvg" alt="Kite Logo" class="w-6 h-6 mr-2" />
        <span class="text-lg font-bold text-textMain">KITE</span>
      </header>
      
      <!-- Content Scrollable Area -->
      <div class="flex-1 overflow-auto p-6 md:p-8">
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