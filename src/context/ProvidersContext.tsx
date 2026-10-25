import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ProviderConfig, ProviderDraft } from '@/types'
import { readJson, scopedStorageKey, sessionGet, sessionRemove, sessionSet, STORAGE_KEYS, writeJson } from '@/lib/storage'
import { uid } from '@/lib/utils'
import { useApp } from './AppContext'
import type { AiCredentials } from '@/services/api'

const KEY_PREFIX = 'nexora.key.'

interface ProvidersContextValue {
  providers: ProviderConfig[]
  defaultProvider: ProviderConfig | null
  credentials: AiCredentials | null
  hasClientProvider: boolean
  hasKey: (id: string) => boolean
  getKey: (id: string) => string | null
  saveProvider: (draft: ProviderDraft, existingId?: string) => ProviderConfig
  removeProvider: (id: string) => void
  makeDefault: (id: string) => void
  clearKeys: () => void
}

const ProvidersContext = createContext<ProvidersContextValue | null>(null)

export function ProvidersProvider({ children, userId = 'guest' }: { children: ReactNode; userId?: string }) {
  const { settings } = useApp()
  const providersKey = scopedStorageKey(STORAGE_KEYS.providers, userId)
  const sessionPrefix = `${KEY_PREFIX}${userId}.`
  const [providers, setProviders] = useState<ProviderConfig[]>(() =>
    readJson<ProviderConfig[]>(providersKey, []),
  )
  const [keys, setKeys] = useState<Record<string, string>>(() => {
    const stored = readJson<ProviderConfig[]>(providersKey, [])
    if (!readJson<{ storeProviderKeysInSession?: boolean }>(STORAGE_KEYS.settings, {}).storeProviderKeysInSession) {
      return {}
    }
    const restored: Record<string, string> = {}
    for (const provider of stored) {
      const value = sessionGet(`${sessionPrefix}${provider.id}`)
      if (value) restored[provider.id] = value
    }
    return restored
  })

  useEffect(() => {
    writeJson(providersKey, providers)
  }, [providers, providersKey])

  useEffect(() => {
    for (const provider of providers) {
      const value = keys[provider.id]
      if (!value) continue
      if (settings.storeProviderKeysInSession) sessionSet(`${sessionPrefix}${provider.id}`, value)
      else sessionRemove(`${sessionPrefix}${provider.id}`)
    }
  }, [providers, keys, settings.storeProviderKeysInSession, sessionPrefix])

  const persistKey = useCallback(
    (id: string, value: string) => {
      setKeys((current) => {
        const next = { ...current }
        if (value) next[id] = value
        else delete next[id]
        return next
      })
      if (settings.storeProviderKeysInSession && value) {
        sessionSet(`${sessionPrefix}${id}`, value)
      } else {
        sessionRemove(`${sessionPrefix}${id}`)
      }
    },
    [settings.storeProviderKeysInSession, sessionPrefix],
  )

  const getKey = useCallback((id: string) => keys[id] ?? null, [keys])
  const hasKey = useCallback((id: string) => Boolean(keys[id]), [keys])

  const saveProvider = useCallback(
    (draft: ProviderDraft, existingId?: string) => {
      const id = existingId ?? uid('provider')
      const config: ProviderConfig = {
        id,
        kind: draft.kind,
        label: draft.label.trim() || draft.kind,
        baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
        model: draft.model.trim(),
        fallbackModel: draft.fallbackModel.trim(),
        visionModel: draft.visionModel.trim(),
        supportsVision: draft.supportsVision,
        isDefault: draft.isDefault,
        createdAt: new Date().toISOString(),
      }
      setProviders((current) => {
        const withoutExisting = current.filter((provider) => provider.id !== id)
        const next = draft.isDefault
          ? [...withoutExisting.map((provider) => ({ ...provider, isDefault: false })), config]
          : [...withoutExisting, config]
        if (!next.some((provider) => provider.isDefault) && next.length === 1) {
          next[0] = { ...next[0], isDefault: true }
        }
        return next
      })
      if (draft.apiKey.trim()) persistKey(id, draft.apiKey.trim())
      return config
    },
    [persistKey],
  )

  const removeProvider = useCallback(
    (id: string) => {
      setProviders((current) => {
        const next = current.filter((provider) => provider.id !== id)
        if (next.length > 0 && !next.some((provider) => provider.isDefault)) {
          next[0] = { ...next[0], isDefault: true }
        }
        return next
      })
      persistKey(id, '')
    },
    [persistKey],
  )

  const makeDefault = useCallback((id: string) => {
    setProviders((current) => current.map((provider) => ({ ...provider, isDefault: provider.id === id })))
  }, [])

  const clearKeys = useCallback(() => {
    setProviders((current) => {
      current.forEach((provider) => sessionRemove(`${sessionPrefix}${provider.id}`))
      return current
    })
    setKeys({})
  }, [sessionPrefix])

  const defaultProvider = useMemo(
    () => providers.find((provider) => provider.isDefault) ?? providers[0] ?? null,
    [providers],
  )

  const credentials = useMemo<AiCredentials | null>(() => {
    if (!defaultProvider) return null
    return { provider: defaultProvider, apiKey: keys[defaultProvider.id] ?? null }
  }, [defaultProvider, keys])

  const value = useMemo<ProvidersContextValue>(
    () => ({
      providers,
      defaultProvider,
      credentials,
      hasClientProvider: providers.length > 0,
      hasKey,
      getKey,
      saveProvider,
      removeProvider,
      makeDefault,
      clearKeys,
    }),
    [providers, defaultProvider, credentials, hasKey, getKey, saveProvider, removeProvider, makeDefault, clearKeys],
  )

  return <ProvidersContext.Provider value={value}>{children}</ProvidersContext.Provider>
}

export function useProviders(): ProvidersContextValue {
  const ctx = useContext(ProvidersContext)
  if (!ctx) throw new Error('useProviders must be used inside ProvidersProvider')
  return ctx
}

export { KEY_PREFIX }

