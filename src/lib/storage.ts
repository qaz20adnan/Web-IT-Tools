export const STORAGE_KEYS = {
  settings: 'nexora.settings.v1',
  providers: 'nexora.providers.v1',
  saved: 'nexora.saved.v1',
  history: 'nexora.history.v1',
  scripts: 'nexora.scripts.v1',
  newsCache: 'nexora.news.v1',
  researchRecent: 'nexora.research.v1',
  knowledgeBase: 'nexora.kb.v1',
  netIpHistory: 'nexora.net.ip.v1',
  conversations: 'nexora.conversations.v1',
  diagnostics: 'nexora.diagnostics.v1',
  diagnosticFavorites: 'nexora.diagnostics.favorites.v1',
  securityLab: 'nexora.securitylab.v1',
} as const

let activeStorageUser: string | null = null

/** Set synchronously by the authenticated app shell before private pages render. */
export function setActiveStorageUser(userId: string | null): void {
  activeStorageUser = userId
}

/** Namespaces private browser data per account so two users never share it. */
export function scopedStorageKey(key: string, userId: string | null | undefined = activeStorageUser): string {
  return `${key}.u.${userId?.trim() || 'guest'}`
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* storage may be unavailable in private mode */
  }
}

export function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function clearSessionKeys(prefix = 'nexora.key.'): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    keys.forEach((key) => sessionStorage.removeItem(key))
  } catch {
    /* ignore */
  }
}

export function localDataSize(): number {
  try {
    let total = 0
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key) continue
      const value = localStorage.getItem(key) ?? ''
      total += key.length + value.length
    }
    return total * 2
  } catch {
    return 0
  }
}
