export interface ProjectListReturnContext {
  href: string
  scrollTop: number
  projectId: string
  savedAt: number
}

const STORAGE_KEY = 'kite:projectList:returnContext'
const MAX_AGE_MS = 30 * 60 * 1000

export function saveProjectListReturnContext(context: Omit<ProjectListReturnContext, 'savedAt'>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...context,
      savedAt: Date.now(),
    }))
  } catch {}
}

export function readProjectListReturnContext(): ProjectListReturnContext | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProjectListReturnContext
    if (
      !parsed ||
      typeof parsed.href !== 'string' ||
      typeof parsed.scrollTop !== 'number' ||
      typeof parsed.projectId !== 'string' ||
      typeof parsed.savedAt !== 'number' ||
      Date.now() - parsed.savedAt > MAX_AGE_MS
    ) {
      clearProjectListReturnContext()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearProjectListReturnContext() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {}
}
