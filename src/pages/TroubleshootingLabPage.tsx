import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  BookMarked,
  Bookmark,
  BookmarkCheck,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  FileSearch,
  ImagePlus,
  Loader2,
  Play,
  Search,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  TerminalSquare,
  Trash2,
  WifiOff,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CodeBlock,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useProviders } from '@/context/ProvidersContext'
import { useHealth } from '@/hooks/useHealth'
import { useToast } from '@/context/ToastContext'
import { analyzeProblem, ApiError } from '@/services/api'
import { runLocalTriage } from '@/services/localTriage'
import { consumeLabDraft, setLabDraft } from '@/lib/draft'
import { formatBytes, truncate, validateImageFile, downloadTextFile } from '@/lib/utils'
import { buildReportMarkdown, reportFilename } from '@/lib/report'
import { formatDate } from '@/i18n'
import { getDomain } from '@/data/domains'
import type { AnalysisResult, ExperienceLevel, Priority, ProblemCategory, ProblemInput } from '@/types'

const CATEGORIES: ProblemCategory[] = [
  'windows-client',
  'windows-server',
  'printing',
  'microsoft-365',
  'networking',
  'linux',
  'cybersecurity',
  'datacenter',
  'backup-dr',
  'cloud-devops',
  'other',
]

const EMPTY: ProblemInput = {
  title: '',
  description: '',
  errorText: '',
  logs: '',
  category: 'windows-server',
  os: '',
  environment: '',
  recentChange: '',
  experience: 'professional',
  priority: 'medium',
}

