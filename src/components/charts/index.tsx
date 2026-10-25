import { useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ChartPoint {
  label: string
  value: number
  meta?: string
}

export interface ChartSeries {
  id: string
  label: string
  color: string
  points: ChartPoint[]
}

const PALETTE = ['#35d6f2', '#30d6b5', '#e6b85c', '#8ea7ff', '#f07f9a', '#9ad46a', '#c9a1ff', '#66c7e8']

export function chartColor(index: number): string {
  return PALETTE[index % PALETTE.length]
}

export function formatCompact(value: number, lang: 'en' | 'ar' = 'en'): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US', {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value)
}

function niceCeil(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

interface LineChartProps {
  series: ChartSeries[]
  height?: number
  lang?: 'en' | 'ar'
  ariaLabel: string
  emptyLabel?: string
  unit?: string
}

export function LineChart({ series, height = 190, lang = 'en', ariaLabel, emptyLabel, unit = '' }: LineChartProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; label: string; rows: Array<{ label: string; value: number; color: string }> } | null>(null)
  const width = 620
  const padding = { top: 14, right: 14, bottom: 26, left: 42 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const { max, labels } = useMemo(() => {
    const all = series.flatMap((entry) => entry.points.map((point) => point.value))
    const maximum = niceCeil(Math.max(1, ...all))
    const longest = series.reduce((best, entry) => (entry.points.length > best.length ? entry.points : best), [] as ChartPoint[])
    return { max: maximum, labels: longest.map((point) => point.label) }
  }, [series])

  const count = Math.max(1, labels.length)
  const xFor = (index: number) => padding.left + (count === 1 ? innerW / 2 : (index / (count - 1)) * innerW)
  const yFor = (value: number) => padding.top + innerH - (Math.max(0, value) / max) * innerH
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio))

  if (series.every((entry) => entry.points.length === 0)) {
    return <ChartEmpty label={emptyLabel ?? 'No data yet'} height={height} />
  }

  const handleMove = (clientX: number, clientY: number) => {
    const rect = wrap.current?.getBoundingClientRect()
    if (!rect) return
    const relative = ((clientX - rect.left) / rect.width) * width
    let nearest = 0
    let distance = Number.POSITIVE_INFINITY
    for (let index = 0; index < count; index += 1) {
      const delta = Math.abs(xFor(index) - relative)
      if (delta < distance) {
        distance = delta
        nearest = index
      }
    }
    const rows = series
      .map((entry) => ({ label: entry.label, value: entry.points[nearest]?.value ?? 0, color: entry.color }))
      .filter((entry) => Number.isFinite(entry.value))
    if (rows.length === 0) return
    setHover({
      x: Math.min(Math.max(clientX - rect.left, 8), rect.width - 8),
      y: Math.max(clientY - rect.top - 8, 0),
      label: labels[nearest] ?? '',
      rows,
    })
  }

  return (
    <div ref={wrap} className="relative w-full" style={{ minHeight: height }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(event) => handleMove(event.clientX, event.clientY)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(event) => {
          const touch = event.touches[0]
          if (touch) handleMove(touch.clientX, touch.clientY)
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0]
          if (touch) handleMove(touch.clientX, touch.clientY)
        }}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          {series.map((entry) => (
            <linearGradient key={entry.id} id={`area-${entry.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={entry.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={entry.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(value)}
              y2={yFor(value)}
              stroke="currentColor"
              className="text-line"
              strokeDasharray="3 5"
              strokeWidth="1"
            />
            <text x={padding.left - 8} y={yFor(value) + 3} textAnchor="end" className="fill-[var(--subtle)] text-[9px]">
              {formatCompact(value, lang)}
            </text>
          </g>
        ))}
        {labels.map((label, index) => {
          const step = Math.ceil(count / 6)
          if (index % step !== 0 && index !== count - 1) return null
          return (
            <text key={`${label}-${index}`} x={xFor(index)} y={height - 6} textAnchor="middle" className="fill-[var(--subtle)] text-[9px]">
              {label}
            </text>
          )
        })}
        {series.map((entry) => {
          if (entry.points.length === 0) return null
          const points = entry.points.map((point, index) => `${xFor(index)},${yFor(point.value)}`).join(' ')
          const area = `${padding.left},${padding.top + innerH} ${points} ${xFor(entry.points.length - 1)},${padding.top + innerH}`
          return (
            <g key={entry.id}>
              <polygon points={area} fill={`url(#area-${entry.id})`} />
              <polyline
                points={points}
                fill="none"
                stroke={entry.color}
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {entry.points.map((point, index) => (
                <circle
                  key={`${entry.id}-${index}`}
                  cx={xFor(index)}
                  cy={yFor(point.value)}
                  r={hover?.label === labels[index] ? 4 : 2.4}
                  fill="#071421"
                  stroke={entry.color}
                  strokeWidth="2"
                />
              ))}
            </g>
          )
        })}
        {hover ? (
          <line
            x1={xFor(labels.indexOf(hover.label))}
            x2={xFor(labels.indexOf(hover.label))}
            y1={padding.top}
            y2={padding.top + innerH}
            stroke="var(--line-strong)"
            strokeDasharray="3 4"
          />
        ) : null}
      </svg>
      {series.length > 1 ? (
        <div className="mt-1 flex flex-wrap items-center gap-3 px-1">
          {series.map((entry) => (
            <span key={entry.id} className="inline-flex items-center gap-1.5 text-[10px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color }} />
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}
      {hover ? (
        <div className="nx-chart-tip" style={{ left: hover.x, top: hover.y === 0 ? 0 : undefined, bottom: hover.y === 0 ? 'auto' : undefined }}>
          <p className="font-semibold text-text">{hover.label}</p>
          {hover.rows.map((row) => (
            <p key={row.label} className="text-muted">
              <span className="me-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: row.color }} />
              {row.label}: <span className="font-semibold text-text">{formatCompact(row.value, lang)}{unit}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface DonutChartProps {
  data: Array<{ label: string; value: number }>
  size?: number
  lang?: 'en' | 'ar'
  ariaLabel: string
  emptyLabel?: string
  centerLabel?: string
}

export function DonutChart({ data, size = 168, lang = 'en', ariaLabel, emptyLabel, centerLabel }: DonutChartProps) {
  const total = data.reduce((sum, entry) => sum + entry.value, 0)
  const [active, setActive] = useState<number | null>(null)
  if (total <= 0) return <ChartEmpty label={emptyLabel ?? 'No data yet'} height={size} />
  const radius = 58
  const circumference = 2 * Math.PI * radius
  const segments = data.reduce<Array<{ dash: number; offset: number }>>((accumulator, entry) => {
    const dash = (entry.value / total) * circumference
    const previous = accumulator[accumulator.length - 1]
    accumulator.push({ dash, offset: previous ? previous.offset + previous.dash : 0 })
    return accumulator
  }, [])
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-center">
      <div className="relative" style={{ width: size, height: size }} role="img" aria-label={ariaLabel}>
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--surface-3)" strokeWidth="15" />
          {data.map((entry, index) => {
            const segment = segments[index]
            return (
              <circle
                key={entry.label}
                cx="80"
                cy="80"
                r={radius}
                fill="none"
                stroke={chartColor(index)}
                strokeWidth={active === index ? 18 : 15}
                strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
                strokeDashoffset={-segment.offset}
                strokeLinecap="butt"
                className="cursor-pointer transition-[stroke-width] duration-150"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold tabular-nums">{formatCompact(active === null ? total : data[active].value, lang)}</span>
          <span className="max-w-[6.5rem] truncate text-[10px] text-subtle">
            {active === null ? centerLabel ?? '' : data[active].label}
          </span>
        </div>
      </div>
      <ul className="grid w-full max-w-[15rem] gap-1.5">
        {data.map((entry, index) => (
          <li key={entry.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-muted">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: chartColor(index) }} />
              <span className="truncate">{entry.label}</span>
            </span>
            <span className="font-semibold tabular-nums">{formatCompact(entry.value, lang)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface BarChartProps {
  data: Array<{ label: string; value: number }>
  lang?: 'en' | 'ar'
  ariaLabel: string
  emptyLabel?: string
  height?: number
  color?: string
}

export function BarChart({ data, lang = 'en', ariaLabel, emptyLabel, height = 190, color = '#35d6f2' }: BarChartProps) {
  const [active, setActive] = useState<number | null>(null)
  if (data.length === 0)
    return <ChartEmpty label={emptyLabel ?? 'No data yet'} height={height} />
  const max = Math.max(1, ...data.map((entry) => entry.value))
  return (
    <div className="relative w-full" role="img" aria-label={ariaLabel}>
      <div className="flex items-end gap-2 border-b border-line" style={{ height }}>
        {data.map((entry, index) => {
          const pct = Math.max(4, (entry.value / max) * 100)
          return (
            <div
              key={entry.label}
              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
            >
              <span className={cn('text-[10px] font-semibold tabular-nums transition-opacity', active === index ? 'opacity-100' : 'opacity-60')}>
                {formatCompact(entry.value, lang)}
              </span>
              <div
                className="w-full max-w-10 rounded-t-md transition-all duration-300"
                style={{
                  height: `${pct}%`,
                  background: `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 35%, transparent))`,
                  boxShadow: active === index ? `0 0 20px -4px ${color}` : 'none',
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-2">
        {data.map((entry) => (
          <span key={entry.label} className="min-w-0 flex-1 truncate text-center text-[9px] text-subtle" title={entry.label}>
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function Sparkline({ values, color = '#35d6f2', className }: { values: number[]; color?: string; className?: string }) {
  if (values.length === 0) return null
  const max = Math.max(1, ...values)
  const min = Math.min(...values)
  const range = Math.max(1, max - min)
  const points = values
    .map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${28 - ((value - min) / range) * 24}`)
    .join(' ')
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn('h-8 w-full', className)} aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function ChartEmpty({ label, height = 160, action }: { label: string; height?: number; action?: ReactNode }) {
  return (
    <div className="nx-empty" style={{ minHeight: height }}>
      <svg viewBox="0 0 64 32" className="h-8 w-16 text-line-strong" aria-hidden>
        <path d="M2 27 L16 17 L27 22 L40 8 L62 14" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />
      </svg>
      <p className="max-w-xs text-[11px] leading-relaxed">{label}</p>
      {action}
    </div>
  )
}
