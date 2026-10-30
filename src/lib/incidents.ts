import { csvEscape } from '@/lib/utils'

export type IncidentSeverity = 'minor' | 'major' | 'critical'
export type IncidentStatus = 'open' | 'investigating' | 'mitigated' | 'resolved'

export interface IncidentEntry {
  at: string
  note: string
  author?: string
}

export interface Incident {
  id: string
  ref: string
  title: string
  summary: string
  affectedSystem: string
  severity: IncidentSeverity
  status: IncidentStatus
  startedAt: string
  resolvedAt: string | null
  owner: string
  tags: string[]
  timeline: IncidentEntry[]
  createdAt: string
  updatedAt: string
}

export const INCIDENT_SEVERITIES: readonly IncidentSeverity[] = ['minor', 'major', 'critical']
export const INCIDENT_STATUSES: readonly IncidentStatus[] = ['open', 'investigating', 'mitigated', 'resolved']

/** localStorage key; namespaced per user via scopedStorageKey at the call site. */
export const INCIDENTS_STORAGE_KEY = 'nexora.incidents.v1'

const SEVERITY_TEXT: Record<IncidentSeverity, { en: string; ar: string }> = {
  minor: { en: 'Minor', ar: 'طفيف' },
  major: { en: 'Major', ar: 'كبير' },
  critical: { en: 'Critical', ar: 'حرج' },
}

const STATUS_TEXT: Record<IncidentStatus, { en: string; ar: string }> = {
  open: { en: 'Open', ar: 'مفتوح' },
  investigating: { en: 'Investigating', ar: 'قيد التحقيق' },
  mitigated: { en: 'Mitigated', ar: 'تمت التخفيفة' },
  resolved: { en: 'Resolved', ar: 'تم الحل' },
}

export function severityLabel(severity: IncidentSeverity, language: 'en' | 'ar'): string {
  return SEVERITY_TEXT[severity]?.[language] ?? severity
}

export function statusLabel(status: IncidentStatus, language: 'en' | 'ar'): string {
  return STATUS_TEXT[status]?.[language] ?? status
}

/** Maps a severity to a Badge tone from @/components/ui (colored severity indicator). */
export function severityTone(severity: IncidentSeverity): 'default' | 'warning' | 'danger' {
  if (severity === 'critical') return 'danger'
  if (severity === 'major') return 'warning'
  return 'default'
}

/** Maps a status to a Badge tone from @/components/ui. */
export function statusTone(status: IncidentStatus): 'primary' | 'success' | 'accent' | 'warning' {
  if (status === 'resolved') return 'success'
  if (status === 'investigating') return 'primary'
  if (status === 'mitigated') return 'accent'
  return 'warning'
}

