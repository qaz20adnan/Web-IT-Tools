import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BookMarked,
  Copy,
  Download,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import {
  deleteKnowledgeEntry,
  filterKnowledgeBase,
  KB_CATEGORIES,
  knowledgeBaseToJson,
  knowledgeBaseToMarkdown,
  knowledgeEntryToMarkdown,
  loadKnowledgeBase,
  parseTags,
  saveKnowledgeBase,
  upsertKnowledgeEntry,
} from '@/services/knowledge-base'
import type { KnowledgeBaseDraft, KnowledgeBaseEntry, KnowledgeBaseSource, ProblemCategory } from '@/types'
import { downloadTextFile } from '@/lib/utils'
import { formatDateTime } from '@/i18n'

interface FormState {
  title: string
  problem: string
  solution: string
  category: ProblemCategory
  tags: string
  source: KnowledgeBaseSource
}

const EMPTY_FORM: FormState = {
  title: '',
  problem: '',
  solution: '',
  category: 'other',
  tags: '',
  source: 'manual',
}

function fromDraft(draft?: KnowledgeBaseDraft): FormState {
  if (!draft) return EMPTY_FORM
  return {
    title: draft.title,
    problem: draft.problem,
    solution: draft.solution,
    category: draft.category,
    tags: (draft.tags ?? []).join(', '),
    source: draft.source ?? 'manual',
  }
}

