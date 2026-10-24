import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, BookmarkPlus, Download, FileCode2, ScanSearch, ShieldAlert, Sparkles, TerminalSquare, Wand2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CodeBlock,
  EmptyState,
  Field,
  PageHeader,
  RiskBadge,
  Select,
  Tab,
  Tabs,
  Textarea,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useProviders } from '@/context/ProvidersContext'
import { useHealth } from '@/hooks/useHealth'
import { useToast } from '@/context/ToastContext'
import { SCRIPT_TEMPLATES } from '@/data/scripts'
import { getDomain } from '@/data/domains'
import { ApiError, generateScript, reviewScript } from '@/services/api'
import { scanScript, highestRisk, type ScanFinding } from '@/lib/scriptScan'
import { downloadTextFile, uid } from '@/lib/utils'
import { formatDate, pickText } from '@/i18n'
import type { ScriptLanguage, ScriptTemplate } from '@/types'

const LANGUAGES: ScriptLanguage[] = ['powershell', 'cmd', 'bash', 'python', 'sql', 'network']

const EXTENSIONS: Record<ScriptLanguage, string> = {
  powershell: 'ps1',
  cmd: 'cmd',
  bash: 'sh',
  python: 'py',
  sql: 'sql',
  network: 'txt',
}

export function ScriptLabPage() {
  const { t, settings } = useApp()
  const { localScripts, addScript } = useLibrary()
  const { credentials, hasClientProvider } = useProviders()
  const { data: health } = useHealth()
  const { notify } = useToast()
  const [params] = useSearchParams()
  const [tab, setTab] = useState(params.get('tab') ?? 'templates')
  const [language, setLanguage] = useState<'all' | ScriptLanguage>('all')
  const [selectedId, setSelectedId] = useState<string | null>(params.get('template'))

  const [prompt, setPrompt] = useState(params.get('prompt') ?? '')
  const [genLanguage, setGenLanguage] = useState<ScriptLanguage>('powershell')
  const [generated, setGenerated] = useState<{ code: string; language: string; feedback: string; provider: string; model: string } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const [reviewCode, setReviewCode] = useState('')
  const [findings, setFindings] = useState<ScanFinding[] | null>(null)
  const [aiReview, setAiReview] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const aiAvailable = hasClientProvider || Boolean(health?.services.ai.configured)

  const allTemplates = useMemo(() => {
    const map = new Map<string, ScriptTemplate>()
    for (const script of [...localScripts, ...SCRIPT_TEMPLATES]) {
      if (!map.has(script.id)) map.set(script.id, script)
    }
    return [...map.values()]
  }, [localScripts])
  const selected = useMemo(() => allTemplates.find((script) => script.id === selectedId) ?? null, [allTemplates, selectedId])
  const templates = useMemo(
    () => allTemplates.filter((script) => language === 'all' || script.language === language),
    [allTemplates, language],
  )

  useEffect(() => {
    if (params.get('prompt')) setTab('generator')
  }, [params])

  const saveScript = (script: ScriptTemplate) => {
    addScript(script)
    notify('success', t('scripts.saved'))
  }

  const generate = async () => {
    if (!prompt.trim()) {
      notify('warning', t('scripts.needPrompt'))
      return
    }
    setGenerating(true)
    setGenError(null)
    setGenerated(null)
    try {
      const response = await generateScript(prompt.trim(), genLanguage, credentials)
      setGenerated(response)
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null
      setGenError(apiError?.message ?? (caught instanceof Error ? caught.message : t('errors.generic')))
    } finally {
      setGenerating(false)
    }
  }

  const runAiReview = async () => {
    if (!reviewCode.trim()) return
    setReviewing(true)
    setReviewError(null)
    setAiReview(null)
    try {
      const response = await reviewScript(reviewCode, genLanguage, credentials)
      setAiReview(response.feedback)
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null
      setReviewError(apiError?.message ?? (caught instanceof Error ? caught.message : t('errors.generic')))
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="animate-in">
      <PageHeader title={t('scripts.title')} subtitle={t('scripts.subtitle')} badge={<Badge>{t('knowledge.articleCount', { count: allTemplates.length })}</Badge>} />

      <Tabs value={tab} onChange={setTab} className="mb-4">
        <Tab id="templates" icon={<FileCode2 className="h-4 w-4" />}>{t('scripts.templates')}</Tab>
        <Tab id="generator" icon={<Wand2 className="h-4 w-4" />}>{t('scripts.generator')}</Tab>
        <Tab id="reviewer" icon={<ScanSearch className="h-4 w-4" />}>{t('scripts.reviewer')}</Tab>
      </Tabs>

      <Alert tone="info" className="mb-4" title={t('scripts.dryRun')}>
        {t('scripts.manualRun')}
      </Alert>

      {tab === 'templates' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <Card>
            <CardHeader
              title={t('scripts.templates')}
              actions={
                <Select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} aria-label={t('scripts.filterLanguage')} className="w-36">
                  <option value="all">{t('common.all')}</option>
                  {LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </Select>
              }
            />
            {templates.length === 0 ? (
              <div className="p-4"><EmptyState title={t('scripts.noTemplates')} /></div>
            ) : (
              <div className="max-h-[70vh] divide-y divide-line overflow-y-auto">
                {templates.map((script) => (
                  <button
                    key={script.id}
                    type="button"
                    onClick={() => setSelectedId(script.id)}
                    className={`block w-full p-3.5 text-start hover:bg-surface-2 ${selectedId === script.id ? 'bg-surface-2' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{pickText(script.title, settings.language)}</span>
                      <RiskBadge risk={script.risk} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">{pickText(script.description, settings.language)}</p>
                    <p className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-subtle">
                      <span className="font-mono uppercase">{script.language}</span>
                      <span>· {t(getDomain(script.category === 'general' ? 'other' : script.category).labelKey)}</span>
                      <span>· {t(`verification.${script.verification}`)}</span>
                    </p>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <div>
            {selected ? (
              <Card>
                <CardHeader
                  title={pickText(selected.title, settings.language)}
                  subtitle={`${selected.language} · ${t('common.version')} ${selected.version} · ${formatDate(selected.createdAt, settings.language)}`}
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<BookmarkPlus className="h-3.5 w-3.5" />}
                        onClick={() => saveScript({ ...selected, id: selected.id })}
                        aria-label={t('scripts.saveTemplate')}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Download className="h-3.5 w-3.5" />}
                        onClick={() => downloadTextFile(`nexora-${selected.id}.${EXTENSIONS[selected.language]}`, selected.code)}
                        aria-label={t('scripts.download')}
                      />
                    </>
                  }
                />
                <div className="space-y-3 p-4">
                  <p className="text-sm text-muted">{pickText(selected.description, settings.language)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <RiskBadge risk={selected.risk} />
                    <Badge>{t(`verification.${selected.verification}`)}</Badge>
                    <Badge>{selected.language}</Badge>
                  </div>
                  <CodeBlock code={selected.code} language={selected.language} title={pickText(selected.title, settings.language)} maxHeight="28rem" />
                  {selected.requires.length > 0 ? (
                    <section>
                      <h3 className="mb-1 text-xs font-semibold">{t('scripts.requires')}</h3>
                      <ul className="list-inside list-disc text-xs text-muted">
                        {selected.requires.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </section>
                  ) : null}
                  {selected.rollback ? (
                    <section>
                      <h3 className="mb-1 text-xs font-semibold">{t('scripts.rollback')}</h3>
                      <p className="text-xs text-muted">{selected.rollback}</p>
                    </section>
                  ) : null}
                  <Button size="sm" variant="secondary" icon={<TerminalSquare className="h-3.5 w-3.5" />} onClick={() => { setReviewCode(selected.code); setTab('reviewer'); setFindings(scanScript(selected.code)) }}>
                    {t('scripts.review')}
                  </Button>
                </div>
              </Card>
            ) : (
              <Card className="p-6">
                <EmptyState icon={<FileCode2 className="h-8 w-8" />} title={t('scripts.templates')} description={t('scripts.manualRun')} />
              </Card>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'generator' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="self-start">
            <CardHeader title={t('scripts.generator')} icon={<Wand2 className="h-4 w-4" />} />
            <div className="space-y-3 p-4">
              {!aiAvailable ? <Alert tone="warning">{t('copilot.needsProvider')}</Alert> : null}
              <Field label={t('scripts.prompt')} htmlFor="script-prompt" required>
                <Textarea id="script-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('scripts.promptPlaceholder')} className="min-h-28" maxLength={4000} />
              </Field>
              <Field label={t('scripts.language')} htmlFor="script-language">
                <Select id="script-language" value={genLanguage} onChange={(event) => setGenLanguage(event.target.value as ScriptLanguage)}>
                  {LANGUAGES.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
                </Select>
              </Field>
              <Button onClick={() => void generate()} loading={generating} disabled={!aiAvailable} icon={<Sparkles className="h-4 w-4" />}>
                {generating ? t('scripts.generating') : t('scripts.generate')}
              </Button>
              {genError ? <Alert tone="danger" title={t('errors.generic')}>{genError}</Alert> : null}
              <p className="text-[10px] text-subtle">{t('scripts.generatedByAi')}</p>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('scripts.output')} />
            <div className="space-y-3 p-4">
              {generated ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent" icon={<Sparkles className="h-3 w-3" />}>AI</Badge>
                    <span className="text-[10px] text-subtle" dir="ltr">{generated.provider} · {generated.model}</span>
                  </div>
                  <CodeBlock code={generated.code} language={generated.language || genLanguage} title={t('scripts.output')} />
                  {generated.feedback ? <p className="whitespace-pre-wrap text-xs text-muted">{generated.feedback}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadTextFile(`nexora-generated.${EXTENSIONS[genLanguage]}`, generated.code)}>
                      {t('scripts.download')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<BookmarkPlus className="h-3.5 w-3.5" />}
                      onClick={() =>
                        saveScript({
                          id: uid('script'),
                          title: { en: prompt.slice(0, 80), ar: prompt.slice(0, 80) },
                          description: { en: generated.feedback || prompt, ar: generated.feedback || prompt },
                          language: genLanguage,
                          risk: highestRisk(scanScript(generated.code)),
                          category: 'general',
                          code: generated.code,
                          requires: ['Review every command before running', 'Least-privilege account', 'Test in a lab'],
                          rollback: 'Restore from a verified backup or snapshot if the change is not reversible.',
                          verification: 'ai-generated',
                          createdAt: new Date().toISOString(),
                          version: '1.0.0',
                        })
                      }
                    >
                      {t('scripts.saveTemplate')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<ScanSearch className="h-3.5 w-3.5" />}
                      onClick={() => { setReviewCode(generated.code); setTab('reviewer'); setFindings(scanScript(generated.code)) }}
                    >
                      {t('scripts.scan')}
                    </Button>
                  </div>
                </>
              ) : (
                <EmptyState icon={<Wand2 className="h-8 w-8" />} title={t('scripts.generator')} description={t('scripts.generatedByAi')} />
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'reviewer' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title={t('scripts.reviewer')} icon={<ScanSearch className="h-4 w-4" />} />
            <div className="space-y-3 p-4">
              <Field label={t('scripts.input')} htmlFor="review-code">
                <Textarea
                  id="review-code"
                  value={reviewCode}
                  onChange={(event) => { setReviewCode(event.target.value); setFindings(null); setAiReview(null) }}
                  placeholder={t('scripts.inputPlaceholder')}
                  className="min-h-64 font-mono text-xs"
                  dir="ltr"
                  spellCheck={false}
                  maxLength={40000}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button icon={<ScanSearch className="h-4 w-4" />} onClick={() => setFindings(scanScript(reviewCode))} disabled={!reviewCode.trim()}>
                  {t('scripts.scan')}
                </Button>
                <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={reviewing} onClick={() => void runAiReview()} disabled={!reviewCode.trim() || !aiAvailable}>
                  {reviewing ? t('scripts.reviewing') : t('scripts.aiReview')}
                </Button>
              </div>
              {reviewError ? <Alert tone="danger" title={t('errors.generic')}>{reviewError}</Alert> : null}
            </div>
          </Card>

          <Card className="self-start">
            <CardHeader
              title={t('scripts.scanResult')}
              subtitle={findings ? t('scripts.findings', { count: findings.length }) : undefined}
              icon={<ShieldAlert className="h-4 w-4" />}
            />
            <div className="space-y-3 p-4">
              {findings === null ? (
                <EmptyState icon={<ScanSearch className="h-8 w-8" />} title={t('scripts.scanResult')} description={t('scripts.manualRun')} />
              ) : findings.length === 0 ? (
                <Alert tone="success" title={t('scripts.noFindings')} />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">{t('scripts.risk')}</span>
                    <RiskBadge risk={highestRisk(findings)} />
                  </div>
                  {highestRisk(findings) === 'critical' ? <Alert tone="danger">{t('scripts.warningCritical')}</Alert> : highestRisk(findings) === 'high' ? <Alert tone="warning">{t('scripts.warningHigh')}</Alert> : null}
                  <ul className="space-y-2">
                    {findings.map((finding, index) => (
                      <li key={`${finding.ruleId}-${finding.line}-${index}`} className="rounded-lg border border-line p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="flex items-center gap-1.5 text-sm font-medium">
                            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                            {pickText(finding.title, settings.language)}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <Badge tone={finding.severity === 'critical' ? 'danger' : finding.severity === 'high' ? 'warning' : 'default'}>
                              {t(`scripts.risk.${finding.severity}`)}
                            </Badge>
                            <Badge>{t('scripts.line')} {finding.line}</Badge>
                          </div>
                        </div>
                        <pre className="mt-1.5 overflow-x-auto rounded bg-[var(--code-bg)] px-2 py-1 text-[11px]" dir="ltr">{finding.excerpt}</pre>
                        <p className="mt-1 text-xs text-muted">{pickText(finding.recommendation, settings.language)}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {aiReview ? (
                <section className="rounded-lg border border-accent/30 bg-accent/5 p-3">
                  <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                    <Sparkles className="h-3.5 w-3.5 text-accent" />
                    {t('scripts.reviewOutput')}
                  </h3>
                  <p className="whitespace-pre-wrap text-xs text-muted">{aiReview}</p>
                </section>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

export default ScriptLabPage