/** Human reference INC-YYYY-NNN; sequence continues from the highest existing ref for the year. */
export function nextIncidentRef(existing: Incident[], date: Date = new Date()): string {
  const year = date.getFullYear()
  const prefix = `INC-${year}-`
  let max = 0
  for (const incident of existing) {
    if (typeof incident?.ref === 'string' && incident.ref.startsWith(prefix)) {
      const value = Number.parseInt(incident.ref.slice(prefix.length), 10)
      if (Number.isFinite(value) && value > max) max = value
    }
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

/** Minutes between start and resolution (or now for an unresolved incident). */
export function incidentDurationMinutes(incident: Incident, now: Date = new Date()): number {
  const start = Date.parse(incident.startedAt)
  if (Number.isNaN(start)) return 0
  const end = incident.resolvedAt ? Date.parse(incident.resolvedAt) : now.getTime()
  if (Number.isNaN(end)) return 0
  return Math.max(0, Math.round((end - start) / 60000))
}

/** Mean time to resolve, in minutes, over incidents that carry a resolvedAt. */
export function mttrMinutes(resolved: Incident[]): number {
  const finished = resolved.filter((incident) => Boolean(incident.resolvedAt))
  if (finished.length === 0) return 0
  const total = finished.reduce((sum, incident) => sum + incidentDurationMinutes(incident), 0)
  return Math.round(total / finished.length)
}

export interface IncidentFilters {
  status?: IncidentStatus | 'all'
  severity?: IncidentSeverity | 'all'
  query?: string
}

export function filterIncidents(incidents: Incident[], filters: IncidentFilters = {}): Incident[] {
  const { status = 'all', severity = 'all', query = '' } = filters
  const term = query.trim().toLowerCase()
  return incidents.filter((incident) => {
    if (status !== 'all' && incident.status !== status) return false
    if (severity !== 'all' && incident.severity !== severity) return false
    if (!term) return true
    const haystack = [
      incident.ref,
      incident.title,
      incident.summary,
      incident.affectedSystem,
      incident.owner,
      ...incident.tags,
      ...incident.timeline.map((entry) => entry.note),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(term)
  })
}

export type IncidentErrorKey = 'title' | 'startedAt' | 'resolvedAt' | 'severity' | 'status'

export interface IncidentInput {
  title: string
  summary?: string
  affectedSystem?: string
  severity: IncidentSeverity
  status: IncidentStatus
  startedAt: string
  resolvedAt?: string | null
  owner?: string
  tags?: string[]
}

export interface IncidentValidation {
  valid: boolean
  errors: IncidentErrorKey[]
}

/** Pure validation used by the form. Returns the list of violated fields. */
export function validateIncident(input: IncidentInput, now: Date = new Date()): IncidentValidation {
  const errors: IncidentErrorKey[] = []
  const push = (key: IncidentErrorKey) => {
    if (!errors.includes(key)) errors.push(key)
  }

  if (!input.title || input.title.trim() === '') push('title')

  const startedMs = Date.parse(input.startedAt)
  if (!input.startedAt || Number.isNaN(startedMs)) {
    push('startedAt')
  } else if (startedMs > now.getTime()) {
    push('startedAt')
  }

  if (input.resolvedAt) {
    const resolvedMs = Date.parse(input.resolvedAt)
    if (Number.isNaN(resolvedMs)) {
      push('resolvedAt')
    } else if (!Number.isNaN(startedMs) && resolvedMs < startedMs) {
      push('resolvedAt')
    }
  }

  if (!INCIDENT_SEVERITIES.includes(input.severity)) push('severity')
  if (!INCIDENT_STATUSES.includes(input.status)) push('status')

  return { valid: errors.length === 0, errors }
}

const REPORT_LABELS = {
  en: {
    org: 'Adnan Tech',
    docTitle: 'Incident Report',
    reference: 'Reference',
    severity: 'Severity',
    status: 'Status',
    affected: 'Affected system',
    owner: 'Owner',
    started: 'Started',
    resolved: 'Resolved',
    unresolved: 'Still open',
    duration: 'Duration (minutes)',
    tags: 'Tags',
    summary: 'Summary',
    timeline: 'Timeline',
    noTimeline: 'No timeline entries recorded.',
    generated: 'Generated',
  },
  ar: {
    org: 'منصة عدنان تك',
    docTitle: 'تقرير حادثة',
    reference: 'المرجع',
    severity: 'الخطورة',
    status: 'الحالة',
    affected: 'النظام المتأثر',
    owner: 'المسؤول',
    started: 'وقت البدء',
    resolved: 'وقت الحل',
    unresolved: 'لم تُحل بعد',
    duration: 'المدة (بالدقائق)',
    tags: 'الوسوم',
    summary: 'الملخص',
    timeline: 'الخط الزمني',
    noTimeline: 'لا توجد أحداث مسجلة في الخط الزمني.',
    generated: 'تاريخ الإنشاء',
  },
} as const

const dash = (value: string | null | undefined): string => {
  const text = (value ?? '').toString().trim()
  return text || '—'
}

/** Builds a Markdown report for a single incident in the requested language. */
export function buildIncidentMarkdown(incident: Incident, language: 'en' | 'ar'): string {
  const l = language === 'ar' ? REPORT_LABELS.ar : REPORT_LABELS.en
  const lines: string[] = [
    `# ${l.org} — ${l.docTitle}`,
    '',
    `- ${l.reference}: ${incident.ref}`,
    `- ${l.severity}: ${severityLabel(incident.severity, language)}`,
    `- ${l.status}: ${statusLabel(incident.status, language)}`,
    `- ${l.affected}: ${dash(incident.affectedSystem)}`,
    `- ${l.owner}: ${dash(incident.owner)}`,
    `- ${l.started}: ${incident.startedAt}`,
    `- ${l.resolved}: ${incident.resolvedAt ?? l.unresolved}`,
    `- ${l.duration}: ${incidentDurationMinutes(incident)}`,
    `- ${l.tags}: ${incident.tags.length ? incident.tags.join(', ') : '—'}`,
    '',
    `## ${l.summary}`,
    dash(incident.summary),
    '',
    `## ${l.timeline}`,
  ]

  if (incident.timeline.length === 0) {
    lines.push(l.noTimeline)
  } else {
    for (const entry of incident.timeline) {
      const author = entry.author?.trim() ? ` — ${entry.author.trim()}` : ''
      lines.push(`- ${entry.at}: ${entry.note}${author}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

const CSV_HEADER = [
  'ref',
  'title',
  'severity',
  'status',
  'affectedSystem',
  'owner',
  'startedAt',
  'resolvedAt',
  'durationMinutes',
  'tags',
  'summary',
]

/** Builds a CSV export for the given incidents (RFC-4180 quoting via csvEscape). */
export function buildIncidentsCsv(incidents: Incident[]): string {
  const rows = incidents.map((incident) =>
    [
      incident.ref,
      incident.title,
      incident.severity,
      incident.status,
      incident.affectedSystem,
      incident.owner,
      incident.startedAt,
      incident.resolvedAt ?? '',
      String(incidentDurationMinutes(incident)),
      incident.tags.join(';'),
      incident.summary,
    ]
      .map((cell) => csvEscape(cell))
      .join(','),
  )
  return [CSV_HEADER.join(','), ...rows].join('\n')
}

/** Filename helper mirroring @/lib/report's slug style. */
export function incidentFilename(incident: Incident, extension: 'md' | 'csv' = 'md'): string {
  const slug = incident.ref.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return `adnan-tech-${slug || 'incident'}.${extension}`
}
