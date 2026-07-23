import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiUrl, pageUrl } from '../lib/base'

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
  postDeployAsync?: boolean
  token?: string
  env?: string
  cleanMode?: 'merge' | 'clean' | 'clean-all' | null
  protectPaths?: string | null
  categoryId?: string | null
  pm2AppName?: string | null
  tagIds?: string[]
  lastDeployAt?: string | null
  status: 'running' | 'success' | 'failed' | 'idle'
  updatedAt: string
}

export interface Category {
  id: string
  name: string
  color?: string | null
  sortOrder?: number
  createdAt: string
  updatedAt: string
}

export interface Tag {
  id: string
  name: string
  color?: string | null
  sortOrder?: number
  projectCount?: number
  createdAt: string
  updatedAt: string
}

export interface SystemResources {
  collectedAt: string
  host: {
    hostname: string
    platform: string
    arch: string
    cpuModel: string | null
    cpuCount: number
    loadAvg: number[]
    uptimeSec: number
  }
  cpu: { percent: number | null }
  memory: { totalBytes: number; freeBytes: number; availableBytes: number; usedBytes: number; percentUsed: number }
  disk: { freeBytes: number | null; totalBytes: number | null; percentUsed: number | null }
  process: {
    pid: number
    runtime: 'bun' | 'node'
    runtimeVersion: string
    uptimeSec: number
    cpuPercent: number | null
    memoryRssBytes: number
    memoryHeapUsedBytes: number
  }
}

export interface Pm2InstanceLogPaths {
  pmId: number
  instanceId?: number
  outLogPath?: string
  errorLogPath?: string
}

export interface Pm2AppStatus {
  bound: boolean
  found?: boolean
  name?: string
  pmId?: number
  pid?: number
  status?: string
  uptimeMs?: number
  restarts?: number
  unstableRestarts?: number
  cpuPercent?: number
  memoryBytes?: number
  execMode?: string
  instances?: number
  errorLogPath?: string
  outLogPath?: string
  instancesLogPaths?: Pm2InstanceLogPaths[]
  createdAt?: number
  message?: string
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
  const categories = ref<Category[]>([])
  const tags = ref<Tag[]>([])
  const systemResources = ref<SystemResources | null>(null)

