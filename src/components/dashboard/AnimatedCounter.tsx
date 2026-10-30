import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/context/AppContext'

export function AnimatedCounter({
  value,
  duration = 800,
  format,
  className,
}: {
  value: number
  duration?: number
  format?: (value: number) => string
  className?: string
}) {
  const { settings } = useApp()
  const [display, setDisplay] = useState(() => (settings.reduceMotion || settings.animation === 'none' ? value : 0))
  const previous = useRef(value)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    const reduce = settings.reduceMotion || settings.animation === 'none'
    if (reduce) {
      setDisplay(value)
      previous.current = value
      return
    }
    const from = previous.current
    const delta = value - from
    if (delta === 0) return
    const startedAt = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - (1 - progress) ** 3
      setDisplay(from + delta * eased)
      if (progress < 1) {
        frame.current = requestAnimationFrame(tick)
      } else {
        previous.current = value
        frame.current = null
      }
    }
    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      previous.current = value
    }
  }, [value, duration, settings.reduceMotion, settings.animation])

  const rounded = Math.round(display)
  return <span className={className}>{format ? format(rounded) : rounded.toLocaleString()}</span>
}
