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
  env?: string
  cleanMode?: 'merge' | 'clean' | 'clean-all' | null
  protectPaths?: string | null
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
  artifactPath?: string | null
  artifactSize?: number | null
  rollbackOf?: string | null
}

export interface CleanPreviewNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
  willDelete: boolean
  children?: CleanPreviewNode[]
}

export interface CleanPreviewResult {
  tree: CleanPreviewNode | null
  summary: {
    totalFiles: number
    deleteFiles: number
    deleteBytes: number
    protectFiles: number
    truncated: boolean
  }
  mode: 'merge' | 'clean' | 'clean-all'
  cached?: boolean
}

export const useProjectStore = defineStore('project', () => {
  const adminToken = ref(localStorage.getItem('adminToken') || '')
  
  const projects = ref<Project[]>([])
  const logs = ref<DeploymentLog[]>([])

  // Helper fetch function
  async function apiFetch(endpoint: string, options: RequestInit & { silent401?: boolean } = {}) {
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
    
    if (res.status === 401 && !options.silent401) {
      logout()
      window.location.href = '/login'
      throw new Error('Unauthorized')
    }
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
        postDeploy: p.postDeployScript,
        env: p.env || '',
        cleanMode: p.cleanMode ?? null,
        protectPaths: p.protectPaths ?? null,
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
          deployPath: project.destPath || '/tmp/default-deploy',
          env: project.env || undefined
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
  async function updateProject(id: string, payload: Record<string, any>) {
    try {
      const apiPayload: any = {}
      if (payload.preDeploy !== undefined) apiPayload.preDeployScript = payload.preDeploy
      if (payload.postDeploy !== undefined) apiPayload.postDeployScript = payload.postDeploy
      if (payload.destPath !== undefined) apiPayload.deployPath = payload.destPath
      if (payload.cleanMode !== undefined) apiPayload.cleanMode = payload.cleanMode
      if (payload.protectPaths !== undefined) apiPayload.protectPaths = payload.protectPaths

      const data = await apiFetch(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(apiPayload)
      })
      if (data.success) {
        await fetchProjects()
      }
    } catch (e) {
      console.error('Failed to update project', e)
      throw e
    }
  }

  async function cleanPreview(id: string, payload: { cleanMode: 'clean' | 'clean-all'; protectPaths: string[] }) {
    return await apiFetch(`/projects/${id}/clean-preview`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as CleanPreviewResult
  }

  async function rollbackDeployment(deploymentId: string) {
    return await apiFetch(`/deployments/${deploymentId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  async function fetchDiskOverview() {
    return await apiFetch('/disk/overview')
  }

  async function fetchDiskProjects() {
    return await apiFetch('/disk/projects')
  }

  async function fetchProjectArtifacts(projectId: string) {
    return await apiFetch(`/disk/projects/${projectId}/artifacts`)
  }

  async function deleteArtifact(deployId: string) {
    return await apiFetch(`/disk/artifacts/${deployId}`, {
      method: 'DELETE',
    })
  }

  async function fetchHeatmap(days = 30) {
    try {
      return await apiFetch(`/stats/heatmap?days=${days}`)
    } catch (e) {
      console.error('Failed to fetch heatmap', e)
      return { days, cells: [] }
    }
  }

  async function fetchSuccessRate(days = 14) {
    try {
      return await apiFetch(`/stats/success-rate?days=${days}`)
    } catch (e) {
      console.error('Failed to fetch success rate', e)
      return { days, points: [] }
    }
  }

  async function fetchFailureTop(limit = 5, days = 30) {
    try {
      return await apiFetch(`/stats/failure-top?limit=${limit}&days=${days}`)
    } catch (e) {
      console.error('Failed to fetch failure top', e)
      return { days, limit, minTotal: 3, items: [] }
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

  async function fetchHealthDetail() {
    try {
      return await apiFetch('/health/detail')
    } catch (e) {
      console.error('Failed to fetch health detail', e)
      return null
    }
  }

  async function fetchAuditLogs(params: {
    action?: string
    targetId?: string
    targetType?: string
    from?: number
    to?: number
    limit?: number
    offset?: number
  } = {}) {
    try {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') qs.append(k, String(v))
      }
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      return await apiFetch(`/audit-logs${suffix}`)
    } catch (e) {
      console.error('Failed to fetch audit logs', e)
      return { rows: [], total: 0, limit: 50, offset: 0 }
    }
  }

  async function fetchAuditLogDetail(id: string) {
    try {
      return await apiFetch(`/audit-logs/${id}`)
    } catch (e) {
      console.error('Failed to fetch audit log detail', e)
      return null
    }
  }

  async function fetchFsHome() {
    return await apiFetch('/fs/home') as {
      home: string
      cwd: string
      sep: string
      roots: string[]
    }
  }

  async function fetchFsList(p: string) {
    return await apiFetch(`/fs/list?path=${encodeURIComponent(p)}`) as {
      path: string
      parent: string | null
      exists: boolean
      isDir: boolean
      truncated: boolean
      entries: Array<{
        name: string
        path: string
        isDir: boolean
        isHidden: boolean
        isSymlink: boolean
      }>
    }
  }

  async function login(token: string) {
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ token }),
        silent401: true
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
    cleanPreview,
    rollbackDeployment,
    fetchDiskOverview,
    fetchDiskProjects,
    fetchProjectArtifacts,
    deleteArtifact,
    fetchHeatmap,
    fetchSuccessRate,
    fetchFailureTop,
    generateToken,
    fetchSettings,
    updateSettings,
    changeAdminToken,
    fetchSystemStatus,
    fetchHealthDetail,
    fetchAuditLogs,
    fetchAuditLogDetail,
    fetchFiles,
    fetchFileContent,
    fetchFsHome,
    fetchFsList,
    login,
    logout
  }
})