import { useCallback, useEffect, useState } from 'react'
import type { HealthStatus } from '@/types'
import { getHealth } from '@/services/api'

interface HealthState {
  data: HealthStatus | null
  loading: boolean
  error: boolean
}

export function useHealth(): HealthState & { refresh: () => void } {
  const [state, setState] = useState<HealthState>({ data: null, loading: true, error: false })

  const refresh = useCallback(() => {
    let cancelled = false
    setState((current) => ({ ...current, loading: true, error: false }))
    getHealth()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: false })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false, error: true })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = refresh()
    return cancel
  }, [refresh])

  return { ...state, refresh }
}
