import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { HistoryEntry, SavedItem, ScriptTemplate } from '@/types'
import { readJson, scopedStorageKey, STORAGE_KEYS, writeJson } from '@/lib/storage'
import { uid } from '@/lib/utils'

interface LibraryContextValue {
  saved: SavedItem[]
  history: HistoryEntry[]
  localScripts: ScriptTemplate[]
  scriptFavorites: string[]
  saveItem: (item: Omit<SavedItem, 'id' | 'createdAt'>) => void
  isSaved: (refId: string) => boolean
  removeSaved: (id: string) => void
  clearSaved: () => void
  addHistory: (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => HistoryEntry
  removeHistory: (id: string) => void
  clearHistory: () => void
  addScript: (script: ScriptTemplate) => void
  updateScript: (id: string, patch: Partial<Omit<ScriptTemplate, 'id'>>) => void
  removeScript: (id: string) => void
  isScriptFavorite: (id: string) => boolean
  toggleScriptFavorite: (id: string) => void
  importScripts: (scripts: ScriptTemplate[], mode?: 'merge' | 'replace') => void
  clearAll: () => void
}

const LibraryContext = createContext<LibraryContextValue | null>(null)

export function LibraryProvider({ children, userId = 'guest' }: { children: ReactNode; userId?: string }) {
  const savedKey = scopedStorageKey(STORAGE_KEYS.saved, userId)
  const historyKey = scopedStorageKey(STORAGE_KEYS.history, userId)
  const scriptsKey = scopedStorageKey(STORAGE_KEYS.scripts, userId)
  const favoritesKey = scopedStorageKey(STORAGE_KEYS.scriptFavorites, userId)
  const [saved, setSaved] = useState<SavedItem[]>(() => readJson<SavedItem[]>(savedKey, []))
  const [history, setHistory] = useState<HistoryEntry[]>(() => readJson<HistoryEntry[]>(historyKey, []))
  const [localScripts, setLocalScripts] = useState<ScriptTemplate[]>(() =>
    readJson<ScriptTemplate[]>(scriptsKey, []),
  )
  const [scriptFavorites, setScriptFavorites] = useState<string[]>(() => readJson<string[]>(favoritesKey, []))

  useEffect(() => {
    writeJson(savedKey, saved)
  }, [saved, savedKey])
  useEffect(() => {
    writeJson(historyKey, history)
  }, [history, historyKey])
  useEffect(() => {
    writeJson(scriptsKey, localScripts)
  }, [localScripts, scriptsKey])
  useEffect(() => {
    writeJson(favoritesKey, scriptFavorites)
  }, [favoritesKey, scriptFavorites])

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

  const updateScript = useCallback((id: string, patch: Partial<Omit<ScriptTemplate, 'id'>>) => {
    setLocalScripts((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch, id } : entry))
  }, [])

  const removeScript = useCallback((id: string) => {
    setLocalScripts((current) => current.filter((entry) => entry.id !== id))
    setScriptFavorites((current) => current.filter((entry) => entry !== id))
  }, [])

  const isScriptFavorite = useCallback((id: string) => scriptFavorites.includes(id), [scriptFavorites])

  const toggleScriptFavorite = useCallback((id: string) => {
    setScriptFavorites((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id].slice(-500))
  }, [])

  const importScripts = useCallback((scripts: ScriptTemplate[], mode: 'merge' | 'replace' = 'merge') => {
    setLocalScripts((current) => (mode === 'replace' ? scripts : [...scripts, ...current]).slice(0, 500))
  }, [])

  const clearAll = useCallback(() => {
    setSaved([])
    setHistory([])
    setLocalScripts([])
    setScriptFavorites([])
  }, [])

  const value = useMemo<LibraryContextValue>(
    () => ({
      saved,
      history,
      localScripts,
      scriptFavorites,
      saveItem,
      isSaved,
      removeSaved,
      clearSaved,
      addHistory,
      removeHistory,
      clearHistory,
      addScript,
      updateScript,
      removeScript,
      isScriptFavorite,
      toggleScriptFavorite,
      importScripts,
      clearAll,
    }),
    [
      saved,
      history,
      localScripts,
      scriptFavorites,
      saveItem,
      isSaved,
      removeSaved,
      clearSaved,
      addHistory,
      removeHistory,
      clearHistory,
      addScript,
      updateScript,
      removeScript,
      isScriptFavorite,
      toggleScriptFavorite,
      importScripts,
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
