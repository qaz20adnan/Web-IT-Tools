import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Cpu,
  FileText,
  ImagePlus,
  Newspaper,
  Pin,
  Search,
  Server,
  Shield,
  ShieldAlert,
  Sparkles,
  Star,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { Badge, Button, ErrorState, Select, Skeleton, StatusDot } from '@/components/ui'
import { AnimatedCounter } from '@/components/dashboard/AnimatedCounter'
import { HeroNetwork } from '@/components/dashboard/HeroNetwork'
import { BarChart, DonutChart, LineChart, Sparkline } from '@/components/charts'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { useDiagnostics, buildDiagnosticAnalytics, diagnosticToolLabel } from '@/context/DiagnosticsContext'
import { useLibrary } from '@/context/LibraryContext'
import { useProviders } from '@/context/ProvidersContext'
import { useToast } from '@/context/ToastContext'
import { useHealth } from '@/hooks/useHealth'
import { useNews } from '@/hooks/useNews'
import { DIAGNOSTIC_CATEGORIES, DIAGNOSTIC_TOOLS, SECONDARY_TOOLS, type DiagnosticCategory } from '@/data/diagnosticTools'
import { KNOWLEDGE_ARTICLES } from '@/data/knowledge'
import { TOOLS } from '@/data/tools'
import { getDomain } from '@/data/domains'
import { loadKnowledgeBase } from '@/services/knowledge-base'
import { setLabDraft } from '@/lib/draft'
import { formatBytes, safeExternalUrl, truncate, validateImageFile } from '@/lib/utils'
import { formatDate, formatDateTime, pickText } from '@/i18n'
import type { ProblemCategory, Priority } from '@/types'

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

function relativeTime(iso: string, lang: 'en' | 'ar'): string {
  const value = new Date(iso).getTime()
  if (Number.isNaN(value)) return '—'
  const diffMinutes = Math.round((value - Date.now()) / 60_000)
  const formatter = new Intl.RelativeTimeFormat(lang === 'ar' ? 'ar' : 'en', { numeric: 'auto' })
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute')
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour')
  return formatter.format(Math.round(diffHours / 24), 'day')
}

