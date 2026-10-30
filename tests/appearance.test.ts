import { describe, expect, it } from 'vitest'
import {
  ACCENTS,
  ANIMATION_LEVELS,
  BACKGROUNDS,
  DEFAULT_APPEARANCE,
  RADIUS_SCALES,
  isAccentId,
  isAnimationIntensity,
  isBackgroundStyle,
  isRadiusScale,
  normalizeAppearance,
} from '@/lib/appearance'

describe('appearance preferences', () => {
  it('accepts every documented option', () => {
    for (const accent of ACCENTS) expect(isAccentId(accent)).toBe(true)
    for (const radius of RADIUS_SCALES) expect(isRadiusScale(radius)).toBe(true)
    for (const background of BACKGROUNDS) expect(isBackgroundStyle(background)).toBe(true)
    for (const animation of ANIMATION_LEVELS) expect(isAnimationIntensity(animation)).toBe(true)
  })

  it('rejects unknown or non-string values', () => {
    expect(isAccentId('magenta')).toBe(false)
    expect(isAccentId(null)).toBe(false)
    expect(isRadiusScale(3)).toBe(false)
    expect(isBackgroundStyle('video')).toBe(false)
    expect(isAnimationIntensity('fast')).toBe(false)
  })

  it('normalizes a missing or corrupt settings object', () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance({ accent: 'invalid', radius: 'invalid', background: 'invalid', animation: 'invalid' })).toEqual(DEFAULT_APPEARANCE)
  })

  it('keeps valid values while replacing only invalid ones', () => {
    expect(normalizeAppearance({ accent: 'emerald', radius: 'sharp', background: 'grid', animation: 'subtle' })).toEqual({
      accent: 'emerald',
      radius: 'sharp',
      background: 'grid',
      animation: 'subtle',
    })
    expect(normalizeAppearance({ accent: 'rose', background: 'noise' })).toEqual({
      ...DEFAULT_APPEARANCE,
      accent: 'rose',
    })
  })
})