export function TroubleshootingLabPage() {
  const { t, settings } = useApp()
  const { credentials, hasClientProvider, defaultProvider } = useProviders()
  const { data: health } = useHealth()
  const { addHistory, saveItem, isSaved } = useLibrary()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const mode = params.get('mode')

  const [input, setInput] = useState<ProblemInput>(EMPTY)
  const [image, setImage] = useState<{ dataUrl: string; name: string; size: number } | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [lastRunOffline, setLastRunOffline] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const aiAvailable = hasClientProvider || Boolean(health?.services.ai.configured)

  useEffect(() => {
    const draft = consumeLabDraft()
    if (!draft) return
    setInput((current) => ({ ...current, ...draft }))
    if (draft.imageDataUrl) {
      setImage({ dataUrl: draft.imageDataUrl, name: draft.imageName ?? 'screenshot', size: draft.imageDataUrl.length })
    }
  }, [])

  const setField = <K extends keyof ProblemInput>(key: K, value: ProblemInput[K]) => {
    setInput((current) => ({ ...current, [key]: value }))
  }

  const fullInput = useMemo<ProblemInput>(() => ({ ...input, imageDataUrl: image?.dataUrl, imageName: image?.name }), [input, image])

  const persistHistory = (analysis: AnalysisResult) => {
    addHistory({
      title: input.title.trim() || truncate(input.description.trim() || analysis.summary, 90),
      category: input.category,
      priority: input.priority,
      summary: analysis.summary,
      analysis,
      input: { ...input },
    })
  }

  const runAnalysis = async (offline: boolean) => {
    if (!input.description.trim() && !input.errorText.trim()) {
      notify('warning', t('lab.description') + ': ' + t('common.requiredField'))
      return
    }
    setError(null)
    setErrorCode(null)
    setBusy(true)
    setLastRunOffline(offline)
    try {
      const analysis = offline ? runLocalTriage(fullInput, settings.language) : await analyzeProblem(fullInput, credentials)
      setResult(analysis)
      persistHistory(analysis)
      notify('success', offline ? t('lab.localReport') : t('lab.autoSaved'))
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null
      setErrorCode(apiError?.code ?? 'unknown')
      setError(apiError?.message ?? (caught instanceof Error ? caught.message : t('errors.generic')))
    } finally {
      setBusy(false)
    }
  }

  const exportReport = () => {
    if (!result) return
    downloadTextFile(
      reportFilename(input.title || 'analysis'),
      buildReportMarkdown(result, input, settings.language),
      'text/markdown;charset=utf-8',
    )
  }

  const sendToCopilot = () => {
    if (!result) return
    try {
      sessionStorage.setItem(
        'nexora.copilot.context',
        JSON.stringify({
          problem: input,
          summary: result.summary,
          causes: result.causes.map((cause) => cause.cause),
          diagnostics: result.diagnosticSteps.map((step) => `${step.title}: ${step.detail}`),
        }),
      )
    } catch {
      /* sessionStorage may be unavailable; context is optional */
    }
    navigate('/copilot')
  }

  const saveToKnowledgeBase = () => {
    if (!result) return
    const problem = [
      input.description,
      input.errorText ? `Error: ${input.errorText}` : '',
      input.logs ? `Logs:\n${input.logs.slice(0, 3000)}` : '',
      `AI summary: ${result.summary}`,
      result.symptoms.length > 0 ? `Symptoms:\n- ${result.symptoms.join('\n- ')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    const solution = result.solutions
      .map((step, index) => {
        const command = step.command ? `\n\n${step.command}` : ''
        return `${index + 1}. ${step.title}\n${step.detail}${command}`
      })
      .join('\n\n')
    navigate('/kb', {
      state: {
        draft: {
          title: input.title || truncate(result.summary, 80),
          problem,
          solution: solution || result.summary,
          category: result.category,
          tags: ['troubleshooting', result.category],
          source: 'troubleshooting',
        },
      },
    })
  }


  const bookmarked = result ? isSaved(`analysis:${result.generatedAt}`) : false
  const modeLabel = mode === 'plan' ? t('lab.buildPlan') : t('lab.analyze')

  return (
    <div className="animate-in">
      <PageHeader
        title={t('lab.title')}
        subtitle={t('lab.subtitle')}
        badge={<Badge tone="primary" icon={<Sparkles className="h-3 w-3" />}>AI</Badge>}
      />

      {!aiAvailable ? (
        <Alert tone="warning" title={t('lab.needProviderTitle')} className="mb-4">
          <p>{t('lab.needProviderBody')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to="/providers" className="btn btn-secondary text-xs">
              {t('dashboard.configureAi')}
            </Link>
            <Button size="sm" variant="ghost" icon={<WifiOff className="h-3.5 w-3.5" />} onClick={() => void runAnalysis(true)}>
              {t('lab.offlineAnalyze')}
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
        <Card className="self-start xl:sticky xl:top-20">
          <CardHeader title={t('lab.sectionProblem')} icon={<Stethoscope className="h-4 w-4" />} />
          <form
            className="space-y-3 p-5"
            onSubmit={(event) => {
              event.preventDefault()
              void runAnalysis(false)
            }}
          >
            <Field label={t('lab.titleLabel')} htmlFor="lab-title" hint={t('lab.titlePlaceholder')}>
              <Input
                id="lab-title"
                value={input.title}
                onChange={(event) => setField('title', event.target.value)}
                placeholder={t('lab.titlePlaceholder')}
                maxLength={140}
              />
            </Field>

            <Field label={t('lab.description')} htmlFor="lab-description" required>
              <Textarea
                id="lab-description"
                value={input.description}
                onChange={(event) => setField('description', event.target.value)}
                placeholder={t('lab.descriptionPlaceholder')}
                className="min-h-28"
                maxLength={8000}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('lab.category')} htmlFor="lab-category">
                <Select id="lab-category" value={input.category} onChange={(event) => setField('category', event.target.value as ProblemCategory)}>
                  {CATEGORIES.map((id) => (
                    <option key={id} value={id}>
                      {t(getDomain(id).labelKey)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('lab.priority')} htmlFor="lab-priority">
                <Select id="lab-priority" value={input.priority} onChange={(event) => setField('priority', event.target.value as Priority)}>
                  {(['low', 'medium', 'high', 'critical'] as Priority[]).map((id) => (
                    <option key={id} value={id}>
                      {t(`priority.${id}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('lab.os')} htmlFor="lab-os">
                <Input id="lab-os" value={input.os} onChange={(event) => setField('os', event.target.value)} placeholder="Windows Server 2022 21H2" maxLength={120} />
              </Field>
              <Field label={t('lab.experience')} htmlFor="lab-experience">
                <Select id="lab-experience" value={input.experience} onChange={(event) => setField('experience', event.target.value as ExperienceLevel)}>
                  {(['beginner', 'professional', 'expert'] as ExperienceLevel[]).map((level) => (
                    <option key={level} value={level}>
                      {t(`experience.${level}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label={t('lab.errorText')} htmlFor="lab-error" hint={t('lab.errorTextPlaceholder')}>
              <Input id="lab-error" value={input.errorText} onChange={(event) => setField('errorText', event.target.value)} placeholder="0x800f081f / Event ID 1311 / STATUS_ACCESS_DENIED" maxLength={500} />
            </Field>

            <Field label={t('lab.environment')} htmlFor="lab-environment">
              <Input id="lab-environment" value={input.environment} onChange={(event) => setField('environment', event.target.value)} placeholder={t('lab.environmentPlaceholder')} maxLength={300} />
            </Field>

            <Field label={t('lab.recentChange')} htmlFor="lab-change">
              <Input id="lab-change" value={input.recentChange} onChange={(event) => setField('recentChange', event.target.value)} placeholder={t('lab.recentChangePlaceholder')} maxLength={300} />
            </Field>

            <Field label={t('lab.logs')} htmlFor="lab-logs" hint={`${t('lab.logsPlaceholder')} (${input.logs.length}/20000)`}>
              <Textarea
                id="lab-logs"
                value={input.logs}
                onChange={(event) => setField('logs', event.target.value.slice(0, 20000))}
                placeholder="2026-10-22 09:14:02,ERROR,…"
                className="min-h-24 font-mono text-xs"
                dir="ltr"
              />
            </Field>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted">{t('lab.image')}</p>
              {image ? (
                <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
                  <img src={image.dataUrl} alt="" className="h-14 w-14 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{image.name}</p>
                    <p className="text-[10px] text-subtle">{formatBytes(image.size)}</p>
                    <p className="mt-0.5 text-[10px] text-subtle">{t('lab.imagePrivacy')}</p>
                  </div>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setImage(null)} aria-label={t('lab.removeImage')}>
                    {t('common.remove')}
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" size="sm" icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileInput.current?.click()} className="w-full justify-center">
                  {t('dashboard.uploadImage')}
                </Button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  const validated = await validateImageFile(file)
                  if (!validated.ok) {
                    setImageError(
                      validated.reason === 'size'
                        ? t('common.fileTooLarge', { max: 4 })
                        : validated.reason === 'type'
                          ? t('common.unsupportedFile')
                          : t('lab.invalidImage'),
                    )
                    return
                  }
                  setImageError(null)
                  setImage({ dataUrl: validated.dataUrl, name: file.name, size: file.size })
                }}
              />
              {imageError ? <p role="alert" className="mt-1 text-xs text-danger">{imageError}</p> : null}
              <p className="mt-1 text-[10px] text-subtle">{t('lab.imageHint')}</p>
              {image && defaultProvider && !defaultProvider.supportsVision ? (
                <p className="mt-1 text-[10px] text-warning">{t('lab.requiresProviderForImages')}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button type="submit" loading={busy} icon={<BrainCircuit className="h-4 w-4" />} disabled={!aiAvailable}>
                {busy ? t('lab.analyzing') : modeLabel}
              </Button>
              <Button type="button" variant="secondary" icon={<WifiOff className="h-4 w-4" />} onClick={() => void runAnalysis(true)} disabled={busy}>
                {t('lab.offlineAnalyze')}
              </Button>
            </div>
            <p className="text-[10px] text-subtle">{t('lab.offlineNote')}</p>
          </form>
        </Card>

        <div ref={resultRef} className="min-w-0">
          {error ? (
            <div className="mb-3 space-y-2">
              <ErrorState
                title={t('lab.analyzeFailed')}
                description={errorCode ? `${error} (${errorCode})` : error}
                onRetry={() => void runAnalysis(false)}
                retryLabel={t('common.retry')}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" icon={<WifiOff className="h-3.5 w-3.5" />} onClick={() => void runAnalysis(true)}>
                  {t('lab.offlineAnalyze')}
                </Button>
                {errorCode === 'not_configured' ? (
                  <Link to="/providers" className="btn btn-secondary text-xs">
                    {t('dashboard.configureAi')}
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          {!result ? (
            <Card>
              <CardHeader title={t('lab.result')} icon={<FileSearch className="h-4 w-4" />} />
              <div className="p-5">
                <EmptyState
                  icon={<BrainCircuit className="h-8 w-8" />}
                  title={t('lab.noResult')}
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button variant="secondary" size="sm" icon={<Search className="h-3.5 w-3.5" />} onClick={() => navigate('/research')}>
                        {t('dashboard.research')}
                      </Button>
                      <Button variant="ghost" size="sm" icon={<TerminalSquare className="h-3.5 w-3.5" />} onClick={() => navigate('/scripts')}>
                        {t('dashboard.script')}
                      </Button>
                    </div>
                  }
                />
                {busy ? <div className="mt-4"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></div> : null}
              </div>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <CardHeader
                title={t('lab.result')}
                subtitle={t('lab.generatedBy', { provider: result.provider, model: result.model })}
                icon={<ClipboardList className="h-4 w-4" />}
                actions={
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={bookmarked ? <BookmarkCheck className="h-3.5 w-3.5 text-success" /> : <Bookmark className="h-3.5 w-3.5" />}
                      onClick={() => {
                        if (!result) return
                        saveItem({
                          kind: 'analysis',
                          title: input.title || truncate(result.summary, 80),
                          refId: `analysis:${result.generatedAt}`,
                          payload: result,
                        })
                        notify('success', t('lab.bookmarkSaved'))
                      }}
                      aria-label={t('lab.saveReport')}
                    />
                    <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={exportReport} aria-label={t('lab.exportMarkdown')} />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<BookMarked className="h-3.5 w-3.5" />}
                      onClick={saveToKnowledgeBase}
                      aria-label={settings.language === 'ar' ? 'حفظ في قاعدة المعرفة' : 'Save to Knowledge Base'}
                      title={settings.language === 'ar' ? 'حفظ في قاعدة المعرفة' : 'Save to Knowledge Base'}
                    />
                    <Button size="sm" variant="secondary" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={sendToCopilot}>
                      {t('lab.sendToCopilot')}
                    </Button>
                  </div>
                }
              />
              <div className="space-y-5 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  {result.offline ? <Badge tone="warning" icon={<WifiOff className="h-3 w-3" />}>{t('lab.localReport')}</Badge> : <Badge tone="accent" icon={<Sparkles className="h-3 w-3" />}>AI</Badge>}
                  <Badge tone="default">{t(getDomain(result.category).labelKey)}</Badge>
                  <Badge tone={result.confidence.level === 'high' ? 'success' : result.confidence.level === 'medium' ? 'warning' : 'danger'}>
                    {t('lab.confidence')}: {t(`likelihood.${result.confidence.level}`)}
                  </Badge>
                  <span className="text-[10px] text-subtle">{formatDate(result.generatedAt, settings.language)}</span>
                </div>

                <section>
                  <h3 className="mb-1 text-sm font-semibold">{t('lab.summary')}</h3>
                  <p className="text-sm text-muted">{result.summary}</p>
                  <p className="mt-1 text-[11px] text-subtle">{t('lab.confidenceReason')}: {result.confidence.reason}</p>
                </section>

                <div className="grid gap-4 sm:grid-cols-2">
                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t('lab.symptoms')}</h3>
                    <ul className="space-y-1 text-sm text-muted">
                      {result.symptoms.map((symptom, index) => (
                        <li key={index} className="flex gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                          {symptom}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t('lab.missingInfo')}</h3>
                    <ul className="space-y-1 text-sm text-muted">
                      {result.missingInformation.map((item, index) => (
                        <li key={index} className="flex gap-2">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('lab.causes')}</h3>
                  <div className="space-y-2">
                    {result.causes.map((cause, index) => (
                      <div key={index} className="rounded-lg border border-line bg-surface-2/60 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium">{cause.cause}</p>
                          <Badge tone={cause.likelihood === 'high' ? 'danger' : cause.likelihood === 'medium' ? 'warning' : 'default'}>
                            {t(`likelihood.${cause.likelihood}`)}
                          </Badge>
                        </div>
                        <ul className="mt-1 space-y-0.5 text-xs text-muted">
                          {cause.evidence.map((item, evidenceIndex) => (
                            <li key={evidenceIndex}>— {item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('lab.evidence')}</h3>
                  <ul className="space-y-1.5">
                    {result.evidence.map((item, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm">
                        <Badge
                          tone={item.type === 'fact' ? 'success' : item.type === 'inference' ? 'primary' : item.type === 'unverified' ? 'warning' : 'default'}
                        >
                          {t(`evidence.${item.type}`)}
                        </Badge>
                        <span className="text-muted">{item.statement}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <StepList title={t('lab.diagnosticSteps')} steps={result.diagnosticSteps} />

                {result.solutions.length > 0 ? <StepList title={t('lab.solutions')} steps={result.solutions} /> : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t('lab.prerequisites')}</h3>
                    <ul className="list-inside list-disc space-y-1 text-xs text-muted">
                      {result.prerequisites.map((item, index) => <li key={index}>{item}</li>)}
                    </ul>
                  </section>
                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t('lab.risks')}</h3>
                    <ul className="list-inside list-disc space-y-1 text-xs text-muted">
                      {result.risks.map((item, index) => <li key={index}>{item}</li>)}
                    </ul>
                  </section>
                </div>

                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('lab.rollback')}</h3>
                  <p className="text-sm text-muted">{result.rollback || '—'}</p>
                </section>

                <section className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                    <ShieldAlert className="h-3.5 w-3.5 text-warning" />
                    {t('lab.limitations')}
                  </h3>
                  <p className="text-xs text-muted">{result.limitations}</p>
                </section>

                {result.sources.length > 0 ? (
                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t('common.sources')}</h3>
                    <ul className="space-y-1">
                      {result.sources.map((source, index) => (
                        <li key={index}>
                          <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                            <ExternalLink className="h-3 w-3" />
                            {source.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button size="sm" variant="secondary" icon={<Search className="h-3.5 w-3.5" />} onClick={() => navigate(`/research?q=${encodeURIComponent(input.errorText || input.title || truncate(input.description, 180))}`)}>
                    {t('lab.findSources')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<TerminalSquare className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setLabDraft(input)
                      navigate(`/scripts?prompt=${encodeURIComponent(`${input.title}\n${input.description}\n${input.errorText}`.trim())}`)
                    }}
                  >
                    {t('lab.createScript')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Play className="h-3.5 w-3.5" />} onClick={() => navigate('/copilot')}>
                    {t('nav.copilot')}
                  </Button>
                </div>
                {lastRunOffline ? <p className="text-[10px] text-subtle">{t('lab.offlineNote')}</p> : null}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function StepList({ title, steps }: { title: string; steps: AnalysisResult['diagnosticSteps'] }) {
  const { t } = useApp()
  if (steps.length === 0) return null
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ol className="space-y-2">
        {steps.map((step) => (
          <li key={`${step.order}-${step.title}`} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-medium">
                <span className="me-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-[10px]">{step.order}</span>
                {step.title}
              </p>
              <div className="flex gap-1.5">
                <Badge tone={step.kind === 'diagnostic' ? 'primary' : 'accent'}>{step.kind === 'diagnostic' ? t('lab.kindDiagnostic') : t('lab.kindChange')}</Badge>
                <Badge tone={step.risk === 'none' ? 'success' : step.risk === 'low' ? 'default' : step.risk === 'medium' ? 'warning' : 'danger'}>
                  {t(step.risk === 'none' ? 'lab.riskNone' : step.risk === 'low' ? 'lab.riskLow' : step.risk === 'medium' ? 'lab.riskMedium' : 'lab.riskHigh')}
                </Badge>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted">{step.detail}</p>
            {step.command ? (
              <div className="mt-2">
                <CodeBlock code={step.command} language="command" title={t('lab.diagnosticSteps')} maxHeight="12rem" />
              </div>
            ) : null}
            {step.rollback ? (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-subtle">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                {t('lab.rollback')}: {step.rollback}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

export default TroubleshootingLabPage

