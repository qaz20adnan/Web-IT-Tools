import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Clock3,
  FileText,
  ImagePlus,
  ListChecks,
  Loader2,
  Newspaper,
  Search,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import { Badge, Button, Card, CardHeader, ErrorState, PageHeader, Select, Stat, StatusDot } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useProviders } from '@/context/ProvidersContext'
import { useHealth } from '@/hooks/useHealth'
import { useNews } from '@/hooks/useNews'
import { KNOWLEDGE_ARTICLES } from '@/data/knowledge'
import { TOOLS } from '@/data/tools'
import { MODEL_CATALOG } from '@/data/models'
import { setLabDraft } from '@/lib/draft'
import { formatBytes, truncate, validateImageFile } from '@/lib/utils'
import { pickText, formatDate } from '@/i18n'
import type { ProblemCategory, Priority } from '@/types'
import { useToast } from '@/context/ToastContext'
import { getDomain } from '@/data/domains'

export function DashboardPage() {
  const { t, settings } = useApp()
  const { history, saved } = useLibrary()
  const { hasClientProvider } = useProviders()
  const { data: health, loading: healthLoading, error: healthError, refresh } = useHealth()
  const { items: news, loading: newsLoading, error: newsError, stale } = useNews()
  const { notify } = useToast()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)

  const [problem, setProblem] = useState('')
  const [category, setCategory] = useState<ProblemCategory>('windows-server')
  const [priority, setPriority] = useState<Priority>('medium')
  const [image, setImage] = useState<{ dataUrl: string; name: string; size: number } | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  const recentAnalyses = history.slice(0, 4)
  const recentSaved = saved.slice(0, 4)
  const recentDocs = useMemo(
    () => [...KNOWLEDGE_ARTICLES].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4),
    [],
  )
  const securityNews = news.filter((item) => item.critical || item.category === 'security').slice(0, 3)
  const latestNews = news.slice(0, 3)
  const aiConfigured = health?.services.ai.configured ?? false

  const go = (mode: 'analyze' | 'plan') => {
    if (!problem.trim()) {
      notify('warning', t('common.requiredField'))
      return
    }
    setLabDraft({
      description: problem,
      title: truncate(problem.split('\n')[0] ?? '', 90),
      category,
      priority,
      imageDataUrl: image?.dataUrl,
      imageName: image?.name,
    })
    navigate(mode === 'plan' ? '/lab?mode=plan' : '/lab')
  }

  return (
    <div className="animate-in">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<TerminalSquare className="h-4 w-4" />} onClick={() => navigate('/scripts')}>
              {t('nav.scripts')}
            </Button>
            <Button size="sm" icon={<Sparkles className="h-4 w-4" />} onClick={() => navigate('/lab')}>
              {t('nav.lab')}
            </Button>
          </>
        }
      />

      {!healthLoading && !aiConfigured && !hasClientProvider ? (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 sm:flex-row sm:items-center">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t('dashboard.noKeyTitle')}</p>
            <p className="text-xs text-muted">{t('dashboard.noKeyBody')}</p>
          </div>
          <Link to="/providers" className="btn btn-secondary shrink-0 text-xs">
            {t('dashboard.configureAi')}
          </Link>
        </div>
      ) : null}

      {/* Hero */}
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -end-24 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 start-1/3 h-56 w-56 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative grid gap-5 p-5 lg:grid-cols-[1.6fr_1fr] lg:p-6">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold sm:text-lg">{t('dashboard.problemHeading')}</h2>
            </div>
            <label htmlFor="problem-box" className="sr-only">
              {t('dashboard.problemHeading')}
            </label>
            <textarea
              id="problem-box"
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
              placeholder={t('dashboard.problemPlaceholder')}
              className="input-base min-h-32 resize-y text-sm leading-relaxed"
              maxLength={4000}
            />
            <div className="mt-1 flex justify-end text-[10px] text-subtle">{problem.length}/4000</div>

            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <div>
                <label htmlFor="dashboard-category" className="sr-only">
                  {t('lab.category')}
                </label>
                <Select id="dashboard-category" value={category} onChange={(event) => setCategory(event.target.value as ProblemCategory)}>
                  {(['windows-client', 'windows-server', 'printing', 'microsoft-365', 'networking', 'linux', 'cybersecurity', 'datacenter', 'backup-dr', 'cloud-devops', 'other'] as ProblemCategory[]).map((id) => (
                    <option key={id} value={id}>
                      {t(getDomain(id).labelKey)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="dashboard-priority" className="sr-only">
                  {t('lab.priority')}
                </label>
                <Select id="dashboard-priority" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
                  {(['low', 'medium', 'high', 'critical'] as Priority[]).map((id) => (
                    <option key={id} value={id}>
                      {t(`priority.${id}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                variant="secondary"
                icon={<ImagePlus className="h-4 w-4" />}
                onClick={() => fileInput.current?.click()}
                className="justify-center"
              >
                {t('dashboard.uploadImage')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  const result = await validateImageFile(file)
                  if (!result.ok) {
                    setImageError(
                      result.reason === 'size'
                        ? t('common.fileTooLarge', { max: 4 })
                        : result.reason === 'type'
                          ? t('common.unsupportedFile')
                          : t('lab.invalidImage'),
                    )
                    return
                  }
                  setImageError(null)
                  setImage({ dataUrl: result.dataUrl, name: file.name, size: file.size })
                }}
              />
            </div>
            {imageError ? (
              <p role="alert" className="mt-1 text-xs text-danger">
                {imageError}
              </p>
            ) : null}
            {image ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
                <img src={image.dataUrl} alt="" className="h-10 w-10 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{image.name}</p>
                  <p className="text-[10px] text-subtle">{formatBytes(image.size)}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setImage(null)}
                  aria-label={t('lab.removeImage')}
                />
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button icon={<Sparkles className="h-4 w-4" />} onClick={() => go('analyze')}>
                {t('dashboard.analyze')}
              </Button>
              <Button
                variant="secondary"
                icon={<Search className="h-4 w-4" />}
                onClick={() =>
                  navigate(problem.trim() ? `/research?q=${encodeURIComponent(truncate(problem, 180))}` : '/research')
                }
              >
                {t('dashboard.research')}
              </Button>
              <Button variant="secondary" icon={<ListChecks className="h-4 w-4" />} onClick={() => go('plan')}>
                {t('dashboard.plan')}
              </Button>
              <Button
                variant="secondary"
                icon={<TerminalSquare className="h-4 w-4" />}
                onClick={() => navigate(problem.trim() ? `/scripts?prompt=${encodeURIComponent(truncate(problem, 600))}` : '/scripts')}
              >
                {t('dashboard.script')}
              </Button>
              <Button variant="ghost" icon={<BookOpen className="h-4 w-4" />} onClick={() => navigate('/solutions')}>
                {t('dashboard.knowledge')}
              </Button>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-subtle">
              <ShieldAlert className="h-3.5 w-3.5" />
              {t('dashboard.analyzeHint')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-subtle">{t('dashboard.shortcuts')}</p>
            {[
              { to: '/lab', icon: Sparkles, label: t('nav.lab'), desc: t('dashboard.analyzeHint') },
              { to: '/toolkit?tool=subnet', icon: Wrench, label: t('tool.subnet.name'), desc: t('tool.subnet.desc') },
              { to: '/toolkit?tool=log', icon: FileText, label: t('tool.log.name'), desc: t('tool.log.desc') },
              { to: '/scripts', icon: TerminalSquare, label: t('nav.scripts'), desc: t('scripts.subtitle') },
            ].map((shortcut) => (
              <Link
                key={shortcut.to}
                to={shortcut.to}
                className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2/60 p-2.5 transition-colors hover:border-primary/40 hover:bg-surface-2"
              >
                <shortcut.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{shortcut.label}</p>
                  <p className="line-clamp-2 text-[10px] text-subtle">{shortcut.desc}</p>
                </div>
                <ArrowRight className="ms-auto mt-2 h-3 w-3 shrink-0 text-subtle rtl:rotate-180" />
              </Link>
            ))}
          </div>
        </div>
      </Card>

      {/* Stats — real local counts */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('knowledge.articleCount', { count: KNOWLEDGE_ARTICLES.length })} value={KNOWLEDGE_ARTICLES.length} hint={t('knowledge.contentNotice')} icon={<BookOpen className="h-4 w-4" />} tone="primary" />
        <Stat label={t('toolkit.title')} value={TOOLS.length} hint={t('toolkit.localNotice')} icon={<Wrench className="h-4 w-4" />} tone="accent" />
        <Stat label={t('nav.saved')} value={saved.length} hint={t('common.localOnly')} icon={<BookOpen className="h-4 w-4" />} tone="success" />
        <Stat label={t('nav.history')} value={history.length} hint={t('common.localOnly')} icon={<Clock3 className="h-4 w-4" />} tone="warning" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={t('dashboard.recentProblems')}
            icon={<Clock3 className="h-4 w-4" />}
            actions={<Link to="/history" className="text-xs text-primary hover:underline">{t('dashboard.viewAll')}</Link>}
          />
          <div className="divide-y divide-line">
            {recentAnalyses.length === 0 ? (
              <p className="p-5 text-sm text-muted">{t('dashboard.emptyHistory')}</p>
            ) : (
              recentAnalyses.map((entry) => (
                <Link key={entry.id} to={`/history?entry=${entry.id}`} className="flex items-start gap-3 p-4 transition-colors hover:bg-surface-2">
                  <span className="mt-0.5 rounded-md bg-surface-2 p-1.5 text-subtle">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{entry.summary}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-subtle">
                      <Badge tone="default">{t(getDomain(entry.category).labelKey)}</Badge>
                      <span>{formatDate(entry.createdAt, settings.language)}</span>
                    </div>
                  </div>
                  <Badge tone={entry.priority === 'critical' ? 'danger' : entry.priority === 'high' ? 'warning' : 'default'}>
                    {t(`priority.${entry.priority}`)}
                  </Badge>
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title={t('dashboard.serviceStatus')}
            icon={<Zap className="h-4 w-4" />}
            actions={
              <button type="button" onClick={refresh} className="text-xs text-primary hover:underline">
                {t('health.refresh')}
              </button>
            }
          />
          <div className="space-y-2.5 p-4 text-xs">
            {healthLoading ? (
              <p className="flex items-center gap-2 text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('dashboard.checking')}
              </p>
            ) : healthError || !health ? (
              <div>
                <StatusDot tone="danger" label={t('health.offline')} />
                <p className="mt-2 text-muted">{t('health.failed')}</p>
              </div>
            ) : (
              <>
                {[
                  { key: 'ai', label: t('health.ai'), ok: health.services.ai.configured, detail: health.services.ai.provider ?? '—' },
                  { key: 'vision', label: t('health.vision'), ok: health.services.vision.configured, detail: t('health.optional') },
                  { key: 'research', label: t('health.research'), ok: health.services.research.configured, detail: health.services.research.providers.join(', ') || t('health.offline') },
                  { key: 'news', label: t('health.news'), ok: true, detail: health.services.news.customFeeds ? 'custom' : 'default' },
                  { key: 'db', label: t('health.database'), ok: health.services.database.configured, detail: health.services.database.configured ? t('common.configured') : t('health.localFallback') },
                ].map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-2">
                    <span className="text-muted">{row.label}</span>
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone={row.ok ? 'success' : 'muted'} />
                      <span className={row.ok ? 'text-success' : 'text-subtle'}>{row.ok ? t('health.online') : t('health.offline')}</span>
                      {row.detail ? <span className="hidden text-[10px] text-subtle sm:inline">{row.detail}</span> : null}
                    </span>
                  </div>
                ))}
                <p className="pt-1 text-[10px] text-subtle">
                  {t('common.updated')}: {formatDate(health.time, settings.language)}
                </p>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader
            title={t('dashboard.savedSolutions')}
            icon={<BookOpen className="h-4 w-4" />}
            actions={<Link to="/saved" className="text-xs text-primary hover:underline">{t('dashboard.viewAll')}</Link>}
          />
          <div className="divide-y divide-line">
            {recentSaved.length === 0 ? (
              <p className="p-5 text-sm text-muted">{t('dashboard.emptySaved')}</p>
            ) : (
              recentSaved.map((item) => (
                <div key={item.id} className="flex items-start gap-2 p-3.5">
                  <span className="mt-0.5 text-subtle">
                    {item.kind === 'script' ? <TerminalSquare className="h-4 w-4" /> : item.kind === 'news' ? <Newspaper className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-medium">{item.title}</p>
                    <p className="mt-0.5 text-[10px] text-subtle">{t(`saved.kind.${item.kind}`)}</p>
                  </div>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary" aria-label={t('common.open')}>
                      <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title={t('dashboard.techNews')}
            icon={<Newspaper className="h-4 w-4" />}
            actions={<Link to="/news" className="text-xs text-primary hover:underline">{t('dashboard.viewAll')}</Link>}
          />
          <div className="divide-y divide-line">
            {newsError && news.length === 0 ? (
              <div className="p-4">
                <p className="text-xs text-muted">{t('news.apiError')}</p>
              </div>
            ) : newsLoading && news.length === 0 ? (
              <div className="p-4">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
            ) : latestNews.length === 0 ? (
              <div className="p-4">
                <p className="text-xs text-muted">{t('dashboard.emptyNews')}</p>
              </div>
            ) : (
              latestNews.map((item) => (
                <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="block p-3.5 hover:bg-surface-2">
                  <p className="line-clamp-2 text-xs font-medium">{item.title}</p>
                  <p className="mt-1 flex items-center gap-2 text-[10px] text-subtle">
                    <span>{item.source}</span>
                    <span>·</span>
                    <span>{formatDate(item.publishedAt, settings.language)}</span>
                  </p>
                </a>
              ))
            )}
            {stale ? <p className="px-3.5 pb-3 text-[10px] text-warning">{t('news.stale')}</p> : null}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('dashboard.securityAlerts')} icon={<ShieldAlert className="h-4 w-4" />} />
          <div className="divide-y divide-line">
            {securityNews.length === 0 ? (
              <p className="p-5 text-sm text-muted">{t('dashboard.emptyNews')}</p>
            ) : (
              securityNews.map((item) => (
                <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="block p-3.5 hover:bg-surface-2">
                  <p className="line-clamp-2 text-xs font-medium">{item.title}</p>
                  <p className="mt-1 text-[10px] text-subtle">{item.source} · {formatDate(item.publishedAt, settings.language)}</p>
                </a>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title={t('dashboard.newDocs')} icon={<FileText className="h-4 w-4" />} />
          <div className="divide-y divide-line">
            {recentDocs.map((article) => (
              <Link key={article.id} to={`/solutions/${article.slug}`} className="block p-3.5 hover:bg-surface-2">
                <p className="line-clamp-2 text-xs font-medium">{pickText(article.title, settings.language)}</p>
                <p className="mt-1 flex items-center gap-2 text-[10px] text-subtle">
                  <span>{t(getDomain(article.domain).labelKey)}</span>
                  <span>·</span>
                  <span>{t(`verification.${article.verification}`)}</span>
                </p>
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('dashboard.quickTools')} icon={<Wrench className="h-4 w-4" />} actions={<Link to="/toolkit" className="text-xs text-primary hover:underline">{t('dashboard.viewAll')}</Link>} />
          <div className="grid grid-cols-2 gap-2 p-3">
            {TOOLS.slice(0, 6).map((tool) => (
              <Link
                key={tool.id}
                to={`/toolkit?tool=${tool.id}`}
                className="rounded-lg border border-line bg-surface-2/50 p-2.5 text-xs font-medium transition-colors hover:border-primary/40"
              >
                <span className="line-clamp-2">{pickText(tool.name, settings.language)}</span>
                <span className="mt-1 block text-[10px] font-normal text-subtle">{t(`toolkit.${tool.category}`)}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('dashboard.aiUpdates')} icon={<Sparkles className="h-4 w-4" />} actions={<Link to="/radar" className="text-xs text-primary hover:underline">{t('dashboard.viewAll')}</Link>} />
          <div className="divide-y divide-line">
            {MODEL_CATALOG.slice(0, 4).map((model) => (
              <a key={model.id} href={model.reference} target="_blank" rel="noopener noreferrer" className="block p-3.5 hover:bg-surface-2">
                <p className="text-xs font-medium">{model.name}</p>
                <p className="mt-0.5 text-[10px] text-subtle">{model.provider} · {model.kind} · {t('radar.verifyNotice').split('.')[0]}</p>
              </a>
            ))}
          </div>
        </Card>
      </div>

      {healthError ? (
        <div className="mt-4">
          <ErrorState title={t('health.failed')} description={t('news.apiError')} onRetry={refresh} retryLabel={t('common.retry')} />
        </div>
      ) : null}
    </div>
  )
}

export default DashboardPage

