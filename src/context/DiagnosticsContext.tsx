import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readJson, scopedStorageKey, STORAGE_KEYS, writeJson } from '@/lib/storage'
import { uid } from '@/lib/utils'

export type DiagnosticTool = 'ping' | 'traceroute' | 'dns' | 'port' | 'http' | 'tls' | 'url' | 'file' | 'log'

export type DiagnosticStatus = 'success' | 'partial' | 'failure' | 'blocked' | 'error'

export interface DiagnosticRecord {
  id: string
  tool: DiagnosticTool
  target: string
  status: DiagnosticStatus
  summary: string
  createdAt: string
  durationMs?: number
  latencyMs?: number
  location: 'server' | 'browser'
}

export interface DiagnosticDraft {
  tool: DiagnosticTool
  target: string
  status: DiagnosticStatus
  summary: string
  durationMs?: number
  latencyMs?: number
  location?: 'server' | 'browser'
}

interface DiagnosticsContextValue {
  records: DiagnosticRecord[]
  favorites: string[]
  addRecord: (draft: DiagnosticDraft) => DiagnosticRecord
  removeRecord: (id: string) => void
  clearRecords: () => void
  toggleFavorite: (tool: string) => void
  isFavorite: (tool: string) => boolean
}

const MAX_RECORDS = 250
const DiagnosticsContext = createContext<DiagnosticsContextValue | null>(null)

export function DiagnosticsProvider({ children, userId = 'guest' }: { children: ReactNode; userId?: string }) {
  const recordsKey = scopedStorageKey(STORAGE_KEYS.diagnostics, userId)
  const favoritesKey = scopedStorageKey(STORAGE_KEYS.diagnosticFavorites, userId)
  const [records, setRecords] = useState<DiagnosticRecord[]>(() => {
    const saved = readJson<unknown>(recordsKey, [])
    if (!Array.isArray(saved)) return []
    return saved.filter(
      (entry): entry is DiagnosticRecord =>
        Boolean(entry) && typeof entry === 'object' && typeof (entry as DiagnosticRecord).createdAt === 'string',
    )
  })
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = readJson<unknown>(favoritesKey, [])
    return Array.isArray(saved) ? saved.filter((entry): entry is string => typeof entry === 'string') : []
  })

  useEffect(() => {
    writeJson(recordsKey, records)
  }, [records, recordsKey])

  useEffect(() => {
    writeJson(favoritesKey, favorites)
  }, [favorites, favoritesKey])

  const addRecord = useCallback((draft: DiagnosticDraft) => {
    const record: DiagnosticRecord = {
      ...draft,
      id: uid('diag'),
      createdAt: new Date().toISOString(),
      location: draft.location ?? 'server',
    }
    setRecords((current) => [record, ...current].slice(0, MAX_RECORDS))
    return record
  }, [])

  const removeRecord = useCallback((id: string) => {
    setRecords((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const clearRecords = useCallback(() => setRecords([]), [])

  const toggleFavorite = useCallback((tool: string) => {
    setFavorites((current) => (current.includes(tool) ? current.filter((entry) => entry !== tool) : [...current, tool]))
  }, [])

  const isFavorite = useCallback((tool: string) => favorites.includes(tool), [favorites])

  const value = useMemo(
    () => ({ records, favorites, addRecord, removeRecord, clearRecords, toggleFavorite, isFavorite }),
    [records, favorites, addRecord, removeRecord, clearRecords, toggleFavorite, isFavorite],
  )

  return <DiagnosticsContext.Provider value={value}>{children}</DiagnosticsContext.Provider>
}

export function useDiagnostics(): DiagnosticsContextValue {
  const ctx = useContext(DiagnosticsContext)
  if (!ctx) throw new Error('useDiagnostics must be used inside DiagnosticsProvider')
  return ctx
}

export interface DiagnosticAnalytics {
  total: number
  successRate: number | null
  todayCount: number
  avgPingMs: number | null
  byTool: Array<{ id: DiagnosticTool; label: string; count: number }>
  byStatus: Array<{ status: DiagnosticStatus; count: number }>
  activity: Array<{ key: string; label: string; count: number }>
}

const TOOL_LABELS: Record<DiagnosticTool, string> = {
  ping: 'Ping',
  traceroute: 'Traceroute',
  dns: 'DNS',
  port: 'Ports',
  http: 'HTTP',
  tls: 'SSL',
  url: 'URL Safety',
  file: 'File Analysis',
  log: 'Log Analysis',
}

export function diagnosticToolLabel(tool: DiagnosticTool): string {
  return TOOL_LABELS[tool]
}

export function buildDiagnosticAnalytics(records: DiagnosticRecord[], days = 14): DiagnosticAnalytics {
  const now = Date.now()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayCount = records.filter((entry) => new Date(entry.createdAt).getTime() >= today.getTime()).length
  const decided = records.filter((entry) => entry.status !== 'error')
  const success = records.filter((entry) => entry.status === 'success').length
  const pingValues = records
    .filter((entry) => entry.tool === 'ping' && typeof entry.latencyMs === 'number' && entry.latencyMs > 0)
    .map((entry) => entry.latencyMs as number)

  const toolCounts = new Map<DiagnosticTool, number>()
  const statusCounts = new Map<DiagnosticStatus, number>()
  records.forEach((entry) => {
    toolCounts.set(entry.tool, (toolCounts.get(entry.tool) ?? 0) + 1)
    statusCounts.set(entry.status, (statusCounts.get(entry.status) ?? 0) + 1)
  })

  const activity: Array<{ key: string; label: string; count: number }> = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now - offset * 86_400_000)
    const key = date.toISOString().slice(0, 10)
    const count = records.filter((entry) => entry.createdAt.slice(0, 10) === key).length
    activity.push({
      key,
      label: new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' }).format(date),
      count,
    })
  }

  return {
    total: records.length,
    successRate: decided.length === 0 ? null : Math.round((success / decided.length) * 100),
    todayCount,
    avgPingMs: pingValues.length === 0 ? null : Math.round(pingValues.reduce((sum, value) => sum + value, 0) / pingValues.length),
    byTool: [...toolCounts.entries()]
      .map(([id, count]) => ({ id, label: TOOL_LABELS[id], count }))
      .sort((a, b) => b.count - a.count),
    byStatus: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
    activity,
  }
}


