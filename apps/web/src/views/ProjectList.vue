<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import { Plus, MoreVertical, Server, Clock } from 'lucide-vue-next'

const projectStore = useProjectStore()
const router = useRouter()

onMounted(() => {
  projectStore.fetchProjects()
})

const showCreateModal = ref(false)
const newProject = ref({ name: '', description: '', destPath: '' })

const createProject = async () => {
  if (!newProject.value.name || !newProject.value.destPath) return
  const success = await projectStore.addProject(newProject.value)
  if (success) {
    showCreateModal.value = false
    newProject.value = { name: '', description: '', destPath: '' }
  } else {
    alert('创建失败，请稍后重试')
  }
}

const goToDetail = (id: string) => {
  router.push(`/projects/${id}`)
}
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6">
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold text-white tracking-tight">项目管理</h1>
        <p class="text-textMuted text-sm mt-1">管理所有可部署的应用服务与脚本配置</p>
      </div>
      <button 
        @click="showCreateModal = true"
        class="flex items-center px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-md shadow-[0_0_15px_rgba(59,130,246,0.3)] transition-all font-medium text-sm"
      >
        <Plus class="w-4 h-4 mr-2" />
        新建项目
      </button>
    </div>

    <!-- Project Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="project in projectStore.projects"
        :key="project.id"
        class="group bg-panel border border-border rounded-xl p-5 hover:border-primary/50 transition-all shadow-sm cursor-pointer relative overflow-hidden"
        @click="goToDetail(project.id)"
      >
        <div class="absolute top-0 left-0 w-1 h-full" :class="project.status === 'success' ? 'bg-success' : project.status === 'failed' ? 'bg-danger' : 'bg-primary'"></div>
        
        <div class="flex justify-between items-start mb-4">
          <div class="flex items-center space-x-3">
            <div class="p-2 rounded-lg bg-base border border-border group-hover:border-primary/30 transition-colors">
              <Server class="w-5 h-5 text-textMain group-hover:text-primary transition-colors" />
            </div>
            <div>
              <h3 class="font-semibold text-white text-base">{{ project.name }}</h3>
              <p class="text-xs text-textMuted font-mono mt-0.5">{{ project.id }}</p>
            </div>
          </div>
          <button class="p-1 hover:bg-white/10 rounded-md transition-colors text-textMuted hover:text-white" @click.stop>
            <MoreVertical class="w-4 h-4" />
          </button>
        </div>

        <p class="text-sm text-textMuted mb-5 line-clamp-2 min-h-[40px]">
          {{ project.description || '暂无描述' }}
        </p>

        <div class="flex items-center justify-between border-t border-border pt-4 text-xs text-textMuted">
          <div class="flex items-center">
            <Clock class="w-3.5 h-3.5 mr-1.5" />
            <span>{{ new Date(project.updatedAt).toLocaleDateString() }}</span>
          </div>
          <div class="flex items-center space-x-2">
            <span class="flex items-center" :class="project.status === 'success' ? 'text-success' : project.status === 'failed' ? 'text-danger' : 'text-primary'">
              <span class="w-2 h-2 rounded-full mr-1.5" :class="project.status === 'success' ? 'bg-success shadow-[0_0_8px_#10b981]' : project.status === 'failed' ? 'bg-danger' : 'bg-primary'"></span>
              {{ project.status === 'success' ? '正常' : project.status === 'failed' ? '异常' : '空闲' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="bg-panel border border-border rounded-xl w-full max-w-md p-6 shadow-2xl transform transition-all">
        <h2 class="text-xl font-bold text-white mb-6">新建部署项目</h2>
        
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">项目名称</label>
            <input 
              v-model="newProject.name"
              type="text" 
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm"
              placeholder="e.g. Kite Web Frontend"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">部署目录绝对路径 (Destination Path)</label>
            <input 
              v-model="newProject.destPath"
              type="text" 
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-white font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm"
              placeholder="e.g. /var/www/my-project"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">描述 (可选)</label>
            <textarea 
              v-model="newProject.description"
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm h-24 resize-none"
              placeholder="简要描述项目的用途..."
            ></textarea>
          </div>
        </div>

        <div class="mt-8 flex justify-end space-x-3">
          <button 
            @click="showCreateModal = false"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-white hover:bg-white/5 rounded-md transition-colors"
          >
            取消
          </button>
          <button 
            @click="createProject"
            :disabled="!newProject.name || !newProject.destPath"
            class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            确认创建
          </button>
        </div>
      </div>
    </div>
  </div>
</template>