  // Helper fetch function
  async function apiFetch(endpoint: string, options: RequestInit & { silent401?: boolean } = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as any)
    }
    if (adminToken.value) {
      headers['Authorization'] = `Bearer ${adminToken.value}`
    }
    
    const res = await fetch(apiUrl(endpoint), {
      ...options,
      headers
    })
    
    if (res.status === 401 && !options.silent401) {
      logout()
      window.location.href = pageUrl('/login')
      throw new Error('Unauthorized')
    }
    const data = await res.json()
    if (!res.ok) {
      const err: any = new Error(data.error || data.message || 'API request failed')
      err.status = res.status
      err.data = data
      throw err
    }
    return data
  }

  function mapProject(p: any): Project {
    return {
      ...p,
      destPath: p.deployPath,
      preDeploy: p.preDeployScript,
      postDeploy: p.postDeployScript,
      env: p.env || '',
      cleanMode: p.cleanMode ?? null,
      protectPaths: p.protectPaths ?? null,
      categoryId: p.categoryId ?? null,
      pm2AppName: p.pm2AppName ?? null,
      tagIds: Array.isArray(p.tagIds) ? p.tagIds : [],
      lastDeployAt: p.lastDeployAt ?? null,
    }
  }

  function upsertProject(mapped: Project) {
    const idx = projects.value.findIndex(p => p.id === mapped.id)
    if (idx >= 0) {
      projects.value[idx] = { ...projects.value[idx], ...mapped }
    } else {
      projects.value = [mapped, ...projects.value]
    }
  }

  async function fetchProjects(filter?: { tagIds?: string[] }) {
    try {
      const qs = filter?.tagIds && filter.tagIds.length > 0
        ? `?tagIds=${encodeURIComponent(filter.tagIds.join(','))}`
        : ''
      const data = await apiFetch('/projects' + qs)
      projects.value = Array.isArray(data) ? data.map(mapProject) : []
    } catch (e) {
      console.error('Failed to fetch projects', e)
    }
  }

  async function fetchProjectById(id: string): Promise<Project | null> {
    try {
      const data = await apiFetch(`/projects/${id}`)
      if (!data || data.error || !data.id) return null
      const mapped = mapProject(data)
      upsertProject(mapped)
      return mapped
    } catch (e) {
      console.error('Failed to fetch project', e)
      return null
    }
  }

  async function fetchLogs() {
    try {
      const data = await apiFetch('/logs')
      logs.value = Array.isArray(data) ? data : []
    } catch (e) {
      console.error('Failed to fetch logs', e)
    }
  }

  function getProjectById(id: string) {
    return projects.value.find(p => p.id === id)
  }

  async function addProject(project: Partial<Project>): Promise<{ ok: boolean; error?: string; conflictProject?: string }> {
    try {
      const tagIds = Array.isArray((project as any).tagIds) ? (project as any).tagIds as string[] : undefined
      const data = await apiFetch('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: project.name,
          description: project.description,
          deployPath: project.destPath || '/tmp/default-deploy',
          env: project.env || undefined,
          categoryId: project.categoryId ?? undefined,
          pm2AppName: (project as any).pm2AppName ?? undefined,
          tagIds,
        })
      })
      if (data.success) {
        if (data.project?.id) {
          upsertProject(mapProject(data.project))
        }
        if (tagIds && tagIds.length > 0) {
          await Promise.all([fetchProjects(), fetchTags()])
        } else {
          await fetchProjects()
        }
        return { ok: true }
      }
    } catch (e: any) {
      console.error('Failed to add project', e)
      return { ok: false, error: e?.message, conflictProject: e?.data?.conflictProject }
    }
    return { ok: false }
  }

  async function removeProject(id: string) {
    try {
      // 删项目前先看它是否有关联标签，决定是否需要刷新 tags（避免无谓请求）
      const hadTags = (projects.value.find(p => p.id === id)?.tagIds?.length ?? 0) > 0
      const data = await apiFetch(`/projects/${id}`, { method: 'DELETE' })
      if (data.success) {
        if (hadTags) {
          await Promise.all([fetchProjects(), fetchTags()])
        } else {
          await fetchProjects()
        }
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
      if (payload.name !== undefined) apiPayload.name = payload.name
      if (payload.preDeploy !== undefined) apiPayload.preDeployScript = payload.preDeploy
      if (payload.postDeploy !== undefined) apiPayload.postDeployScript = payload.postDeploy
      if (payload.postDeployAsync !== undefined) apiPayload.postDeployAsync = Boolean(payload.postDeployAsync)
      if (payload.destPath !== undefined) apiPayload.deployPath = payload.destPath
      if (payload.cleanMode !== undefined) apiPayload.cleanMode = payload.cleanMode
      if (payload.protectPaths !== undefined) apiPayload.protectPaths = payload.protectPaths
      if (payload.categoryId !== undefined) apiPayload.categoryId = payload.categoryId
      if (payload.env !== undefined) apiPayload.env = payload.env
      if (payload.pm2AppName !== undefined) apiPayload.pm2AppName = payload.pm2AppName
      if (payload.tagIds !== undefined) apiPayload.tagIds = payload.tagIds

      const data = await apiFetch(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(apiPayload)
      })
      if (data.success) {
        // tagIds 变更会影响 tags[].projectCount，需要并行刷新避免筛选条数字滞后
        if (payload.tagIds !== undefined) {
          await Promise.all([fetchProjects(), fetchTags()])
        } else {
          await fetchProjects()
        }
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

  async function markDeploymentStatus(deploymentId: string, status: 'success' | 'failed') {
    return await apiFetch(`/deployments/${deploymentId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
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

  async function testWebhook() {
    try {
      return await apiFetch('/settings/webhook-test', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    } catch (e: any) {
      console.error('Failed to test webhook', e)
      return { success: false, error: e?.message || String(e) }
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

  async function fetchFsList(p: string, include: 'dirs' | 'files' | 'both' = 'dirs') {
    const qs = `path=${encodeURIComponent(p)}&include=${include}`
    return await apiFetch(`/fs/list?${qs}`) as {
      path: string
      parent: string | null
      exists: boolean
      isDir: boolean
      truncated: boolean
      entries: Array<{
        name: string
        path: string
        isDir: boolean
        isFile?: boolean
        isHidden: boolean
        isSymlink: boolean
      }>
    }
  }

  async function fetchLogSources(projectId: string) {
    return await apiFetch(`/projects/${projectId}/log-sources`) as {
      items: Array<{
        id: string
        projectId: string
        label: string
        filePath: string
        kind: string
        sortOrder: number
        createdAt: string
        updatedAt: string
      }>
    }
  }

  async function createLogSources(projectId: string, items: Array<{ label?: string; filePath: string; kind?: string; sortOrder?: number }>) {
    return await apiFetch(`/projects/${projectId}/log-sources`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    })
  }

  async function updateLogSource(sourceId: string, patch: { label?: string; kind?: string; sortOrder?: number }) {
    return await apiFetch(`/log-sources/${sourceId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }

  async function deleteLogSource(sourceId: string) {
    return await apiFetch(`/log-sources/${sourceId}`, { method: 'DELETE' })
  }

  async function prunePm2LogSources(projectId: string) {
    return await apiFetch(`/projects/${projectId}/log-sources/prune-pm2`, {
      method: 'POST',
      body: JSON.stringify({}),
    }) as {
      removed: Array<{ id: string; label: string; filePath: string }>
      activePaths: string[]
      kept?: number
      skipped?: string
      message?: string
    }
  }

  async function fetchLogSourceMeta(sourceId: string) {
    return await apiFetch(`/log-sources/${sourceId}/meta`) as {
      id: string
      label: string
      filePath: string
      resolvedPath: string
      kind: string
      size: number
    }
  }

  async function fetchLogSourceRange(sourceId: string, opts: { offset?: number; size?: number; direction?: 'forward' | 'backward' } = {}) {
    const qs = new URLSearchParams()
    if (opts.offset !== undefined) qs.set('offset', String(opts.offset))
    if (opts.size !== undefined) qs.set('size', String(opts.size))
    if (opts.direction) qs.set('direction', opts.direction)
    return await apiFetch(`/log-sources/${sourceId}/range?${qs.toString()}`) as {
      startOffset: number
      endOffset: number
      fileSize: number
      lines: string[]
      truncatedHead: boolean
      truncatedTail: boolean
      binary: boolean
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
    categories.value = []
    tags.value = []
    systemResources.value = null
  }

  async function fetchCategories() {
    try {
      const data = await apiFetch('/categories')
      categories.value = Array.isArray(data) ? data : []
    } catch (e) {
      console.error('Failed to fetch categories', e)
    }
  }

  async function createCategory(payload: { name: string; color?: string | null; sortOrder?: number }): Promise<{ ok: boolean; error?: string; conflictCategory?: string; category?: Category }> {
    try {
      const data = await apiFetch('/categories', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (data.success) {
        await fetchCategories()
        return { ok: true, category: data.category }
      }
      return { ok: false, error: data.error }
    } catch (e: any) {
      return { ok: false, error: e?.message, conflictCategory: e?.data?.conflictCategory }
    }
  }

  async function updateCategory(id: string, payload: { name?: string; color?: string | null; sortOrder?: number }): Promise<{ ok: boolean; error?: string; conflictCategory?: string; category?: Category }> {
    try {
      const data = await apiFetch(`/categories/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      if (data.success) {
        await fetchCategories()
        return { ok: true, category: data.category }
      }
      return { ok: false, error: data.error }
    } catch (e: any) {
      return { ok: false, error: e?.message, conflictCategory: e?.data?.conflictCategory }
    }
  }

  async function deleteCategory(id: string): Promise<{ ok: boolean; detachedProjects?: number; error?: string }> {
    try {
      const data = await apiFetch(`/categories/${id}`, { method: 'DELETE' })
      if (data.success) {
        await fetchCategories()
        await fetchProjects()
        return { ok: true, detachedProjects: data.detachedProjects }
      }
      return { ok: false, error: data.error }
    } catch (e: any) {
      return { ok: false, error: e?.message }
    }
  }

  async function fetchTags() {
    try {
      const data = await apiFetch('/tags')
      tags.value = Array.isArray(data) ? data : []
    } catch (e) {
      console.error('Failed to fetch tags', e)
    }
  }

  async function createTag(payload: { name: string; color?: string | null; sortOrder?: number }): Promise<{ ok: boolean; error?: string; conflictTag?: string; tag?: Tag }> {
    try {
      const data = await apiFetch('/tags', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (data.success) {
        await fetchTags()
        return { ok: true, tag: data.tag }
      }
      return { ok: false, error: data.error }
    } catch (e: any) {
      return { ok: false, error: e?.message, conflictTag: e?.data?.conflictTag }
    }
  }

  async function updateTag(id: string, payload: { name?: string; color?: string | null; sortOrder?: number }): Promise<{ ok: boolean; error?: string; conflictTag?: string; tag?: Tag }> {
    try {
      const data = await apiFetch(`/tags/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      if (data.success) {
        await fetchTags()
        return { ok: true, tag: data.tag }
      }
      return { ok: false, error: data.error }
    } catch (e: any) {
      return { ok: false, error: e?.message, conflictTag: e?.data?.conflictTag }
    }
  }

  async function deleteTag(id: string): Promise<{ ok: boolean; detachedProjects?: number; error?: string }> {
    try {
      const data = await apiFetch(`/tags/${id}`, { method: 'DELETE' })
      if (data.success) {
        await fetchTags()
        await fetchProjects()
        return { ok: true, detachedProjects: data.detachedProjects }
      }
      return { ok: false, error: data.error }
    } catch (e: any) {
      return { ok: false, error: e?.message }
    }
  }

  async function fetchSystemResources(): Promise<SystemResources | null> {
    try {
      const data = await apiFetch('/system/resources')
      systemResources.value = data
      return data
    } catch (e) {
      console.error('Failed to fetch system resources', e)
      return null
    }
  }

  async function fetchProjectPm2(projectId: string): Promise<Pm2AppStatus | null> {
    try {
      return await apiFetch(`/projects/${projectId}/pm2`)
    } catch (e) {
      console.error('Failed to fetch project pm2', e)
      return null
    }
  }

  async function fetchPm2Available(): Promise<boolean> {
    try {
      const data = await apiFetch('/pm2/available')
      return !!data?.available
    } catch {
      return false
    }
  }

  async function fetchPm2Apps(): Promise<Array<{ name: string; pmId: number; status: string }>> {
    try {
      const data = await apiFetch('/pm2/apps')
      return Array.isArray(data?.apps) ? data.apps : []
    } catch {
      return []
    }
  }

  async function fetchTerminalInfo(): Promise<any | null> {
    try {
      return await apiFetch('/terminal/info')
    } catch (e) {
      console.error('Failed to fetch terminal info', e)
      return null
    }
  }

  async function fetchTerminalWhoami(): Promise<{ socketIp: string | null; forwardedIp: string | null; trustedIp: string | null } | null> {
    try {
      return await apiFetch('/terminal/whoami')
    } catch (e) {
      console.error('Failed to fetch terminal whoami', e)
      return null
    }
  }

  async function fetchTerminalAllowlist(): Promise<{ entries: string[]; invalid: string[] } | null> {
    try {
      return await apiFetch('/terminal/allowlist')
    } catch (e) {
      console.error('Failed to fetch terminal allowlist', e)
      return null
    }
  }

  async function updateTerminalAllowlist(entries: string[]): Promise<{ success: boolean; entries?: string[]; error?: string }> {
    try {
      const data = await apiFetch('/terminal/allowlist', {
        method: 'PUT',
        body: JSON.stringify({ entries }),
      })
      return data
    } catch (e: any) {
      return { success: false, error: e?.message || 'failed' }
    }
  }

  return {
    adminToken,
    projects,
    logs,
    categories,
    tags,
    systemResources,
    fetchProjects,
    fetchProjectById,
    fetchLogs,
    getProjectById,
    addProject,
    updateProject,
    removeProject,
    cleanPreview,
    rollbackDeployment,
    markDeploymentStatus,
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
    testWebhook,
    changeAdminToken,
    fetchSystemStatus,
    fetchHealthDetail,
    fetchAuditLogs,
    fetchAuditLogDetail,
    fetchFiles,
    fetchFileContent,
    fetchFsHome,
    fetchFsList,
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    fetchTags,
    createTag,
    updateTag,
    deleteTag,
    fetchSystemResources,
    fetchProjectPm2,
    fetchPm2Available,
    fetchPm2Apps,
    fetchTerminalInfo,
    fetchTerminalWhoami,
    fetchTerminalAllowlist,
    updateTerminalAllowlist,
    fetchLogSources,
    createLogSources,
    updateLogSource,
    deleteLogSource,
    prunePm2LogSources,
    fetchLogSourceMeta,
    fetchLogSourceRange,
    login,
    logout
  }
})