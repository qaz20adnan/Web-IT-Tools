import type { ThemeId } from '@/types'
import type { TranslationKey } from '@/i18n'

export interface ThemeMeta {
  id: Exclude<ThemeId, 'auto'>
  labelKey: TranslationKey
  dark: boolean
  swatch: [string, string, string]
  /** Themes that carry the Adnan Tech identity, surfaced first in pickers. */
  brand?: boolean
}

export const THEMES: ThemeMeta[] = [
  { id: 'nexus-midnight', labelKey: 'theme.nexus-midnight', dark: true, swatch: ['#071421', '#0d2030', '#35d6f2'], brand: true },
  { id: 'arctic-light', labelKey: 'theme.arctic-light', dark: false, swatch: ['#f4f7fb', '#ffffff', '#0e7490'], brand: true },
  { id: 'deep-ocean', labelKey: 'theme.deep-ocean', dark: true, swatch: ['#02141c', '#06212d', '#2dd4bf'], brand: true },
  { id: 'graphite-pro', labelKey: 'theme.graphite-pro', dark: true, swatch: ['#17191c', '#1f2226', '#5ee0f2'], brand: true },
  { id: 'emerald-console', labelKey: 'theme.emerald-console', dark: true, swatch: ['#06130d', '#0a1f16', '#4ade80'], brand: true },
  { id: 'oled-black', labelKey: 'theme.oled-black', dark: true, swatch: ['#000000', '#080808', '#22d3ee'], brand: true },
  { id: 'cyber-pulse', labelKey: 'theme.cyber-pulse', dark: true, swatch: ['#0a0714', '#130e23', '#c084fc'] },
  { id: 'sandstone-calm', labelKey: 'theme.sandstone-calm', dark: false, swatch: ['#f6f1e7', '#fffdf8', '#9a5b23'] },
  { id: 'purple-nebula', labelKey: 'theme.purple-nebula', dark: true, swatch: ['#0b0616', '#171028', '#a78bfa'] },
  { id: 'sunset-ember', labelKey: 'theme.sunset-ember', dark: true, swatch: ['#170b08', '#251310', '#fb923c'] },
  { id: 'forest-mist', labelKey: 'theme.forest-mist', dark: false, swatch: ['#eef4ec', '#ffffff', '#2f6b4f'] },
]
