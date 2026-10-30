import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, ListPlus, Pencil, Plus, Search, Siren, Table, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Stat,
  Textarea,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { formatDateTime } from '@/i18n'
import { readJson, scopedStorageKey, writeJson } from '@/lib/storage'
import { downloadTextFile, truncate, uid } from '@/lib/utils'
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENTS_STORAGE_KEY,
  buildIncidentMarkdown,
  buildIncidentsCsv,
  filterIncidents,
  incidentDurationMinutes,
  incidentFilename,
  mttrMinutes,
  nextIncidentRef,
  severityLabel,
  severityTone,
  statusLabel,
  statusTone,
  validateIncident,
  type Incident,
  type IncidentEntry,
  type IncidentErrorKey,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/lib/incidents'

interface FormState {
  id: string | null
  title: string
  summary: string
  affectedSystem: string
  severity: IncidentSeverity
  status: IncidentStatus
  startedAt: string
  resolvedAt: string
  owner: string
  tags: string
  timeline: IncidentEntry[]
  createdAt: string
}

const EMPTY_FORM: FormState = {
  id: null,
  title: '',
  summary: '',
  affectedSystem: '',
  severity: 'major',
  status: 'open',
  startedAt: '',
  resolvedAt: '',
  owner: '',
  tags: '',
  timeline: [],
  createdAt: '',
}

const pad = (value: number): string => String(value).padStart(2, '0')

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const parseTags = (value: string): string[] =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