export function KnowledgeBasePage() {
  const { settings } = useApp()
  const { notify } = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)

  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>(() => loadKnowledgeBase())
  const [form, setForm] = useState<FormState>(() => {
    const state = location.state as { draft?: KnowledgeBaseDraft } | null
    return fromDraft(state?.draft)
  })
  const [editingId, setEditingId] = useState<string | null>(() => {
    const state = location.state as { draft?: KnowledgeBaseDraft } | null
    return state?.draft?.id ?? null
  })
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ProblemCategory | 'all'>('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const state = location.state as { draft?: KnowledgeBaseDraft } | null
    if (!state?.draft) return
    setForm(fromDraft(state.draft))
    setEditingId(state.draft.id ?? null)
    setError(null)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.key, location.pathname, location.state, navigate])

  const filtered = useMemo(
    () => filterKnowledgeBase(entries, { query, category }).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entries, query, category],
  )

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setError(null)
  }

  const save = () => {
    if (!form.title.trim() || !form.problem.trim() || !form.solution.trim()) {
      setError(L('Title, problem and solution are required.', 'العنوان والمشكلة والحل مطلوبة.'))
      return
    }
    const result = upsertKnowledgeEntry(entries, {
      ...(editingId ? { id: editingId } : {}),
      title: form.title,
      problem: form.problem,
      solution: form.solution,
      category: form.category,
      tags: parseTags(form.tags),
      source: form.source,
    })
    if (!saveKnowledgeBase(result.entries)) {
      setError(L('Could not save locally. Browser storage may be full.', 'تعذر الحفظ محلياً. قد تكون مساحة المتصفح ممتلئة.'))
      return
    }
    setEntries(result.entries)
    notify('success', editingId ? L('Entry updated.', 'تم تحديث الإدخال.') : L('Entry saved.', 'تم حفظ الإدخال.'))
    resetForm()
  }

  const startEdit = (entry: KnowledgeBaseEntry) => {
    setEditingId(entry.id)
    setForm({
      title: entry.title,
      problem: entry.problem,
      solution: entry.solution,
      category: entry.category,
      tags: entry.tags.join(', '),
      source: entry.source,
    })
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = (entry: KnowledgeBaseEntry) => {
    if (!window.confirm(L(`Delete "${entry.title}"?`, `حذف "${entry.title}"؟`))) return
    const next = deleteKnowledgeEntry(entries, entry.id)
    if (!saveKnowledgeBase(next)) {
      notify('error', L('Could not delete the entry.', 'تعذر حذف الإدخال.'))
      return
    }
    setEntries(next)
    if (editingId === entry.id) resetForm()
    notify('success', L('Entry deleted.', 'تم حذف الإدخال.'))
  }

  const copyEntry = async (entry: KnowledgeBaseEntry) => {
    try {
      await navigator.clipboard.writeText(knowledgeEntryToMarkdown(entry))
      notify('success', L('Entry copied as Markdown.', 'تم نسخ الإدخال بصيغة Markdown.'))
    } catch {
      notify('error', L('Could not copy the entry.', 'تعذر نسخ الإدخال.'))
    }
  }

  const exportMarkdown = () => {
    downloadTextFile('nexora-knowledge-base.md', knowledgeBaseToMarkdown(entries), 'text/markdown;charset=utf-8')
  }

  const exportJson = () => {
    downloadTextFile('nexora-knowledge-base.json', knowledgeBaseToJson(entries), 'application/json;charset=utf-8')
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={L('Troubleshooting Knowledge Base', 'قاعدة معرفة استكشاف الأخطاء')}
        subtitle={L(
          'Record real problems and verified fixes locally. Export the base as Markdown or JSON for documentation and handover.',
          'سجّل المشكلات الحقيقية والحلول المؤكدة محلياً. صدّر القاعدة بصيغة Markdown أو JSON للتوثيق والتسليم.',
        )}
        badge={<Badge tone="primary">{entries.length} {L('entries', 'إدخال')}</Badge>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportMarkdown} disabled={entries.length === 0}>
              Markdown
            </Button>
            <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportJson} disabled={entries.length === 0}>
              JSON
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader
          title={editingId ? L('Edit entry', 'تعديل الإدخال') : L('New entry', 'إدخال جديد')}
          icon={editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          subtitle={L(
            'Store the symptom, the evidence and the fix that actually worked. Keep secrets out of this local base.',
            'سجّل العَرَض والدليل والحل الذي نجح فعلاً. لا تخزّن أسراراً في هذه القاعدة المحلية.',
          )}
          actions={editingId ? <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={resetForm}>{L('Cancel', 'إلغاء')}</Button> : undefined}
        />
        <div className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={L('Title', 'العنوان')} htmlFor="kb-title">
              <Input
                id="kb-title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder={L('e.g. Printer queue stuck after driver update', 'مثال: قائمة الطباعة متوقفة بعد تحديث التعريف')}
                maxLength={200}
              />
            </Field>
            <Field label={L('Category', 'الفئة')} htmlFor="kb-category">
              <Select
                id="kb-category"
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value as ProblemCategory })}
              >
                {KB_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={L('Problem and evidence', 'المشكلة والأدلة')} htmlFor="kb-problem" hint={L('Symptoms, error codes, scope, when it started.', 'الأعراض، رموز الأخطاء، النطاق، وقت البدء.')}>
            <Textarea
              id="kb-problem"
              rows={4}
              value={form.problem}
              onChange={(event) => setForm({ ...form, problem: event.target.value })}
              maxLength={5000}
            />
          </Field>
          <Field label={L('Verified solution', 'الحل المؤكد')} htmlFor="kb-solution" hint={L('Exact commands, settings and the verification step.', 'الأوامر والإعدادات الدقيقة وخطوة التحقق.')}>
            <Textarea
              id="kb-solution"
              rows={5}
              value={form.solution}
              onChange={(event) => setForm({ ...form, solution: event.target.value })}
              maxLength={12000}
            />
          </Field>
          <Field label={L('Tags', 'الوسوم')} htmlFor="kb-tags" hint={L('Comma separated, maximum 12.', 'مفصولة بفواصل، بحد أقصى 12.')}>
            <Input
              id="kb-tags"
              value={form.tags}
              onChange={(event) => setForm({ ...form, tags: event.target.value })}
              placeholder="printing, spooler, windows"
              dir="ltr"
            />
          </Field>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} icon={<Save className="h-4 w-4" />}>
              {editingId ? L('Update entry', 'تحديث الإدخال') : L('Save entry', 'حفظ الإدخال')}
            </Button>
            <Button variant="secondary" onClick={resetForm} icon={<X className="h-4 w-4" />}>
              {L('Clear', 'مسح')}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={L('Saved knowledge', 'المعرفة المحفوظة')}
          icon={<BookMarked className="h-4 w-4" />}
          subtitle={`${filtered.length} / ${entries.length}`}
        />
        <div className="space-y-3 p-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={L('Search title, problem, solution or tags…', 'ابحث في العنوان أو المشكلة أو الحل أو الوسوم…')}
                className="ps-9"
              />
            </div>
            <Select value={category} onChange={(event) => setCategory(event.target.value as ProblemCategory | 'all')}>
              <option value="all">{L('All categories', 'كل الفئات')}</option>
              {KB_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<BookMarked className="h-5 w-5" />}
              title={entries.length === 0 ? L('No entries yet', 'لا توجد إدخالات بعد') : L('No matches', 'لا توجد نتائج')}
              description={entries.length === 0
                ? L('Save your first verified fix, or send a Troubleshooting Lab result here.', 'احفظ أول حل مؤكد، أو أرسل نتيجة من مختبر تحليل المشكلات إلى هنا.')
                : L('Try a different search or category.', 'جرّب بحثاً أو فئة مختلفة.')}
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((entry) => (
                <article key={entry.id} className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-semibold">{entry.title}</h3>
                        <Badge>{entry.category}</Badge>
                        <Badge tone={entry.source === 'manual' ? 'default' : 'accent'}>{entry.source}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-subtle">
                        {L('Updated', 'آخر تحديث')} {formatDateTime(entry.updatedAt, settings.language)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button size="icon" variant="ghost" title={L('Copy Markdown', 'نسخ Markdown')} aria-label={L('Copy Markdown', 'نسخ Markdown')} onClick={() => void copyEntry(entry)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" title={L('Edit', 'تعديل')} aria-label={L('Edit', 'تعديل')} onClick={() => startEdit(entry)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" title={L('Delete', 'حذف')} aria-label={L('Delete', 'حذف')} onClick={() => remove(entry)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {entry.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {entry.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
                    </div>
                  ) : null}
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    <div className="rounded-md border border-line p-2">
                      <p className="text-[10px] uppercase tracking-wide text-subtle">{L('Problem', 'المشكلة')}</p>
                      <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted">{entry.problem}</p>
                    </div>
                    <div className="rounded-md border border-line p-2">
                      <p className="text-[10px] uppercase tracking-wide text-subtle">{L('Solution', 'الحل')}</p>
                      <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted">{entry.solution}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
