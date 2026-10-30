import { useMemo, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Stat, Textarea } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { downloadTextFile } from '@/lib/utils'

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

interface ParsedEvent {
  id: number | null
  level: string
  source: string
  line: string
}

const LEVEL_PATTERN = /(?:level|severity|type|eventlevel)\s*[:=]\s*"?([a-z0-9]+)"?/i
const ID_PATTERN = /(?:event\s*id|eventid|event_id)\s*[:=]\s*"?(\d{1,5})"?/i
const SOURCE_PATTERN = /(?:source|provider|providersource)\s*[:=]\s*"?([^",;]+)"?/i

// Windows EventLog serialises levels as numbers: 1 critical, 2 error, 3 warning, 4 information, 5 verbose.
const LEVEL_BY_NUMBER: Record<string, string> = {
  '0': 'logalways',
  '1': 'critical',
  '2': 'error',
  '3': 'warning',
  '4': 'information',
  '5': 'verbose',
}

const ERROR_LEVELS = ['critical', 'error', 'fatal']

function levelName(value: string | number): string {
  const text = String(value).toLowerCase()
  return /^\d+$/.test(text) ? LEVEL_BY_NUMBER[text] ?? text : text
}

function isErrorLevel(level: string): boolean {
  return ERROR_LEVELS.includes(level)
}

function parseEvents(text: string): ParsedEvent[] {
  const results: ParsedEvent[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let id: number | null = null
    let level = 'unknown'
    let source = ''
    const xmlId = line.match(/<EventID[^>]*>(\d+)<\/EventID>/i)
    if (xmlId) id = Number(xmlId[1])
    if (/^\{/.test(line)) {
      try {
        const json = JSON.parse(line) as Record<string, unknown>
        const rawId = json.EventID ?? json.eventId ?? json.event_id ?? json.id
        if (typeof rawId === 'number') id = rawId
        else if (typeof rawId === 'string' && /^\d+$/.test(rawId)) id = Number(rawId)
        const rawLevel = json.Level ?? json.level ?? json.Severity ?? json.severity
        if (typeof rawLevel === 'string' || typeof rawLevel === 'number') level = levelName(rawLevel)
        const rawSource = json.Provider ?? json.provider ?? json.Source ?? json.source
        if (typeof rawSource === 'string') source = rawSource
      } catch {
        /* not JSON */
      }
    }
    const idMatch = !id ? line.match(ID_PATTERN) : null
    if (idMatch) id = Number(idMatch[1])
    const levelMatch = line.match(LEVEL_PATTERN)
    if (levelMatch && level === 'unknown') level = levelName(levelMatch[1])
    const sourceMatch = line.match(SOURCE_PATTERN)
    if (!source && sourceMatch) source = sourceMatch[1].trim()
    if (id || level !== 'unknown' || source) {
      results.push({ id, level: level.toLowerCase(), source: source || 'unknown', line: line.slice(0, 240) })
    }
  }
  return results
}

const SAMPLE = `Event ID: 7031  Level: Error  Source: Service Control Manager
Event ID: 41    Level: Critical  Source: Kernel-Power
Event ID: 6008  Level: Error  Source: EventLog
EventID=1000 Level=Error Provider=Application Error
{"EventID":4625,"Level":"Warning","Provider":"Microsoft-Windows-Security-Auditing"}
{"EventID":7031,"Level":2,"Provider":"Service Control Manager"}`

export function EventLogTool() {
  const L = useLabels()
  const [input, setInput] = useState(SAMPLE)
  const events = useMemo(() => parseEvents(input), [input])
  const byId = useMemo(() => {
    const map = new Map<number, number>()
    for (const event of events) {
      if (event.id) map.set(event.id, (map.get(event.id) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [events])
  const errors = events.filter((event) => isErrorLevel(event.level)).length

  return (
    <Card>
      <CardHeader
        title={L('Event Log Analyzer', 'محلل سجلات الأحداث')}
        icon={<ScrollText className="h-4 w-4" />}
        subtitle={L('Paste Event Viewer text, XML or JSON lines. This is a local summarizer, not a log collection agent.', 'ألصق نص عارض الأحداث أو أسطر XML أو JSON. هذا ملخّص محلي وليس وكيل جمع سجلات.')}
      />
      <div className="space-y-3 p-4">
        <Textarea value={input} onChange={(event) => setInput(event.target.value)} className="min-h-40 font-mono text-xs" dir="ltr" aria-label={L('Event log text', 'نص سجل الأحداث')} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setInput(SAMPLE)}>{L('Load sample', 'تحميل مثال')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setInput('')}>{L('Clear', 'مسح')}</Button>
          <Button size="sm" variant="secondary" disabled={events.length === 0} onClick={() => downloadTextFile('event-summary.txt', events.map((event) => `[${event.level}] ${event.id ?? '-'} ${event.source}: ${event.line}`).join('\n'), 'text/plain;charset=utf-8')}>{L('Export summary', 'تصدير الملخص')}</Button>
        </div>
        {events.length === 0 ? <EmptyState title={L('No events detected.', 'لم يتم اكتشاف أحداث.')} description={L('Recognized patterns include "Event ID: 7031", "EventID=1000", XML EventID tags and JSON lines.', 'تشمل الأنماط المدعومة "Event ID: 7031" و"EventID=1000" ووسوم XML وأسطر JSON.')} /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={L('Events parsed', 'الأحداث المحللة')} value={events.length} />
              <Stat label={L('Errors / critical', 'أخطاء / حرجة')} value={errors} tone={errors ? 'warning' : undefined} />
              <Stat label={L('Unique IDs', 'معرفات فريدة')} value={byId.length} />
            </div>
            {byId.length > 0 ? (
              <div className="rounded-lg border border-line">
                <p className="border-b border-line px-3 py-2 text-xs font-semibold">{L('Most frequent event IDs', 'معرفات الأحداث الأكثر تكرارًا')}</p>
                <ul className="divide-y divide-line">
                  {byId.map(([id, count]) => (
                    <li key={id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="font-mono">Event ID {id}</span>
                      <Badge>{count}×</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="max-h-64 overflow-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-subtle">
                  <tr>
                    <th className="p-2 text-start">ID</th>
                    <th className="p-2 text-start">{L('Level', 'المستوى')}</th>
                    <th className="p-2 text-start">{L('Source', 'المصدر')}</th>
                    <th className="p-2 text-start">{L('Line', 'السطر')}</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, 200).map((event, index) => (
                    <tr key={`${event.id}-${index}`} className="border-t border-line">
                      <td className="p-2 font-mono">{event.id ?? '—'}</td>
                      <td className="p-2"><Badge tone={isErrorLevel(event.level) ? 'danger' : event.level === 'warning' ? 'warning' : 'default'}>{event.level}</Badge></td>
                      <td className="max-w-40 truncate p-2">{event.source}</td>
                      <td className="max-w-80 truncate p-2 text-muted" dir="ltr" title={event.line}>{event.line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Alert tone="info">{L('Event IDs are context-dependent. Look up the provider and build number in vendor documentation before changing a system.', 'معرفات الأحداث تعتمد على السياق. راجع المصدر ورقم البناء في وثائق المزوّد قبل تغيير النظام.')}</Alert>
          </>
        )}
      </div>
    </Card>
  )
}
