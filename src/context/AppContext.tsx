import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Language, Settings, ThemeId } from '@/types'
import { readJson, STORAGE_KEYS, writeJson } from '@/lib/storage'
import { isRtl, translate, type TranslationKey, type TranslationParams } from '@/i18n'

const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  theme: 'nexus-midnight',
  fontScale: 'md',
  density: 'comfortable',
  onboardingComplete: false,
  reduceMotion: false,
  storeProviderKeysInSession: false,
  telemetryLocalOnly: true,
}

const DARK_THEMES: ThemeId[] = [
  'nexus-midnight',
  'cyber-pulse',
  'graphite-pro',
  'deep-ocean',
  'emerald-console',
  'oled-black',
  'purple-nebula',
  'sunset-ember',
]

const ALL_THEMES: ThemeId[] = [...DARK_THEMES, 'arctic-light', 'sandstone-calm', 'forest-mist']

interface AppContextValue {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  setLanguage: (language: Language) => void
  setTheme: (theme: ThemeId) => void
  cycleTheme: () => void
  resolvedTheme: Exclude<ThemeId, 'auto'>
  t: (key: TranslationKey, params?: TranslationParams) => string
  dir: 'rtl' | 'ltr'
  isDark: boolean
  completeOnboarding: () => void
  resetSettings: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

function resolveTheme(theme: ThemeId): Exclude<ThemeId, 'auto'> {
  if (theme !== 'auto') return theme
  const prefersLight =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
  return prefersLight ? 'arctic-light' : 'nexus-midnight'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    const stored = readJson<Partial<Settings>>(STORAGE_KEYS.settings, {})
    return { ...DEFAULT_SETTINGS, ...stored }
  })
  const [resolvedTheme, setResolvedTheme] = useState<Exclude<ThemeId, 'auto'>>(() => resolveTheme(settings.theme))

  useEffect(() => {
    const root = document.documentElement
    const theme = resolveTheme(settings.theme)
    setResolvedTheme(theme)
    root.dataset.theme = theme
    root.dataset.font = settings.fontScale
    root.dataset.density = settings.density
    root.dataset.reduceMotion = String(settings.reduceMotion)
    root.lang = settings.language
    root.dir = isRtl(settings.language) ? 'rtl' : 'ltr'
    root.style.colorScheme = DARK_THEMES.includes(theme) ? 'dark' : 'light'
    writeJson(STORAGE_KEYS.settings, settings)
  }, [settings])

  useEffect(() => {
    if (settings.theme !== 'auto') return
    const query = window.matchMedia('(prefers-color-scheme: light)')
    const handler = () => {
      const theme = resolveTheme('auto')
      setResolvedTheme(theme)
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = DARK_THEMES.includes(theme) ? 'dark' : 'light'
    }
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [settings.theme])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])

  const setLanguage = useCallback((language: Language) => updateSettings({ language }), [updateSettings])
  const setTheme = useCallback((theme: ThemeId) => updateSettings({ theme }), [updateSettings])

  const cycleTheme = useCallback(() => {
    setSettings((current) => {
      const currentIndex = ALL_THEMES.indexOf(current.theme)
      const next = ALL_THEMES[(currentIndex + 1) % ALL_THEMES.length]
      return { ...current, theme: next }
    })
  }, [])

  const completeOnboarding = useCallback(() => updateSettings({ onboardingComplete: true }), [updateSettings])
  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS, onboardingComplete: false })
  }, [])

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(settings.language, key, params),
    [settings.language],
  )

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      updateSettings,
      setLanguage,
      setTheme,
      cycleTheme,
      resolvedTheme,
      t,
      dir: isRtl(settings.language) ? 'rtl' : 'ltr',
      isDark: DARK_THEMES.includes(resolvedTheme),
      completeOnboarding,
      resetSettings,
    }),
    [settings, updateSettings, setLanguage, setTheme, cycleTheme, resolvedTheme, t, completeOnboarding, resetSettings],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

export { ALL_THEMES, DARK_THEMES, DEFAULT_SETTINGS }
