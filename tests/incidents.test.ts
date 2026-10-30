import { describe, expect, it } from 'vitest'
import {
  buildIncidentMarkdown,
  filterIncidents,
  incidentDurationMinutes,
  mttrMinutes,
  nextIncidentRef,
  validateIncident,
  type Incident,
} from '../src/lib/incidents'

const NOW = new Date('2026-05-01T12:00:00.000Z')

const base: Incident = {
  id: 'inc-1',
  ref: 'INC-2026-001',
  title: 'Core switch down',
  summary: 'Distribution switch lost power.',
  affectedSystem: 'DC-1 core',
  severity: 'critical',
  status: 'resolved',
  startedAt: '2026-05-01T10:00:00.000Z',
  resolvedAt: '2026-05-01T10:45:00.000Z',
  owner: 'Adnan',
  tags: ['network', 'dc1'],
  timeline: [{ at: '2026-05-01T10:05:00.000Z', note: 'Rack PDU tripped', author: 'Adnan' }],
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:45:00.000Z',
}

const openIncident: Incident = {
  ...base,
  id: 'inc-2',
  ref: 'INC-2026-002',
  title: 'Backup job failed',
  summary: 'Nightly backup aborted.',
  affectedSystem: 'Veeam server',
  severity: 'major',
  status: 'open',
  startedAt: '2026-05-01T11:30:00.000Z',
  resolvedAt: null,
  tags: ['backup'],
  timeline: [],
}

describe('nextIncidentRef', () => {
  it('starts at 001 when there are no incidents for the year', () => {
    expect(nextIncidentRef([], new Date('2026-01-15T00:00:00.000Z'))).toBe('INC-2026-001')
  })

  it('continues from the highest existing sequence, ignoring other years', () => {
    const lastYear: Incident = { ...base, ref: 'INC-2025-009' }
    expect(nextIncidentRef([base, openIncident, lastYear], NOW)).toBe('INC-2026-003')
  })

  it('tolerates malformed refs and pads past 999', () => {
    const high: Incident = { ...base, ref: 'INC-2026-999' }
    expect(nextIncidentRef([{ ...base, ref: 'garbage' }, high], NOW)).toBe('INC-2026-1000')
  })
})

describe('incident duration and MTTR', () => {
  it('uses resolvedAt for closed incidents and now for open ones', () => {
    expect(incidentDurationMinutes(base, NOW)).toBe(45)
    expect(incidentDurationMinutes(openIncident, NOW)).toBe(30)
  })

  it('averages minutes only over incidents that were resolved', () => {
    expect(mttrMinutes([base])).toBe(45)
    expect(mttrMinutes([openIncident])).toBe(0)
    expect(mttrMinutes([base, { ...base, id: 'x', resolvedAt: '2026-05-01T11:00:00.000Z' }])).toBe(53)
  })
})

describe('filterIncidents', () => {
  const all = [base, openIncident]

  it('returns everything when no filter is supplied', () => {
    expect(filterIncidents(all, {})).toHaveLength(2)
  })

  it('filters by status and severity', () => {
    expect(filterIncidents(all, { status: 'open' }).map((item) => item.id)).toEqual(['inc-2'])
    expect(filterIncidents(all, { severity: 'critical' }).map((item) => item.id)).toEqual(['inc-1'])
    expect(filterIncidents(all, { status: 'open', severity: 'critical' })).toHaveLength(0)
  })

  it('matches free text across fields and timeline notes', () => {
    expect(filterIncidents(all, { query: 'veeam' })).toHaveLength(1)
    expect(filterIncidents(all, { query: 'INC-2026-001' })).toHaveLength(1)
    expect(filterIncidents(all, { query: 'pdu tripped' }).map((item) => item.id)).toEqual(['inc-1'])
    expect(filterIncidents(all, { query: 'nothing here' })).toHaveLength(0)
  })
})

describe('buildIncidentMarkdown', () => {
  it('renders English labels, metadata, summary and timeline', () => {
    const markdown = buildIncidentMarkdown(base, 'en')
    expect(markdown).toContain('# Adnan Tech — Incident Report')
    expect(markdown).toContain('- Reference: INC-2026-001')
    expect(markdown).toContain('- Severity: Critical')
    expect(markdown).toContain('- Status: Resolved')
    expect(markdown).toContain('## Summary')
    expect(markdown).toContain('Distribution switch lost power.')
    expect(markdown).toContain('## Timeline')
    expect(markdown).toContain('- 2026-05-01T10:05:00.000Z: Rack PDU tripped — Adnan')
    expect(markdown).not.toContain('## \n')
  })

  it('renders Arabic labels and an empty-timeline placeholder', () => {
    const markdown = buildIncidentMarkdown(base, 'ar')
    expect(markdown).toContain('# منصة عدنان تك — تقرير حادثة')
    expect(markdown).toContain('المرجع: INC-2026-001')
    expect(markdown).toContain('- الخطورة: حرج')
    expect(markdown).toContain('- الحالة: تم الحل')
    expect(markdown).toContain('## الملخص')
    expect(markdown).toContain('## الخط الزمني')

    const empty = buildIncidentMarkdown(openIncident, 'ar')
    expect(empty).toContain('لا توجد أحداث مسجلة في الخط الزمني.')
  })

  it('marks an unresolved incident as still open', () => {
    expect(buildIncidentMarkdown(openIncident, 'en')).toContain('- Resolved: Still open')
    expect(buildIncidentMarkdown(openIncident, 'ar')).toContain('- وقت الحل: لم تُحل بعد')
  })
})

describe('validateIncident', () => {
  const validInput = {
    title: 'UPS failure',
    severity: 'major' as const,
    status: 'open' as const,
    startedAt: '2026-05-01T10:00:00.000Z',
    resolvedAt: null,
  }

  it('accepts a well-formed incident', () => {
    expect(validateIncident(validInput, NOW)).toEqual({ valid: true, errors: [] })
    expect(validateIncident({ ...validInput, resolvedAt: '2026-05-01T10:30:00.000Z' }, NOW).valid).toBe(true)
  })

  it('requires a non-blank title', () => {
    expect(validateIncident({ ...validInput, title: '   ' }, NOW).errors).toContain('title')
  })

  it('rejects a missing, unparseable or future start time', () => {
    expect(validateIncident({ ...validInput, startedAt: '' }, NOW).errors).toContain('startedAt')
    expect(validateIncident({ ...validInput, startedAt: 'not-a-date' }, NOW).errors).toContain('startedAt')
    expect(validateIncident({ ...validInput, startedAt: '2026-05-01T12:01:00.000Z' }, NOW).errors).toContain('startedAt')
  })

  it('rejects a resolvedAt earlier than startedAt', () => {
    const result = validateIncident({ ...validInput, resolvedAt: '2026-05-01T09:00:00.000Z' }, NOW)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('resolvedAt')
    expect(result.errors).not.toContain('startedAt')
  })

  it('accepts a resolution equal to the start time', () => {
    expect(validateIncident({ ...validInput, resolvedAt: validInput.startedAt }, NOW).valid).toBe(true)
  })

  it('rejects severity and status outside the fixed option lists', () => {
    const rogue = validInput as unknown as Record<string, unknown>
    expect(validateIncident({ ...rogue, severity: 'catastrophic' } as never, NOW).errors).toContain('severity')
    expect(validateIncident({ ...rogue, status: 'closed-forever' } as never, NOW).errors).toContain('status')
  })
})
