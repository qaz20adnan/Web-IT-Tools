import type { AccentId, AnimationIntensity, BackgroundStyle, RadiusScale } from '@/types'

export const ACCENTS: AccentId[] = ['theme', 'azure', 'violet', 'emerald', 'amber', 'rose']

export const ACCENT_SWATCHES: Record<AccentId, string> = {
  theme: 'var(--primary)',
  azure: '#38bdf8',
  violet: '#a78bfa',
  emerald: '#34d399',
  amber: '#fbbf24',
  rose: '#fb7185',
}
export const RADIUS_SCALES: RadiusScale[] = ['theme', 'sharp', 'soft', 'round']
export const BACKGROUNDS: BackgroundStyle[] = ['glow', 'plain', 'grid', 'dots']
export const ANIMATION_LEVELS: AnimationIntensity[] = ['full', 'subtle', 'none']

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

export function isAccentId(value: unknown): value is AccentId {
  return includes(ACCENTS, value)
}

export function isRadiusScale(value: unknown): value is RadiusScale {
  return includes(RADIUS_SCALES, value)
}

export function isBackgroundStyle(value: unknown): value is BackgroundStyle {
  return includes(BACKGROUNDS, value)
}

export function isAnimationIntensity(value: unknown): value is AnimationIntensity {
  return includes(ANIMATION_LEVELS, value)
}

export interface AppearanceValues {
  accent: AccentId
  radius: RadiusScale
  background: BackgroundStyle
  animation: AnimationIntensity
}

export type AppearanceInput = {
  accent?: unknown
  radius?: unknown
  background?: unknown
  animation?: unknown
}

export const DEFAULT_APPEARANCE: AppearanceValues = {
  accent: 'theme',
  radius: 'theme',
  background: 'glow',
  animation: 'full',
}

/**
 * Validates appearance values loaded from local storage or an imported
 * backup. Unknown values fall back to the default instead of being applied
 * to CSS custom properties.
 */
export function normalizeAppearance(input: AppearanceInput | null | undefined): AppearanceValues {
  return {
    accent: isAccentId(input?.accent) ? input.accent : DEFAULT_APPEARANCE.accent,
    radius: isRadiusScale(input?.radius) ? input.radius : DEFAULT_APPEARANCE.radius,
    background: isBackgroundStyle(input?.background) ? input.background : DEFAULT_APPEARANCE.background,
    animation: isAnimationIntensity(input?.animation) ? input.animation : DEFAULT_APPEARANCE.animation,
  }
}
