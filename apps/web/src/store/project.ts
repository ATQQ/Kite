import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Project {
  id: string
  name: string
  description?: string
  destPath?: string
  deployPath?: string
  preDeploy?: string
  postDeploy?: string
  preDeployScript?: string
  postDeployScript?: string
  token?: string
  status: 'running' | 'success' | 'failed' | 'idle'
  updatedAt: string
}

export interface DeploymentLog {
  id: string
  projectId: string
  projectName: string
  status: 'running' | 'success' | 'failed'
  triggerSource: string
  duration: string
  output: string
  startTime: string
  endTime?: string
}

export const useProjectStore = defineStore('project', () => {
  const adminToken = ref(localStorage.getItem('adminToken') || '')
  
  const projects = ref<Project[]>([])
  const logs = ref<DeploymentLog[]>([])

  // Helper fetch function
  async function apiFetch(endpoint: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as any)
    }
    if (adminToken.value) {
      headers['Authorization'] = `Bearer ${adminToken.value}`
    }
    
    const res = await fetch(`/api${endpoint}`, {
      ...options,
      headers
    })
    
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || data.message || 'API request failed')
    return data
  }

  async function fetchProjects() {
    try {
      const data = await apiFetch('/projects')
      projects.value = data.map((p: any) => ({
        ...p,
        destPath: p.deployPath,
        preDeploy: p.preDeployScript,
        postDeploy: p.postDeployScript
      }))
    } catch (e) {
      console.error('Failed to fetch projects', e)
    }
  }

  async function fetchLogs() {
    try {
      logs.value = await apiFetch('/logs')
    } catch (e) {
      console.error('Failed to fetch logs', e)
    }
  }

  function getProjectById(id: string) {
    return projects.value.find(p => p.id === id)
  }

  async function addProject(project: Partial<Project>) {
    try {
      const data = await apiFetch('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: project.name,
          description: project.description,
          deployPath: project.destPath || '/tmp/default-deploy'
        })
      })
      if (data.success) {
        await fetchProjects()
        return true
      }
    } catch (e) {
      console.error('Failed to add project', e)
    }
    return false
  }

  async function removeProject(id: string) {
    try {
      const data = await apiFetch(`/projects/${id}`, { method: 'DELETE' })
      if (data.success) {
        await fetchProjects()
        return true
      }
    } catch (e) {
      console.error('Failed to remove project', e)
    }
    return false
  }
  async function updateProject(id: string, payload: Partial<Project>) {
    try {
      const apiPayload: any = {}
      if (payload.preDeploy !== undefined) apiPayload.preDeployScript = payload.preDeploy
      if (payload.postDeploy !== undefined) apiPayload.postDeployScript = payload.postDeploy
      if (payload.destPath !== undefined) apiPayload.deployPath = payload.destPath

      const data = await apiFetch(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(apiPayload)
      })
      if (data.success) {
        await fetchProjects()
      }
    } catch (e) {
      console.error('Failed to update project', e)
    }
  }

  async function generateToken(id: string) {
    try {
      const data = await apiFetch(`/projects/${id}/token`, { method: 'POST' })
      if (data.success) {
        await fetchProjects()
        return data.token
      }
    } catch (e) {
      console.error('Failed to generate token', e)
    }
    return ''
  }

  async function fetchSettings() {
    try {
      return await apiFetch('/settings')
    } catch (e) {
      console.error('Failed to fetch settings', e)
      return {}
    }
  }

  async function updateSettings(payload: Record<string, string>) {
    try {
      const data = await apiFetch('/settings', {
        method: 'PUT',
        body: JSON.stringify(payload)
      })
      return data.success
    } catch (e) {
      console.error('Failed to update settings', e)
      return false
    }
  }

  async function changeAdminToken(oldToken: string, newToken: string) {
    try {
      const data = await apiFetch('/settings/token', {
        method: 'POST',
        body: JSON.stringify({ oldToken, newToken })
      })
      if (data.success) {
        adminToken.value = newToken
        localStorage.setItem('adminToken', newToken)
      }
      return data
    } catch (e: any) {
      console.error('Failed to change token', e)
      return { error: e.message }
    }
  }

  async function fetchFiles(projectId: string, dirPath: string = '') {
    try {
      return await apiFetch(`/projects/${projectId}/files?path=${encodeURIComponent(dirPath)}`)
    } catch (e) {
      console.error('Failed to fetch files', e)
      return []
    }
  }

  async function fetchFileContent(projectId: string, filePath: string) {
    try {
      return await apiFetch(`/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`)
    } catch (e) {
      console.error('Failed to fetch file content', e)
      return null
    }
  }

  async function fetchSystemStatus() {
    try {
      return await apiFetch('/settings/status')
    } catch (e) {
      console.error('Failed to fetch system status', e)
      return null
    }
  }

  async function login(token: string) {
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ token })
      })
      if (data.success) {
        adminToken.value = token
        localStorage.setItem('adminToken', token)
        return true
      }
    } catch (e) {
      console.error('Login failed', e)
    }
    return false
  }

  function logout() {
    adminToken.value = ''
    localStorage.removeItem('adminToken')
    projects.value = []
    logs.value = []
  }

  return {
    adminToken,
    projects,
    logs,
    fetchProjects,
    fetchLogs,
    getProjectById,
    addProject,
    updateProject,
    removeProject,
    generateToken,
    fetchSettings,
    updateSettings,
    changeAdminToken,
    fetchSystemStatus,
    fetchFiles,
    fetchFileContent,
    login,
    logout
  }
})