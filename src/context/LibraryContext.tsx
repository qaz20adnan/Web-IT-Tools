import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { HistoryEntry, SavedItem, ScriptTemplate } from '@/types'
import { readJson, STORAGE_KEYS, writeJson } from '@/lib/storage'
import { uid } from '@/lib/utils'

interface LibraryContextValue {
  saved: SavedItem[]
  history: HistoryEntry[]
  localScripts: ScriptTemplate[]
  saveItem: (item: Omit<SavedItem, 'id' | 'createdAt'>) => void
  isSaved: (refId: string) => boolean
  removeSaved: (id: string) => void
  clearSaved: () => void
  addHistory: (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => HistoryEntry
  removeHistory: (id: string) => void
  clearHistory: () => void
  addScript: (script: ScriptTemplate) => void
  removeScript: (id: string) => void
  clearAll: () => void
}

const LibraryContext = createContext<LibraryContextValue | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<SavedItem[]>(() => readJson<SavedItem[]>(STORAGE_KEYS.saved, []))
  const [history, setHistory] = useState<HistoryEntry[]>(() => readJson<HistoryEntry[]>(STORAGE_KEYS.history, []))
  const [localScripts, setLocalScripts] = useState<ScriptTemplate[]>(() =>
    readJson<ScriptTemplate[]>(STORAGE_KEYS.scripts, []),
  )

  useEffect(() => {
    writeJson(STORAGE_KEYS.saved, saved)
  }, [saved])
  useEffect(() => {
    writeJson(STORAGE_KEYS.history, history)
  }, [history])
  useEffect(() => {
    writeJson(STORAGE_KEYS.scripts, localScripts)
  }, [localScripts])

  const saveItem = useCallback((item: Omit<SavedItem, 'id' | 'createdAt'>) => {
    setSaved((current) => {
      if (item.refId && current.some((entry) => entry.kind === item.kind && entry.refId === item.refId)) {
        return current
      }
      if (!item.refId && current.some((entry) => entry.kind === item.kind && entry.title === item.title)) {
        return current
      }
      return [{ ...item, id: uid('saved'), createdAt: new Date().toISOString() }, ...current].slice(0, 500)
    })
  }, [])

  const isSaved = useCallback(
    (refId: string) => saved.some((entry) => entry.refId === refId),
    [saved],
  )

  const removeSaved = useCallback((id: string) => {
    setSaved((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const clearSaved = useCallback(() => setSaved([]), [])

  const addHistory = useCallback((entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => {
    const record: HistoryEntry = { ...entry, id: uid('history'), createdAt: new Date().toISOString() }
    setHistory((current) => [record, ...current].slice(0, 100))
    return record
  }, [])

  const removeHistory = useCallback((id: string) => {
    setHistory((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const clearHistory = useCallback(() => setHistory([]), [])

  const addScript = useCallback((script: ScriptTemplate) => {
    setLocalScripts((current) => [script, ...current.filter((entry) => entry.id !== script.id)].slice(0, 200))
  }, [])

  const removeScript = useCallback((id: string) => {
    setLocalScripts((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setSaved([])
    setHistory([])
    setLocalScripts([])
  }, [])

  const value = useMemo<LibraryContextValue>(
    () => ({
      saved,
      history,
      localScripts,
      saveItem,
      isSaved,
      removeSaved,
      clearSaved,
      addHistory,
      removeHistory,
      clearHistory,
      addScript,
      removeScript,
      clearAll,
    }),
    [
      saved,
      history,
      localScripts,
      saveItem,
      isSaved,
      removeSaved,
      clearSaved,
      addHistory,
      removeHistory,
      clearHistory,
      addScript,
      removeScript,
      clearAll,
    ],
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext)
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider')
  return ctx
}
