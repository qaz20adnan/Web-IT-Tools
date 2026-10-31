import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewsItem } from '@/types'
import { fetchNews } from '@/services/api'
import { describeError } from '@/services/apiError'
import { readJson, STORAGE_KEYS, writeJson } from '@/lib/storage'
import { useApp } from '@/context/AppContext'

export interface NewsCache {
  items: NewsItem[]
  fetchedAt: string
  sources: string[]
}

export function useNews() {
  const { settings } = useApp()
  const [items, setItems] = useState<NewsItem[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [sources, setSources] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  // A ref, not a dep: load() feeds the fetch effect below, so putting the
  // language in its deps would re-request the news on every language switch.
  const languageRef = useRef(settings.language)
  useEffect(() => {
    languageRef.current = settings.language
  }, [settings.language])

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetchNews(force)
      setItems(response.items)
      setFetchedAt(response.fetchedAt)
      setSources(response.sources)
      setErrors(response.errors ?? [])
      // The endpoint keeps serving the last good list when a refresh fails and
      // marks it, so the flag comes from the response rather than from this call.
      setStale(response.stale)
      writeJson<NewsCache>(STORAGE_KEYS.newsCache, {
        items: response.items,
        fetchedAt: response.fetchedAt,
        sources: response.sources,
      })
    } catch (caught) {
      const cache = readJson<NewsCache | null>(STORAGE_KEYS.newsCache, null)
      const message = describeError(caught, languageRef.current, 'News fetch failed')
      setErrors([])
      if (cache?.items?.length) {
        setItems(cache.items)
        setFetchedAt(cache.fetchedAt)
        setSources(cache.sources)
        setStale(true)
        setError(message)
      } else {
        setItems([])
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { items, fetchedAt, sources, errors, loading, error, stale, refresh: () => load(true) }
}