export function DashboardPage() {
  const { t, settings } = useApp()
  const { account } = useAuth()
  const { history, saved } = useLibrary()
  const { hasClientProvider } = useProviders()
  const { data: health, loading: healthLoading, error: healthError, refresh } = useHealth()
  const { items: news, loading: newsLoading, error: newsError, stale } = useNews()
  const { records, favorites, toggleFavorite } = useDiagnostics()
  const { notify } = useToast()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const L = useCallback((en: string, ar: string) => (settings.language === 'ar' ? ar : en), [settings.language])

  const [problem, setProblem] = useState('')
  const [category, setCategory] = useState<ProblemCategory>('windows-server')
  const [priority, setPriority] = useState<Priority>('medium')
  const [image, setImage] = useState<{ dataUrl: string; name: string; size: number } | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [toolQuery, setToolQuery] = useState('')
  const [toolCategory, setToolCategory] = useState<'all' | DiagnosticCategory>('all')
  const [showAllTools, setShowAllTools] = useState(false)
  const [dismissedWelcome, setDismissedWelcome] = useState(() => {
    try {
      return localStorage.getItem('nexora.welcome.dismissed') === '1'
    } catch {
      return false
    }
  })

  const trial = account?.trial ?? null
  const aiConfigured = health?.services.ai.configured ?? false
  const analytics = useMemo(() => buildDiagnosticAnalytics(records), [records])
  const localKnowledge = useMemo(() => loadKnowledgeBase(), [])
  const latestScan = records[0] ?? null

  const serviceRows = useMemo(() => {
    if (!health) return []
    return [
      { key: 'ai', label: L('AI engine', 'محرك الذكاء الاصطناعي'), ok: health.services.ai.configured, detail: health.services.ai.provider ?? L('Not configured', 'غير مهيأ') },
      { key: 'vision', label: L('Vision input', 'إدخال الصور'), ok: health.services.vision.configured, detail: health.services.vision.configured ? L('Configured', 'مهيأ') : L('Optional', 'اختياري') },
      { key: 'research', label: L('Research providers', 'مزودو البحث'), ok: health.services.research.configured, detail: health.services.research.providers.join(', ') || L('None', 'لا يوجد') },
      { key: 'db', label: L('Database', 'قاعدة البيانات'), ok: health.services.database.configured, detail: health.services.database.configured ? L('Configured', 'مهيأ') : L('Local fallback', 'تخزين محلي') },
    ]
  }, [health, L])

  const configuredCount = serviceRows.filter((row) => row.ok).length
  const categoryStats = useMemo(() => {
    const counts = new Map<ProblemCategory, number>()
    history.forEach((entry) => counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1))
    return [...counts.entries()]
      .map(([id, count]) => ({ label: t(getDomain(id).labelKey), value: count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [history, t])

  const donutData = categoryStats.length > 0 ? categoryStats : analytics.byTool.slice(0, 6).map((entry) => ({ label: entry.label, value: entry.count }))

  const recentEvents = useMemo(() => {
    const diagItems = records.slice(0, 5).map((entry) => ({
      id: entry.id,
      title: `${diagnosticToolLabel(entry.tool)} · ${entry.target}`,
      summary: entry.summary,
      createdAt: entry.createdAt,
      status: entry.status,
      kind: 'diagnostic' as const,
    }))
    const historyItems = history.slice(0, 3).map((entry) => ({
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      createdAt: entry.createdAt,
      status: 'success' as const,
      kind: 'analysis' as const,
    }))
    return [...diagItems, ...historyItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 7)
  }, [records, history])

  const latestKnowledge = useMemo(
    () =>
      [...KNOWLEDGE_ARTICLES]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 4)
        .map((article) => ({
          id: article.id,
          title: pickText(article.title, settings.language),
          summary: pickText(article.summary, settings.language),
          domain: t(getDomain(article.domain).labelKey),
          verification: t(`verification.${article.verification}`),
          slug: article.slug,
          updatedAt: article.updatedAt,
        })),
    [settings.language, t],
  )

  const filteredTools = useMemo(() => {
    const all = showAllTools ? [...DIAGNOSTIC_TOOLS, ...SECONDARY_TOOLS] : DIAGNOSTIC_TOOLS
    const term = toolQuery.trim().toLowerCase()
    return all
      .filter((tool) => toolCategory === 'all' || tool.category === toolCategory)
      .filter((tool) => {
        if (!term) return true
        return (
          pickText(tool.name, settings.language).toLowerCase().includes(term) ||
          pickText(tool.description, settings.language).toLowerCase().includes(term)
        )
      })
      .sort((a, b) => {
        const favA = favorites.includes(a.id) ? 1 : 0
        const favB = favorites.includes(b.id) ? 1 : 0
        return favB - favA
      })
  }, [showAllTools, toolQuery, toolCategory, favorites, settings.language])

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

  const newsUpdated = news[0]?.fetchedAt ?? null

  return (
    <div className="nx-page animate-in">
      {trial?.expired !== true && !dismissedWelcome ? (
        <div className="nx-panel nx-reveal flex flex-wrap items-center justify-between gap-2 border-primary/20 bg-primary/5 px-3.5 py-2">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate">
              {trial?.endingSoon
                ? t('auth.trialEnding', { days: trial.daysRemaining })
                : trial
                  ? t('auth.trialActive', { days: trial.daysRemaining })
                  : t('auth.trialActive', { days: 30 })}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Link to="/account" className="text-[11px] font-semibold text-primary hover:underline">
              {t('auth.account')}
            </Link>
            <button
              type="button"
              onClick={() => {
                setDismissedWelcome(true)
                try {
                  localStorage.setItem('nexora.welcome.dismissed', '1')
                } catch {
                  /* ignore */
                }
              }}
              className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-text"
              aria-label={t('welcome.dismiss')}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : null}

      {!healthLoading && !aiConfigured && !hasClientProvider ? (
        <div className="nx-reveal flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-2.5">
          <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">{t('dashboard.noKeyTitle')}</p>
            <p className="text-[11px] text-muted">{t('dashboard.noKeyBody')}</p>
          </div>
          <Link to="/providers" className="btn btn-secondary text-[11px]">
            {t('dashboard.configureAi')}
          </Link>
        </div>
      ) : null}

      {/* Hero */}
      <section className="nx-hero nx-reveal p-5 sm:p-7 lg:p-9" aria-labelledby="dashboard-hero-title">
        <HeroNetwork />
        <div className="nx-scanline" aria-hidden />
        <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="nx-eyebrow">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {t('app.name')}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-subtle" dir="auto">
                {t('app.shortTagline')}
              </span>
            </div>

            <h1 id="dashboard-hero-title" className="nx-display mt-4">
              {L('Your intelligent hub for ', 'مركزك الذكي ') }
              <span className="nx-gradient-text">{L('technical diagnostics', 'لتشخيص المشكلات التقنية')}</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
              {L(
                'Analyze incidents, inspect networks, review logs and find reliable solutions from one place.',
                'حلّل الأعطال، افحص الشبكات، استكشف السجلات، واعثر على الحلول الموثوقة من مكان واحد.',
              )}
            </p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80" dir="auto">
              {t('app.tagline')}
            </p>

            <div className="mt-5 rounded-xl border border-line-strong/70 bg-[#06131f]/80 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
              <label htmlFor="problem-box" className="sr-only">
                {t('dashboard.problemHeading')}
              </label>
              <textarea
                id="problem-box"
                value={problem}
                onChange={(event) => setProblem(event.target.value)}
                placeholder={t('dashboard.problemPlaceholder')}
                className="min-h-[92px] w-full resize-y border-0 bg-transparent px-2 py-1.5 text-sm leading-relaxed text-text outline-none placeholder:text-subtle"
                maxLength={4000}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-1 pt-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Select
                    aria-label={t('lab.category')}
                    value={category}
                    onChange={(event) => setCategory(event.target.value as ProblemCategory)}
                    className="w-auto! py-1! text-[11px]!"
                  >
                    {CATEGORIES.map((id) => (
                      <option key={id} value={id}>
                        {t(getDomain(id).labelKey)}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label={t('lab.priority')}
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as Priority)}
                    className="w-auto! py-1! text-[11px]!"
                  >
                    {(['low', 'medium', 'high', 'critical'] as Priority[]).map((id) => (
                      <option key={id} value={id}>
                        {t(`priority.${id}`)}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-subtle hover:bg-surface-2 hover:text-text"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    {t('dashboard.uploadImage')}
                  </button>
                  <span className="text-[10px] text-subtle">{problem.length}/4000</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => navigate(problem.trim() ? `/research?q=${encodeURIComponent(truncate(problem, 180))}` : '/research')}
                    className="hidden rounded-md px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-text sm:inline-flex"
                  >
                    {t('dashboard.research')}
                  </button>
                  <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => go('analyze')}>
                    {L('Start diagnosis', 'ابدأ التشخيص')}
                  </Button>
                </div>
              </div>
            </div>
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
            {imageError ? (
              <p role="alert" className="mt-1 text-xs text-danger">
                {imageError}
              </p>
            ) : null}
            {image ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
                <img src={image.dataUrl} alt="" className="h-9 w-9 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium">{image.name}</p>
                  <p className="text-[10px] text-subtle">{formatBytes(image.size)}</p>
                </div>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setImage(null)} aria-label={t('lab.removeImage')} />
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/diagnostics" className="btn btn-secondary text-xs">
                <Activity className="h-3.5 w-3.5" /> {L('Check the network', 'افحص الشبكة')}
              </Link>
              <Link to="/solutions" className="btn btn-secondary text-xs">
                <BookOpen className="h-3.5 w-3.5" /> {L('Search the knowledge base', 'ابحث في قاعدة المعرفة')}
              </Link>
              <button type="button" className="btn btn-ghost text-xs" onClick={() => go('plan')}>
                <Zap className="h-3.5 w-3.5" /> {t('dashboard.plan')}
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => navigate(problem.trim() ? `/scripts?prompt=${encodeURIComponent(truncate(problem, 600))}` : '/scripts')}
              >
                <TerminalSquare className="h-3.5 w-3.5" /> {t('dashboard.script')}
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-subtle">{L('Quick checks', 'فحوص سريعة')}</span>
              {[
                { id: 'latency', label: L('Latency', 'الزمن') },
                { id: 'path', label: L('Path', 'المسار') },
                { id: 'dns', label: 'DNS' },
                { id: 'ports', label: L('Ports', 'المنافذ') },
                { id: 'ssl', label: 'SSL' },
              ].map((shortcut) => (
                <Link key={shortcut.id} to={`/diagnostics?tool=${shortcut.id}`} className="nx-chip nx-chip-button">
                  {shortcut.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Signal board */}
          <aside className="nx-panel nx-panel-glow flex min-w-0 flex-col overflow-hidden bg-[#081826]/85" aria-label={L('Signal board', 'لوحة المؤشرات')}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">{L('Signal board', 'لوحة المؤشرات')}</p>
                <p className="text-[10px] text-subtle">{L('Platform readiness from live health checks', 'جاهزية المنصة من فحوص الحالة الحية')}</p>
              </div>
              <button type="button" onClick={refresh} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-text" aria-label={t('health.refresh')}>
                <Activity className={`h-3.5 w-3.5 ${healthLoading ? 'animate-pulse' : ''}`} />
              </button>
            </div>
            <div className="space-y-2 px-4 py-3">
              {healthLoading ? (
                <>
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-full" />
                </>
              ) : healthError || !health ? (
                <div className="rounded-lg border border-warning/25 bg-warning/5 p-2.5">
                  <p className="text-[11px] font-semibold text-warning">{L('Health endpoint unavailable', 'مسار الحالة غير متاح')}</p>
                  <p className="mt-0.5 text-[10px] text-subtle">{L('Local tools still work without the platform API.', 'الأدوات المحلية تعمل دون واجهة المنصة.')}</p>
                </div>
              ) : (
                serviceRows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5 text-muted">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.ok ? 'bg-success' : 'bg-subtle'}`} />
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className={`shrink-0 text-[10px] font-semibold ${row.ok ? 'text-success' : 'text-subtle'}`}>{row.detail}</span>
                  </div>
                ))
              )}
            </div>
            <div className="mt-auto border-t border-line bg-[#06121d]/60 px-4 py-3">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-subtle">{L('Diagnostic activity', 'نشاط التشخيص')}</p>
                  <p className="text-lg font-bold tabular-nums">
                    <AnimatedCounter value={analytics.total} /> <span className="text-[10px] font-medium text-subtle">{L('checks', 'فحصًا')}</span>
                  </p>
                </div>
                <span className="text-[10px] text-subtle">{analytics.todayCount} {L('today', 'اليوم')}</span>
              </div>
              {analytics.total > 0 ? (
                <Sparkline values={analytics.activity.map((entry) => entry.count)} className="mt-1" />
              ) : (
                <div className="mt-2 h-8 rounded border border-dashed border-line" aria-hidden />
              )}
              <p className="mt-1 text-[10px] text-subtle">
                {health ? `${L('Health checked', 'فُحصت الحالة')} ${relativeTime(health.time, settings.language)}` : L('Health not checked', 'لم تُفحص الحالة')}
              </p>
              <Link to="/diagnostics" className="mt-2 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/15">
                {L('Open Diagnostics Lab', 'فتح مختبر التشخيص')}
                <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
              </Link>
            </div>
          </aside>
        </div>
      </section>

      {/* Live monitoring */}
      <section aria-labelledby="monitoring-title">
        <div className="nx-section-head nx-reveal nx-reveal-1 mb-2.5">
          <div>
            <p className="nx-section-kicker">{L('Monitoring', 'المراقبة')}</p>
            <h2 id="monitoring-title" className="nx-section-title">{L('Platform at a glance', 'المنصة في لمحة')}</h2>
          </div>
          <span className="text-[10px] text-subtle">{L('Only real values from this workspace and the health endpoint are shown.', 'تُعرض قيم حقيقية فقط من مساحة العمل ومسار الحالة.')}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          {[
            {
              key: 'diagnostics',
              label: L('Diagnostic runs', 'عمليات التشخيص'),
              value: analytics.total,
              hint: analytics.todayCount > 0 ? `${analytics.todayCount} ${L('today', 'اليوم')}` : L('Stored in this browser', 'محفوظة في هذا المتصفح'),
              icon: Activity,
              accent: 'var(--cyan)',
            },
            {
              key: 'services',
              label: L('Configured services', 'الخدمات المهيأة'),
              value: health ? configuredCount : 0,
              suffix: health ? `/ ${serviceRows.length}` : '',
              hint: healthLoading ? L('Checking…', 'جارٍ الفحص…') : healthError ? L('Unavailable', 'غير متاح') : L('From health endpoint', 'من مسار الحالة'),
              icon: Shield,
              accent: 'var(--teal)',
            },
            {
              key: 'tools',
              label: L('Available tools', 'الأدوات المتاحة'),
              value: DIAGNOSTIC_TOOLS.length + SECONDARY_TOOLS.length,
              hint: `${TOOLS.length} ${L('local utilities', 'أداة محلية')}`,
              icon: Wrench,
              accent: 'var(--gold)',
            },
            {
              key: 'knowledge',
              label: L('Knowledge articles', 'مقالات المعرفة'),
              value: KNOWLEDGE_ARTICLES.length,
              hint: `${localKnowledge.length} ${L('personal notes', 'ملاحظة شخصية')}`,
              icon: BookOpen,
              accent: '#8ea7ff',
            },
            {
              key: 'news',
              label: L('News articles', 'الأخبار التقنية'),
              value: news.length,
              hint: newsUpdated ? `${L('Updated', 'آخر تحديث')} ${relativeTime(newsUpdated, settings.language)}` : L('Not fetched yet', 'لم تُجلب بعد'),
              icon: Newspaper,
              accent: '#f07f9a',
            },
            {
              key: 'last-scan',
              label: L('Last check', 'آخر فحص'),
              value: latestScan ? diagnosticToolLabel(latestScan.tool) : '—',
              hint: latestScan ? `${latestScan.target} · ${relativeTime(latestScan.createdAt, settings.language)}` : L('Run a diagnostic to populate', 'نفّذ فحصًا لتعبئتها'),
              icon: Clock3,
              accent: latestScan?.status === 'success' ? 'var(--teal)' : latestScan ? 'var(--gold)' : 'var(--subtle)',
              compact: true,
            },
          ].map((metric, index) => (
            <div key={metric.key} className={`nx-kpi nx-reveal nx-reveal-${Math.min(5, index + 1)}`} style={{ ['--kpi-accent' as string]: metric.accent }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">{metric.label}</p>
                  <p className={`mt-1.5 truncate font-bold tabular-nums ${metric.compact ? 'text-lg' : 'text-2xl'}`}>
                    {typeof metric.value === 'number' ? <AnimatedCounter value={metric.value} /> : metric.value}
                    {metric.suffix ? <span className="ms-1 text-xs font-medium text-subtle">{metric.suffix}</span> : null}
                  </p>
                </div>
                <span className="nx-kpi-icon">
                  <metric.icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-1 line-clamp-1 text-[10px] text-subtle" title={metric.hint}>{metric.hint}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Charts */}
      <section aria-labelledby="charts-title">
        <div className="nx-section-head nx-reveal nx-reveal-1 mb-2.5">
          <div>
            <p className="nx-section-kicker">{L('Analytics', 'التحليلات')}</p>
            <h2 id="charts-title" className="nx-section-title">{L('Diagnostic intelligence', 'ذكاء التشخيص')}</h2>
          </div>
          <Link to="/diagnostics" className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
            {L('Open Network Health', 'فتح صحة الشبكة')} <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid gap-2.5 xl:grid-cols-3">
          <div className="nx-chart-card nx-reveal nx-reveal-2 xl:col-span-2">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="nx-chart-title">{L('Diagnostic activity', 'نشاط التشخيص')}</p>
                <p className="nx-chart-sub">{L('Checks per day · last 14 days', 'الفحوص اليومية · آخر 14 يومًا')}</p>
              </div>
              <span className="nx-chip">{analytics.total} {L('total', 'إجمالي')}</span>
            </div>
            {records.length === 0 ? (
              <div className="nx-empty min-h-[190px]">
                <Activity className="h-5 w-5" />
                <p className="max-w-xs text-[11px] leading-relaxed">{L('No diagnostic data yet. Run a latency, path, DNS or another check and the chart updates automatically.', 'لا توجد بيانات تشخيص بعد. نفّذ فحص زمن أو مسار أو DNS أو غير ذلك وسيتحدث الرسم تلقائيًا.')}</p>
                <Link to="/diagnostics" className="mt-1 text-[11px] font-semibold text-primary hover:underline">{L('Run the first check', 'نفّذ أول فحص')}</Link>
              </div>
            ) : (
              <LineChart
                ariaLabel={L('Diagnostic activity over the last 14 days', 'نشاط التشخيص خلال آخر 14 يومًا')}
                lang={settings.language}
                series={[
                  {
                    id: 'activity',
                    label: L('Checks', 'الفحوص'),
                    color: '#35d6f2',
                    points: analytics.activity.map((entry) => ({ label: entry.label, value: entry.count })),
                  },
                ]}
              />
            )}
          </div>

          <div className="nx-chart-card nx-reveal nx-reveal-3">
            <div className="mb-3">
              <p className="nx-chart-title">{categoryStats.length > 0 ? L('Problems by category', 'المشكلات حسب التصنيف') : L('Checks by tool', 'الفحوص حسب الأداة')}</p>
              <p className="nx-chart-sub">{categoryStats.length > 0 ? L('From your analysis history', 'من سجل تحليلاتك') : L('From stored diagnostic runs', 'من عمليات التشخيص المحفوظة')}</p>
            </div>
            <DonutChart
              ariaLabel={L('Distribution chart', 'رسم التوزيع')}
              lang={settings.language}
              data={donutData}
              centerLabel={L('total', 'إجمالي')}
              emptyLabel={L('No distribution data yet. Analyses and diagnostics will appear here.', 'لا توجد بيانات توزيع بعد. ستظهر التحليلات والتشخيصات هنا.')}
            />
          </div>

          <div className="nx-chart-card nx-reveal nx-reveal-2">
            <div className="mb-3">
              <p className="nx-chart-title">{L('Most used tools', 'الأدوات الأكثر استخدامًا')}</p>
              <p className="nx-chart-sub">{L('Based on stored diagnostic records', 'بناءً على سجلات التشخيص المحفوظة')}</p>
            </div>
            <BarChart
              ariaLabel={L('Most used diagnostic tools', 'الأدوات التشخيصية الأكثر استخدامًا')}
              lang={settings.language}
              data={analytics.byTool.slice(0, 6).map((entry) => ({ label: entry.label, value: entry.count }))}
              emptyLabel={L('Run a few checks to compare tool usage.', 'نفّذ بعض الفحوص لمقارنة استخدام الأدوات.')}
            />
          </div>

          <div className="nx-chart-card nx-reveal nx-reveal-3">
            <div className="mb-3">
              <p className="nx-chart-title">{L('Result reliability', 'موثوقية النتائج')}</p>
              <p className="nx-chart-sub">{L('Success vs. non-success diagnostic records', 'النتائج الناجحة مقابل غير الناجحة')}</p>
            </div>
            {analytics.successRate === null ? (
              <div className="nx-empty min-h-[150px]">
                <CheckCircle2 className="h-5 w-5" />
                <p className="text-[11px]">{L('No completed checks recorded yet.', 'لا توجد فحوص مكتملة بعد.')}</p>
              </div>
            ) : (
              <div className="flex h-full flex-col justify-center gap-4">
                <div className="text-center">
                  <p className="text-4xl font-bold tabular-nums text-success">
                    <AnimatedCounter value={analytics.successRate} format={(value) => `${value}%`} />
                  </p>
                  <p className="text-[10px] text-subtle">{L('success rate', 'معدل النجاح')}</p>
                </div>
                <div className="nx-progress">
                  <span style={{ width: `${analytics.successRate}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg border border-line bg-surface-2/60 p-2">
                    <p className="text-sm font-bold tabular-nums">{records.filter((entry) => entry.status === 'success').length}</p>
                    <p className="text-[10px] text-subtle">{L('Success', 'ناجح')}</p>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-2/60 p-2">
                    <p className="text-sm font-bold tabular-nums">{records.filter((entry) => entry.status !== 'success').length}</p>
                    <p className="text-[10px] text-subtle">{L('Needs review', 'يحتاج مراجعة')}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="nx-chart-card nx-reveal nx-reveal-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="nx-chart-title">{L('Recent checks', 'الفحوص الأخيرة')}</p>
                <p className="nx-chart-sub">{L('Latest recorded events', 'أحدث الأحداث المحفوظة')}</p>
              </div>
              <Link to="/history" className="text-[10px] font-semibold text-primary hover:underline">{t('dashboard.viewAll')}</Link>
            </div>
            {recentEvents.length === 0 ? (
              <div className="nx-empty min-h-[150px]">
                <Clock3 className="h-5 w-5" />
                <p className="text-[11px]">{L('Nothing recorded yet. Diagnostics and analyses appear here.', 'لا يوجد سجل بعد. ستظهر التشخيصات والتحليلات هنا.')}</p>
              </div>
            ) : (
              <ol className="space-y-2">
                {recentEvents.slice(0, 5).map((event) => (
                  <li key={event.id} className="flex items-start gap-2">
                    <span className="nx-timeline-dot mt-0.5">
                      {event.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <CircleAlert className="h-3.5 w-3.5 text-warning" />}
                    </span>
                    <div className="min-w-0 flex-1 border-b border-line/70 pb-2 last:border-0">
                      <p className="truncate text-[11px] font-semibold" title={event.title}>{event.title}</p>
                      <p className="line-clamp-1 text-[10px] text-subtle">{event.summary}</p>
                      <p className="mt-0.5 text-[9px] text-subtle">
                        {event.kind === 'diagnostic' ? L('Diagnostic', 'تشخيص') : L('AI analysis', 'تحليل ذكي')} · {relativeTime(event.createdAt, settings.language)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>

      {/* Quick tools */}
      <section aria-labelledby="tools-title">
        <div className="nx-section-head nx-reveal nx-reveal-1 mb-2.5">
          <div>
            <p className="nx-section-kicker">{L('Tool center', 'مركز الأدوات')}</p>
            <h2 id="tools-title" className="nx-section-title">{L('Quick diagnostics', 'أدوات التشخيص السريعة')}</h2>
            <p className="text-[11px] text-subtle">{L('Server-side checks run on the platform backend. Browser tools never upload your files.', 'الفحوص الخادمية تُنفذ على خادم المنصة. الأدوات المحلية لا ترفع ملفاتك.')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
              <input
                value={toolQuery}
                onChange={(event) => setToolQuery(event.target.value)}
                placeholder={L('Filter tools…', 'تصفية الأدوات…')}
                className="input-base w-40! py-1.5! ps-7! text-[11px]! sm:w-52!"
                aria-label={L('Filter tools', 'تصفية الأدوات')}
              />
            </div>
            <button type="button" onClick={() => setShowAllTools((current) => !current)} className="nx-chip nx-chip-button">
              {showAllTools ? L('Primary tools', 'الأدوات الأساسية') : L('All tools', 'كل الأدوات')}
            </button>
          </div>
        </div>
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          <button type="button" className="nx-chip nx-chip-button" data-active={toolCategory === 'all'} onClick={() => setToolCategory('all')}>
            {t('common.all')}
          </button>
          {DIAGNOSTIC_CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="nx-chip nx-chip-button"
              data-active={toolCategory === entry.id}
              onClick={() => setToolCategory(entry.id)}
            >
              {pickText(entry.label, settings.language)}
            </button>
          ))}
        </div>
        {filteredTools.length === 0 ? (
          <div className="nx-empty py-8">
            <Wrench className="h-5 w-5" />
            <p className="text-[11px]">{L('No tools match this filter.', 'لا توجد أدوات تطابق هذا الفلتر.')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {filteredTools.map((tool, index) => {
              const favorite = favorites.includes(tool.id)
              return (
                <div key={tool.id} className={`nx-tool-tile nx-reveal nx-reveal-${Math.min(5, (index % 5) + 1)}`} style={{ ['--tool-accent' as string]: tool.category === 'security' ? 'var(--gold)' : tool.category === 'ai' ? '#8ea7ff' : tool.category === 'systems' ? 'var(--teal)' : 'var(--cyan)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="nx-tool-icon">
                      <tool.icon className="h-4 w-4" />
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(tool.id)}
                      className={`rounded p-1 transition-colors ${favorite ? 'text-warning' : 'text-subtle hover:bg-surface-3 hover:text-text'}`}
                      aria-label={favorite ? L('Unpin tool', 'إلغاء تثبيت الأداة') : L('Pin tool', 'تثبيت الأداة')}
                      aria-pressed={favorite}
                    >
                      {favorite ? <Star className="h-3.5 w-3.5 fill-current" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Link to={tool.route} className="min-w-0">
                    <h3 className="truncate text-xs font-bold">{pickText(tool.name, settings.language)}</h3>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-subtle">{pickText(tool.description, settings.language)}</p>
                  </Link>
                  <div className="mt-auto flex items-center justify-between gap-1 pt-1">
                    <span className={`text-[9px] font-semibold uppercase tracking-wider ${tool.execution === 'server' ? 'text-primary' : tool.execution === 'browser' ? 'text-success' : 'text-warning'}`}>
                      {tool.execution === 'server' ? L('Server', 'خادم') : tool.execution === 'browser' ? L('Browser', 'متصفح') : L('External AI', 'ذكاء خارجي')}
                    </span>
                    <ChevronRight className="nx-tile-cue h-3 w-3 text-subtle rtl:rotate-180" />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* News + knowledge */}
      <section className="grid gap-2.5 xl:grid-cols-[1.15fr_1fr]">
        <div className="nx-panel nx-reveal nx-reveal-2 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <p className="nx-section-kicker">{L('Tech pulse', 'النبض التقني')}</p>
              <h2 className="nx-section-title">{L('Latest technology news', 'أحدث الأخبار التقنية')}</h2>
            </div>
            <Link to="/news" className="text-[10px] font-semibold text-primary hover:underline">{t('dashboard.viewAll')}</Link>
          </div>
          <div className="divide-y divide-line">
            {newsLoading && news.length === 0 ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : newsError && news.length === 0 ? (
              <div className="p-4">
                <ErrorState title={t('news.apiError')} description={L('News feeds are fetched by the backend. Check the deployment configuration.', 'تُجلب الأخبار عبر الخادم. تحقق من إعدادات النشر.')} />
              </div>
            ) : news.length === 0 ? (
              <div className="nx-empty m-4">
                <Newspaper className="h-5 w-5" />
                <p className="text-[11px]">{t('dashboard.emptyNews')}</p>
              </div>
            ) : (
              news.slice(0, 4).map((item) => {
                const url = safeExternalUrl(item.url)
                return (
                  <a
                    key={item.id}
                    href={url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block px-4 py-3 transition-colors hover:bg-surface-2/60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-xs font-semibold group-hover:text-primary">{item.title}</p>
                      {item.critical ? <Badge tone="danger">{L('Critical', 'حرج')}</Badge> : null}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-subtle">
                      <span>{item.source}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDate(item.publishedAt ?? item.fetchedAt, settings.language)}</span>
                      <span aria-hidden>·</span>
                      <span className="capitalize">{item.category}</span>
                    </p>
                  </a>
                )
              })
            )}
          </div>
          {stale ? <p className="border-t border-line px-4 py-2 text-[10px] text-warning">{t('news.stale')}</p> : null}
        </div>

        <div className="nx-panel nx-reveal nx-reveal-3 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <p className="nx-section-kicker">{L('Knowledge', 'المعرفة')}</p>
              <h2 className="nx-section-title">{L('Solutions and guides', 'الحلول والأدلة')}</h2>
            </div>
            <Link to="/solutions" className="text-[10px] font-semibold text-primary hover:underline">{t('dashboard.viewAll')}</Link>
          </div>
          <div className="divide-y divide-line">
            {latestKnowledge.map((article) => (
              <Link key={article.id} to={`/solutions/${article.slug}`} className="group block px-4 py-3 transition-colors hover:bg-surface-2/60">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-1 text-xs font-semibold group-hover:text-primary">{article.title}</p>
                  <ArrowUpRight className="h-3 w-3 shrink-0 text-subtle" />
                </div>
                <p className="mt-0.5 line-clamp-1 text-[10px] text-subtle">{article.summary}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="nx-chip py-0! text-[9px]!">{article.domain}</span>
                  <span className="text-[9px] text-success">{article.verification}</span>
                  <span className="text-[9px] text-subtle">· {formatDate(article.updatedAt, settings.language)}</span>
                </div>
              </Link>
            ))}
            {localKnowledge.slice(0, 2).map((entry) => (
              <Link key={entry.id} to="/kb" className="group block px-4 py-3 transition-colors hover:bg-surface-2/60">
                <p className="line-clamp-1 text-xs font-semibold group-hover:text-primary">{entry.title}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-subtle">
                  <FileText className="h-3 w-3" /> {L('Personal knowledge base', 'قاعدة معرفتك الشخصية')} · {formatDate(entry.updatedAt, settings.language)}
                </p>
              </Link>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
            <span className="text-[10px] text-subtle">{saved.length} {L('saved items', 'عنصر محفوظ')}</span>
            <Link to="/saved" className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline">
              {L('Saved library', 'المكتبة المحفوظة')} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
            </Link>
          </div>
        </div>
      </section>

      {/* AI shortcuts + system status detail */}
      <section className="grid gap-2.5 lg:grid-cols-3">
        <Link to="/copilot" className="nx-panel nx-reveal group flex items-start gap-3 p-4 transition-colors hover:border-primary/40">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="text-xs font-bold">{L('AI Technical Copilot', 'المساعد التقني الذكي')}</p>
            <p className="mt-0.5 text-[10px] text-subtle">{L('Test hypotheses and get evidence-based next steps.', 'اختبر الفرضيات واحصل على خطوات مبنية على الأدلة.')}</p>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-primary">{L('Open copilot', 'فتح المساعد')} <ArrowRight className="h-3 w-3 rtl:rotate-180" /></span>
          </div>
        </Link>
        <Link to="/toolkit" className="nx-panel nx-reveal nx-reveal-1 group flex items-start gap-3 p-4 transition-colors hover:border-primary/40">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><Cpu className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="text-xs font-bold">{L('Engineering Toolkit', 'صندوق الأدوات الهندسي')}</p>
            <p className="mt-0.5 text-[10px] text-subtle">{L('Subnetting, hashing, encoders, CVSS and much more.', 'تقسيم الشبكات والتجزئة والترميز وCVSS والمزيد.')}</p>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-primary">{t('nav.toolkit')} <ArrowRight className="h-3 w-3 rtl:rotate-180" /></span>
          </div>
        </Link>
        <div className="nx-panel nx-reveal nx-reveal-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-subtle" />
              <p className="text-xs font-bold">{t('dashboard.serviceStatus')}</p>
            </div>
            <button type="button" onClick={refresh} className="text-[10px] font-semibold text-primary hover:underline">{t('health.refresh')}</button>
          </div>
          {healthError ? (
            <p className="mt-2 text-[10px] text-warning">{L('Health endpoint unavailable.', 'مسار الحالة غير متاح.')}</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {serviceRows.slice(0, 4).map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-2 text-[10px]">
                  <StatusDot tone={row.ok ? 'success' : 'muted'} label={row.label} />
                  <span className="truncate text-subtle">{row.detail}</span>
                </div>
              ))}
              <p className="pt-1 text-[9px] text-subtle">{health ? `${t('common.updated')}: ${formatDateTime(health.time, settings.language)}` : ''}</p>
            </div>
          )}
        </div>
      </section>

      {healthError ? (
        <ErrorState title={t('health.failed')} description={L('The platform health endpoint did not respond. Local tools are still available.', 'لم يستجب مسار حالة المنصة. الأدوات المحلية ما زالت متاحة.')} onRetry={refresh} retryLabel={t('common.retry')} />
      ) : null}
    </div>
  )
}

export default DashboardPage

