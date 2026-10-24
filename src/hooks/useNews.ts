import { useCallback, useEffect, useState } from 'react'
import type { NewsItem } from '@/types'
import { fetchNews } from '@/services/api'
import { readJson, STORAGE_KEYS, writeJson } from '@/lib/storage'

export interface NewsCache {
  items: NewsItem[]
  fetchedAt: string
  sources: string[]
}

export function useNews() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [sources, setSources] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetchNews(force)
      setItems(response.items)
      setFetchedAt(response.fetchedAt)
      setSources(response.sources)
      setErrors(response.errors ?? [])
      setStale(false)
      writeJson<NewsCache>(STORAGE_KEYS.newsCache, {
        items: response.items,
        fetchedAt: response.fetchedAt,
        sources: response.sources,
      })
    } catch (caught) {
      const cache = readJson<NewsCache | null>(STORAGE_KEYS.newsCache, null)
      if (cache?.items?.length) {
        setItems(cache.items)
        setFetchedAt(cache.fetchedAt)
        setSources(cache.sources)
        setStale(true)
        setError(caught instanceof Error ? caught.message : 'News fetch failed')
      } else {
        setItems([])
        setError(caught instanceof Error ? caught.message : 'News fetch failed')
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
