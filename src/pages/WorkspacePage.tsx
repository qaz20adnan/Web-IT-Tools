import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { FileText, FolderLock, MessageSquare, NotebookPen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { workspaceRequest } from '@/services/api'
import { describeError } from '@/services/apiError'
import { cn } from '@/lib/utils'

type Tab = 'overview' | 'cases' | 'notes' | 'conversations'

interface CaseRow {
  id: string
  title: string
  category: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'investigating' | 'resolved' | 'closed'
  environment: string
  symptoms: string
  logs: string
  causes: string
  tests: string
  fixes: string
  resolution: string
  lessons: string
  updated_at?: string
}

interface NoteRow {
  id: string
  title: string
  body: string
  tags: string[]
  updated_at?: string
}

interface ConversationRow {
  id: string
  title: string
  provider: string
  model: string
  updated_at?: string
}

interface OverviewResponse {
  ok: true
  plan: string
  usageToday: number
  dailyAiLimit: number
  recentCases: CaseRow[]
  recentNotes: NoteRow[]
  recentConversations: ConversationRow[]
}

const EMPTY_CASE: Omit<CaseRow, 'id'> = {
  title: '',
  category: 'other',
  priority: 'medium',
  status: 'open',
  environment: '',
  symptoms: '',
  logs: '',
  causes: '',
  tests: '',
  fixes: '',
  resolution: '',
  lessons: '',
}

const PRIORITIES: CaseRow['priority'][] = ['low', 'medium', 'high', 'critical']
const STATUSES: CaseRow['status'][] = ['open', 'investigating', 'resolved', 'closed']

export function WorkspacePage() {
  const { t, settings } = useApp()
  const { account } = useAuth()
  const { notify } = useToast()
  const [tab, setTab] = useState<Tab>('overview')
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [cases, setCases] = useState<CaseRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [caseOpen, setCaseOpen] = useState(false)
  const [caseDraft, setCaseDraft] = useState<Omit<CaseRow, 'id'> & { id?: string }>(EMPTY_CASE)
  const [caseBusy, setCaseBusy] = useState(false)
  const [caseError, setCaseError] = useState<string | null>(null)

  const [noteDraft, setNoteDraft] = useState<{ id?: string; title: string; body: string; tags: string }>({ title: '', body: '', tags: '' })
  const [noteBusy, setNoteBusy] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    const response = await workspaceRequest<OverviewResponse>({ action: 'overview' })
    setOverview(response)
  }, [])

  const loadTab = useCallback(async (next: Tab) => {
    if (next === 'cases') {
      const response = await workspaceRequest<{ ok: true; items: CaseRow[] }>({ action: 'case.list' })
      setCases(response.items)
    } else if (next === 'notes') {
      const response = await workspaceRequest<{ ok: true; items: NoteRow[] }>({ action: 'note.list' })
      setNotes(response.items)
    } else if (next === 'conversations') {
      const response = await workspaceRequest<{ ok: true; items: ConversationRow[] }>({ action: 'conversation.list' })
      setConversations(response.items)
    }
  }, [])

  const refresh = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      await loadOverview()
      await loadTab(tab)
    } catch (caught) {
      setError(describeError(caught, settings.language, t('auth.genericError')))
    } finally {
      setLoading(false)
    }
  }, [loadOverview, loadTab, tab, t, settings.language])

  useEffect(() => {
    void refresh()
    // Reload only when the selected tab changes; refresh itself is stable per tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const openNewCase = () => {
    setCaseDraft({ ...EMPTY_CASE })
    setCaseError(null)
    setCaseOpen(true)
  }

  const openEditCase = (item: CaseRow) => {
    setCaseDraft({ ...item })
    setCaseError(null)
    setCaseOpen(true)
  }

  const saveCase = async (event: FormEvent) => {
    event.preventDefault()
    setCaseError(null)
    if (caseDraft.title.trim().length < 3) {
      setCaseError(t('auth.requiredFields'))
      return
    }
    setCaseBusy(true)
    try {
      await workspaceRequest({ action: 'case.save', item: { ...caseDraft, title: caseDraft.title.trim() } })
      setCaseOpen(false)
      notify('success', t('workspace.saved'))
      await loadOverview()
      await loadTab('cases')
    } catch (caught) {
      setCaseError(describeError(caught, settings.language, t('auth.genericError')))
    } finally {
      setCaseBusy(false)
    }
  }

  const deleteCase = async (id: string) => {
    if (!window.confirm(t('workspace.confirmDelete'))) return
    try {
      await workspaceRequest({ action: 'case.delete', id })
      notify('success', t('workspace.deleted'))
      await refresh()
    } catch (caught) {
      setError(describeError(caught, settings.language, t('auth.genericError')))
    }
  }

  const saveNote = async (event: FormEvent) => {
    event.preventDefault()
    setNoteError(null)
    if (!noteDraft.title.trim()) {
      setNoteError(t('auth.requiredFields'))
      return
    }
    setNoteBusy(true)
    try {
      await workspaceRequest({
        action: 'note.save',
        item: {
          id: noteDraft.id,
          title: noteDraft.title.trim(),
          body: noteDraft.body,
          tags: noteDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
        },
      })
      setNoteDraft({ title: '', body: '', tags: '' })
      notify('success', t('workspace.saved'))
      await loadOverview()
      await loadTab('notes')
    } catch (caught) {
      setNoteError(describeError(caught, settings.language, t('auth.genericError')))
    } finally {
      setNoteBusy(false)
    }
  }

  const deleteNote = async (id: string) => {
    if (!window.confirm(t('workspace.confirmDelete'))) return
    try {
      await workspaceRequest({ action: 'note.delete', id })
      notify('success', t('workspace.deleted'))
      await refresh()
    } catch (caught) {
      setError(describeError(caught, settings.language, t('auth.genericError')))
    }
  }

  const deleteConversation = async (id: string) => {
    if (!window.confirm(t('workspace.confirmDelete'))) return
    try {
      await workspaceRequest({ action: 'conversation.delete', id })
      notify('success', t('workspace.deleted'))
      await refresh()
    } catch (caught) {
      setError(describeError(caught, settings.language, t('auth.genericError')))
    }
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof FolderLock }> = [
    { id: 'overview', label: t('workspace.overview'), icon: FolderLock },
    { id: 'cases', label: t('workspace.cases'), icon: FileText },
    { id: 'notes', label: t('workspace.notes'), icon: NotebookPen },
    { id: 'conversations', label: t('workspace.conversations'), icon: MessageSquare },
  ]

  return (
    <div className="animate-in">
      <PageHeader
        title={t('workspace.title')}
        subtitle={t('workspace.subtitle')}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />} onClick={() => void refresh()}>
              {t('common.retry')}
            </Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openNewCase}>
              {t('workspace.newCase')}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label={t('workspace.title')}>
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
              tab === entry.id ? 'border-primary bg-primary/10 text-primary' : 'border-line text-muted hover:border-line-strong hover:text-text',
            )}
          >
            <entry.icon className="h-3.5 w-3.5" />
            {entry.label}
          </button>
        ))}
      </div>

      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      {!account?.entitlements?.features.workspace ? <Alert tone="warning" className="mb-4">{t('workspace.noWorkspace')}</Alert> : null}

      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-3">
            <CardBody className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-subtle">{t('auth.plan')}</p>
                <p className="mt-1 text-lg font-bold capitalize">{overview?.plan ?? account?.entitlements?.plan ?? '—'}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-subtle">{t('workspace.aiUsage')}</p>
                <p className="mt-1 text-lg font-bold">
                  {overview?.usageToday ?? account?.usageToday ?? 0} / {overview?.dailyAiLimit ?? account?.entitlements?.dailyAiLimit ?? 0}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-subtle">{t('auth.workspaceLimit')}</p>
                <p className="mt-1 text-lg font-bold">{account?.entitlements?.workspaceItemLimit ?? 0}</p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('workspace.recentCases')} icon={<FileText className="h-4 w-4" />} />
            <CardBody className="space-y-2">
              {overview?.recentCases.length ? (
                overview.recentCases.map((item) => (
                  <button key={item.id} type="button" onClick={() => openEditCase(item)} className="block w-full rounded-lg border border-line p-2.5 text-start hover:bg-surface-2">
                    <p className="truncate text-xs font-semibold">{item.title}</p>
                    <p className="mt-1 text-[11px] text-subtle">{item.status} · {item.priority}</p>
                  </button>
                ))
              ) : (
                <p className="text-xs text-subtle">{t('workspace.emptyCases')}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('workspace.recentNotes')} icon={<NotebookPen className="h-4 w-4" />} />
            <CardBody className="space-y-2">
              {overview?.recentNotes.length ? (
                overview.recentNotes.map((item) => (
                  <div key={item.id} className="rounded-lg border border-line p-2.5">
                    <p className="truncate text-xs font-semibold">{item.title}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] text-subtle">{item.body}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-subtle">{t('workspace.emptyNotes')}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('workspace.recentConversations')} icon={<MessageSquare className="h-4 w-4" />} />
            <CardBody className="space-y-2">
              {overview?.recentConversations.length ? (
                overview.recentConversations.map((item) => (
                  <div key={item.id} className="rounded-lg border border-line p-2.5">
                    <p className="truncate text-xs font-semibold">{item.title}</p>
                    <p className="mt-1 text-[11px] text-subtle">{item.provider} {item.model}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-subtle">{t('workspace.emptyConversations')}</p>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'cases' ? (
        <Card>
          <CardHeader title={t('workspace.cases')} actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openNewCase}>{t('workspace.newCase')}</Button>} />
          <CardBody className="space-y-2">
            {cases.length === 0 ? <p className="text-xs text-subtle">{t('workspace.emptyCases')}</p> : null}
            {cases.map((item) => (
              <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line p-3">
                <button type="button" onClick={() => openEditCase(item)} className="min-w-0 flex-1 text-start">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">{item.title}</p>
                    <Badge tone={item.priority === 'critical' || item.priority === 'high' ? 'danger' : item.priority === 'medium' ? 'warning' : 'default'}>
                      {item.priority}
                    </Badge>
                    <Badge tone={item.status === 'resolved' || item.status === 'closed' ? 'success' : 'primary'}>{item.status}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-subtle">{item.symptoms || item.environment}</p>
                </button>
                <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void deleteCase(item.id)} aria-label={t('common.delete')} />
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'notes' ? (
        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <Card>
            <CardHeader title={noteDraft.id ? t('workspace.editNote') : t('workspace.newNote')} icon={<NotebookPen className="h-4 w-4" />} />
            <CardBody>
              <form className="space-y-3" onSubmit={saveNote}>
                {noteError ? <Alert tone="danger">{noteError}</Alert> : null}
                <Field label={t('workspace.titleField')} htmlFor="note-title" required>
                  <Input id="note-title" value={noteDraft.title} maxLength={200} onChange={(event) => setNoteDraft({ ...noteDraft, title: event.target.value })} />
                </Field>
                <Field label={t('workspace.body')} htmlFor="note-body">
                  <Textarea id="note-body" value={noteDraft.body} onChange={(event) => setNoteDraft({ ...noteDraft, body: event.target.value })} />
                </Field>
                <Field label={t('workspace.tags')} htmlFor="note-tags">
                  <Input id="note-tags" value={noteDraft.tags} onChange={(event) => setNoteDraft({ ...noteDraft, tags: event.target.value })} />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" loading={noteBusy}>{t('common.save')}</Button>
                  {noteDraft.id ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setNoteDraft({ title: '', body: '', tags: '' })}>
                      {t('common.cancel')}
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('workspace.notes')} />
            <CardBody className="space-y-2">
              {notes.length === 0 ? <p className="text-xs text-subtle">{t('workspace.emptyNotes')}</p> : null}
              {notes.map((item) => (
                <div key={item.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" className="min-w-0 text-start" onClick={() => setNoteDraft({ id: item.id, title: item.title, body: item.body, tags: item.tags.join(', ') })}>
                      <p className="truncate text-sm font-semibold">{item.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-subtle">{item.body}</p>
                    </button>
                    <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void deleteNote(item.id)} aria-label={t('common.delete')} />
                  </div>
                  {item.tags.length ? <p className="mt-2 text-[11px] text-primary">{item.tags.join(' · ')}</p> : null}
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'conversations' ? (
        <Card>
          <CardHeader title={t('workspace.conversations')} />
          <CardBody className="space-y-2">
            {conversations.length === 0 ? <p className="text-xs text-subtle">{t('workspace.emptyConversations')}</p> : null}
            {conversations.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-[11px] text-subtle">{item.provider} {item.model}</p>
                </div>
                <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void deleteConversation(item.id)} aria-label={t('common.delete')} />
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={caseOpen}
        onClose={() => setCaseOpen(false)}
        title={caseDraft.id ? t('workspace.editCase') : t('workspace.newCase')}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCaseOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="case-form" size="sm" loading={caseBusy}>{t('common.save')}</Button>
          </div>
        }
      >
        <form id="case-form" className="space-y-3" onSubmit={saveCase}>
          {caseError ? <Alert tone="danger">{caseError}</Alert> : null}
          <Field label={t('workspace.titleField')} htmlFor="case-title" required>
            <Input id="case-title" value={caseDraft.title} maxLength={200} onChange={(event) => setCaseDraft({ ...caseDraft, title: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('workspace.category')} htmlFor="case-category">
              <Input id="case-category" value={caseDraft.category} maxLength={60} onChange={(event) => setCaseDraft({ ...caseDraft, category: event.target.value })} />
            </Field>
            <Field label={t('auth.status')} htmlFor="case-status">
              <Select id="case-status" value={caseDraft.status} onChange={(event) => setCaseDraft({ ...caseDraft, status: event.target.value as CaseRow['status'] })}>
                {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </Field>
            <Field label={t('common.risk')} htmlFor="case-priority">
              <Select id="case-priority" value={caseDraft.priority} onChange={(event) => setCaseDraft({ ...caseDraft, priority: event.target.value as CaseRow['priority'] })}>
                {PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={t('workspace.environment')} htmlFor="case-environment">
            <Textarea id="case-environment" className="min-h-16" value={caseDraft.environment} onChange={(event) => setCaseDraft({ ...caseDraft, environment: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('workspace.symptoms')} htmlFor="case-symptoms">
              <Textarea id="case-symptoms" value={caseDraft.symptoms} onChange={(event) => setCaseDraft({ ...caseDraft, symptoms: event.target.value })} />
            </Field>
            <Field label={t('workspace.logs')} htmlFor="case-logs">
              <Textarea id="case-logs" value={caseDraft.logs} onChange={(event) => setCaseDraft({ ...caseDraft, logs: event.target.value })} />
            </Field>
            <Field label={t('workspace.causes')} htmlFor="case-causes">
              <Textarea id="case-causes" value={caseDraft.causes} onChange={(event) => setCaseDraft({ ...caseDraft, causes: event.target.value })} />
            </Field>
            <Field label={t('workspace.tests')} htmlFor="case-tests">
              <Textarea id="case-tests" value={caseDraft.tests} onChange={(event) => setCaseDraft({ ...caseDraft, tests: event.target.value })} />
            </Field>
            <Field label={t('workspace.fixes')} htmlFor="case-fixes">
              <Textarea id="case-fixes" value={caseDraft.fixes} onChange={(event) => setCaseDraft({ ...caseDraft, fixes: event.target.value })} />
            </Field>
            <Field label={t('workspace.resolution')} htmlFor="case-resolution">
              <Textarea id="case-resolution" value={caseDraft.resolution} onChange={(event) => setCaseDraft({ ...caseDraft, resolution: event.target.value })} />
            </Field>
          </div>
          <Field label={t('workspace.lessons')} htmlFor="case-lessons">
            <Textarea id="case-lessons" value={caseDraft.lessons} onChange={(event) => setCaseDraft({ ...caseDraft, lessons: event.target.value })} />
          </Field>
        </form>
      </Modal>
    </div>
  )
}