export function IncidentsPage() {
  const { settings } = useApp()
  const { notify } = useToast()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)

  const storageKey = useMemo(() => scopedStorageKey(INCIDENTS_STORAGE_KEY), [])
  const [incidents, setIncidents] = useState<Incident[]>(() => readJson<Incident[]>(storageKey, []))

  const [statusFilter, setStatusFilter] = useState<IncidentStatus | 'all'>('all')
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | 'all'>('all')
  const [query, setQuery] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<IncidentErrorKey[]>([])
  const [noteDraft, setNoteDraft] = useState('')

  useEffect(() => {
    writeJson(storageKey, incidents)
  }, [storageKey, incidents])

  const sorted = useMemo(
    () => [...incidents].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [incidents],
  )

  const filtered = useMemo(
    () => filterIncidents(sorted, { status: statusFilter, severity: severityFilter, query }),
    [sorted, statusFilter, severityFilter, query],
  )

  const stats = useMemo(() => {
    const open = filtered.filter((item) => item.status === 'open').length
    const investigating = filtered.filter((item) => item.status === 'investigating').length
    const resolved = filtered.filter((item) => item.status === 'resolved').length
    return { open, investigating, resolved, mttr: mttrMinutes(filtered) }
  }, [filtered])

  const errorText = (key: IncidentErrorKey): string | undefined => {
    if (!errors.includes(key)) return undefined
    if (key === 'title') return L('Title is required', 'العنوان مطلوب')
    if (key === 'startedAt') return L('Start time is required and cannot be in the future', 'وقت البدء مطلوب ويجب ألا يكون في المستقبل')
    if (key === 'resolvedAt') return L('Resolution time cannot be earlier than the start time', 'وقت الحل لا يمكن أن يسبق وقت البدء')
    if (key === 'severity') return L('Choose a valid severity', 'اختر مستوى خطورة صالحًا')
    return L('Choose a valid status', 'اختر حالة صالحة')
  }

  const openNew = () => {
    const now = new Date()
    setForm({ ...EMPTY_FORM, startedAt: toLocalInput(now.toISOString()) })
    setErrors([])
    setNoteDraft('')
    setFormOpen(true)
  }

  const openEdit = (incident: Incident) => {
    setForm({
      id: incident.id,
      title: incident.title,
      summary: incident.summary,
      affectedSystem: incident.affectedSystem,
      severity: incident.severity,
      status: incident.status,
      startedAt: toLocalInput(incident.startedAt),
      resolvedAt: toLocalInput(incident.resolvedAt),
      owner: incident.owner,
      tags: incident.tags.join(', '),
      timeline: [...incident.timeline],
      createdAt: incident.createdAt,
    })
    setErrors([])
    setNoteDraft('')
    setFormOpen(true)
  }

  const submit = () => {
    const startedIso = fromLocalInput(form.startedAt) ?? form.startedAt
    const resolvedIso = fromLocalInput(form.resolvedAt)
    const validation = validateIncident(
      {
        title: form.title,
        summary: form.summary,
        affectedSystem: form.affectedSystem,
        severity: form.severity,
        status: form.status,
        startedAt: startedIso,
        resolvedAt: resolvedIso,
        owner: form.owner,
        tags: parseTags(form.tags),
      },
      new Date(),
    )

    if (!validation.valid) {
      setErrors(validation.errors)
      notify('error', L('Please fix the highlighted fields', 'يرجى تصحيح الحقول المحددة'))
      return
    }

    const nowIso = new Date().toISOString()
    const existing = incidents.find((item) => item.id === form.id)
    const timeline = form.timeline

    const record: Incident = {
      id: existing ? existing.id : uid('incident'),
      ref: existing ? existing.ref : nextIncidentRef(incidents, new Date()),
      title: form.title.trim(),
      summary: form.summary.trim(),
      affectedSystem: form.affectedSystem.trim(),
      severity: form.severity,
      status: form.status,
      startedAt: startedIso,
      resolvedAt: resolvedIso,
      owner: form.owner.trim(),
      tags: parseTags(form.tags),
      timeline,
      createdAt: existing ? existing.createdAt : nowIso,
      updatedAt: nowIso,
    }

    setIncidents((current) => {
      const without = current.filter((item) => item.id !== record.id)
      return [record, ...without]
    })
    notify('success', existing ? L('Incident updated', 'تم تحديث الحادثة') : L('Incident created', 'تم إنشاء الحادثة'))
    setFormOpen(false)
  }

  const removeIncident = (incident: Incident) => {
    if (!window.confirm(L(`Delete ${incident.ref}? This cannot be undone.`, `هل تريد حذف ${incident.ref}؟ لا يمكن التراجع.`))) return
    setIncidents((current) => current.filter((item) => item.id !== incident.id))
    notify('success', L('Incident deleted', 'تم حذف الحادثة'))
  }

  const appendNote = () => {
    const note = noteDraft.trim()
    if (!note) {
      notify('error', L('Write a note before adding it', 'اكتب ملاحظة قبل إضافتها'))
      return
    }
    setForm((current) => ({
      ...current,
      timeline: [...current.timeline, { at: new Date().toISOString(), note }],
    }))
    setNoteDraft('')
  }

  const exportMarkdown = (incident: Incident) => {
    downloadTextFile(
      incidentFilename(incident, 'md'),
      buildIncidentMarkdown(incident, settings.language),
      'text/markdown;charset=utf-8',
    )
    notify('success', L('Markdown report downloaded', 'تم تنزيل تقرير Markdown'))
  }

  const exportCsv = () => {
    if (filtered.length === 0) {
      notify('error', L('No incidents to export', 'لا توجد حوادث للتصدير'))
      return
    }
    downloadTextFile(
      `adnan-tech-incidents-${new Date().toISOString().slice(0, 10)}.csv`,
      buildIncidentsCsv(filtered),
      'text/csv;charset=utf-8',
    )
    notify('success', L('CSV downloaded', 'تم تنزيل ملف CSV'))
  }

  return (
    <div className="animate-in space-y-4">
      <PageHeader
        title={L('Incident log', 'سجل الحوادث')}
        subtitle={L(
          'Local-first report center for outages, security events, hardware failures and backup incidents. Stored only in this browser.',
          'مركز تقارير محلي لتتبع الانقطاعات وأحداث الأمن وأعطال الأجهزة وفشل النسخ الاحتياطي. يُخزَّن في هذا المتصفح فقط.',
        )}
        badge={<Badge tone="primary">{L(`${incidents.length} logged`, `${incidents.length} مسجّل`)}</Badge>}
        actions={
          <>
            <Button size="sm" variant="secondary" icon={<Table className="h-4 w-4" />} onClick={exportCsv}>
              {L('Download CSV', 'تنزيل CSV')}
            </Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openNew}>
              {L('New incident', 'حادثة جديدة')}
            </Button>
          </>
        }
      />

      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={L('Open', 'مفتوحة')} value={stats.open} tone="warning" />
        <Stat label={L('Investigating', 'قيد التحقيق')} value={stats.investigating} tone="primary" />
        <Stat label={L('Resolved', 'تم الحل')} value={stats.resolved} tone="success" />
        <Stat
          label={L('MTTR (filtered)', 'متوسط زمن الحل (حسب التصفية)')}
          value={`${stats.mttr} ${L('min', 'د')}}`}
          hint={L('Over resolved incidents in view', 'لحوادث محلوعة ضمن العرض الحالي')}
        />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={L('Search title, system, owner or note…', 'ابحث بالعنوان أو النظام أو المسؤول أو الملاحظة…')}
              className="ps-8"
            />
          </div>
          <Field label={L('Status', 'الحالة')} htmlFor="incident-status-filter">
            <Select id="incident-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as IncidentStatus | 'all')}>
              <option value="all">{L('All statuses', 'كل الحالات')}</option>
              {INCIDENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status, settings.language)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={L('Severity', 'الخطورة')} htmlFor="incident-severity-filter">
            <Select id="incident-severity-filter" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as IncidentSeverity | 'all')}>
              <option value="all">{L('All severities', 'كل المستويات')}</option>
              {INCIDENT_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severityLabel(severity, settings.language)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {incidents.length === 0 ? (
        <EmptyState
          icon={<Siren className="h-8 w-8" />}
          title={L('No incidents logged yet', 'لم تُسجَّل أي حوادث بعد')}
          description={L(
            'Create your first incident to start tracking outages and their timeline.',
            'أنشئ أول حادثة لبدء تتبع الانقطاعات وخطها الزمني.',
          )}
          action={
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openNew}>
              {L('New incident', 'حادثة جديدة')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title={L('No incidents match these filters', 'لا توجد حوادث مطابقة لهذه التصفية')}
          description={L(
            'Adjust the status, severity or search term to see results.',
            'عدّل الحالة أو الخطورة أو كلمة البحث لعرض النتائج.',
          )}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setStatusFilter('all')
                setSeverityFilter('all')
                setQuery('')
              }}
            >
              {L('Clear filters', 'إلغاء التصفية')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((incident) => (
            <Card key={incident.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded border border-line bg-[var(--code-bg)] px-1.5 py-0.5 font-mono text-[10px]" dir="ltr">
                    {incident.ref}
                  </span>
                  <Badge tone={severityTone(incident.severity)}>{severityLabel(incident.severity, settings.language)}</Badge>
                  <Badge tone={statusTone(incident.status)}>{statusLabel(incident.status, settings.language)}</Badge>
                  <span className="text-[10px] text-subtle" dir="ltr">
                    {L('Updated', 'آخر تحديث')} {formatDateTime(incident.updatedAt, settings.language)}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium">{incident.title}</p>
                <p className="line-clamp-1 text-xs text-muted">{truncate(incident.summary || L('No summary', 'لا يوجد ملخص'), 180)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
                  {incident.affectedSystem ? (
                    <span>
                      {L('System', 'النظام')}: <span className="text-muted">{incident.affectedSystem}</span>
                    </span>
                  ) : null}
                  {incident.owner ? (
                    <span>
                      {L('Owner', 'المسؤول')}: <span className="text-muted">{incident.owner}</span>
                    </span>
                  ) : null}
                  <span>
                    {incident.resolvedAt ? L('Total', 'الإجمالي') : L('Elapsed', 'المنقضي')}:{' '}
                    <span className="font-mono text-muted" dir="ltr">
                      {incidentDurationMinutes(incident)} {L('min', 'د')}
                    </span>
                  </span>
                  {incident.timeline.length > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <ListPlus className="h-3 w-3" />
                      {L(`${incident.timeline.length} updates`, `${incident.timeline.length} تحديث`)}
                    </span>
                  ) : null}
                  {incident.tags.map((tag) => (
                    <span key={tag} className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportMarkdown(incident)} aria-label={L('Download Markdown report', 'تنزيل تقرير Markdown')} />
                <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(incident)} aria-label={L('Edit', 'تعديل')} />
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeIncident(incident)} aria-label={L('Delete', 'حذف')} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? L('Edit incident', 'تعديل الحادثة') : L('New incident', 'حادثة جديدة')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
              {L('Cancel', 'إلغاء')}
            </Button>
            <Button size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={submit}>
              {L('Save incident', 'حفظ الحادثة')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={L('Title', 'العنوان')} htmlFor="incident-title" required error={errorText('title')}>
            <Input
              id="incident-title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder={L('Core switch loses power in DC-1', 'انقطاع الطاقة عن المبدّل الرئيسي في مركز البيانات')}
            />
          </Field>

          <Field label={L('Summary', 'الملخص')} htmlFor="incident-summary" hint={L('What happened and current state', 'ما حدث والحالة الحالية')}>
            <Textarea id="incident-summary" value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={L('Affected system', 'النظام المتأثر')} htmlFor="incident-system">
              <Input id="incident-system" value={form.affectedSystem} onChange={(event) => setForm({ ...form, affectedSystem: event.target.value })} />
            </Field>
            <Field label={L('Owner', 'المسؤول')} htmlFor="incident-owner">
              <Input id="incident-owner" value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={L('Severity', 'الخطورة')} htmlFor="incident-severity" required error={errorText('severity')}>
              <Select id="incident-severity" value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value as IncidentSeverity })}>
                {INCIDENT_SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {severityLabel(severity, settings.language)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={L('Status', 'الحالة')} htmlFor="incident-status" required error={errorText('status')}>
              <Select id="incident-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as IncidentStatus })}>
                {INCIDENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status, settings.language)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={L('Started at', 'وقت البدء')} htmlFor="incident-start" required error={errorText('startedAt')}>
              <Input id="incident-start" type="datetime-local" dir="ltr" value={form.startedAt} onChange={(event) => setForm({ ...form, startedAt: event.target.value })} />
            </Field>
            <Field label={L('Resolved at (optional)', 'وقت الحل (اختياري)')} htmlFor="incident-resolved" error={errorText('resolvedAt')}>
              <Input id="incident-resolved" type="datetime-local" dir="ltr" value={form.resolvedAt} onChange={(event) => setForm({ ...form, resolvedAt: event.target.value })} />
            </Field>
          </div>

          <Field label={L('Tags', 'الوسوم')} htmlFor="incident-tags" hint={L('Comma separated', 'مفصولة بفواصل')}>
            <Input id="incident-tags" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} dir="ltr" placeholder="network, dc1, backup" />
          </Field>

          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{L('Timeline', 'الخط الزمني')}</h3>
              <span className="text-[10px] text-subtle">{L('Newest last', 'الأحدث في الأسفل')}</span>
            </div>

            {form.timeline.length === 0 ? (
              <p className="mb-2 text-xs text-subtle">{L('No timeline entries yet.', 'لا توجد أحداث بعد.')}</p>
            ) : (
              <ol className="mb-2 space-y-1.5">
                {form.timeline.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
                    <div className="text-[10px] text-subtle" dir="ltr">
                      {formatDateTime(entry.at, settings.language)}
                      {entry.author ? ` · ${entry.author}` : ''}
                    </div>
                    <p className="text-xs text-muted">{entry.note}</p>
                  </li>
                ))}
              </ol>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Field label={L('Add note', 'إضافة ملاحظة')} htmlFor="incident-note">
                  <Input
                    id="incident-note"
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder={L('Failed over to the standby unit', 'تم التحويل إلى الوحدة الاحتياطية')}
                  />
                </Field>
              </div>
              <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={appendNote}>
                {L('Append', 'إضافة')}
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] text-subtle">
              {form.id
                ? L('Notes are saved when you save the incident.', 'تُحفظ الملاحظات عند حفظ الحادثة.')
                : L('Create the incident to keep these notes.', 'أنشئ الحادثة للاحتفاظ بهذه الملاحظات.')}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default IncidentsPage
