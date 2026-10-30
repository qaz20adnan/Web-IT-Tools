import { CheckCircle2, Cpu, Database, ExternalLink, KeyRound, Layers, ShieldCheck, Sparkles, TerminalSquare } from 'lucide-react'
import { Alert, Badge, Card, CardHeader, InlineCode, PageHeader, StatusDot } from '@/components/ui'
import { BrandMark } from '@/components/brand/BrandLogo'
import { useApp } from '@/context/AppContext'
import { useHealth } from '@/hooks/useHealth'
import { formatDate } from '@/i18n'
import {
  APP_FOUNDER,
  APP_FOUNDER_AR,
  APP_LINKS,
  APP_NAME,
  APP_NAME_AR,
  APP_TAGLINE,
  APP_TAGLINE_AR,
} from '@/lib/config'

export function AboutPage() {
  const { t, settings } = useApp()
  const { data: health, error } = useHealth()

  const envVars = [
    'AI_PROVIDER',
    'AI_BASE_URL',
    'AI_MODEL',
    'AI_API_KEY',
    'AI_VISION_MODEL',
    'AI_ALLOWED_HOSTS',
    'ALLOW_LOCAL_AI',
    'AI_RATE_LIMIT_PER_MINUTE',
    'RESEARCH_PROVIDER',
    'TAVILY_API_KEY',
    'BRAVE_SEARCH_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CONTENT_ADMIN_TOKEN',
  ]

  return (
    <div className="animate-in space-y-4">
      <PageHeader
        title={t('about.title')}
        subtitle={t('about.subtitle')}
        badge={<Badge tone="primary">{t('about.version')} 1.0.0</Badge>}
      />

      <Card>
        <CardHeader title={t('about.identity')} icon={<Sparkles className="h-4 w-4" />} />
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-4">
            <BrandMark size={56} />
            <div className="min-w-0">
              <p className="text-lg font-extrabold tracking-tight">
                {APP_NAME} <span className="text-primary">|</span> <span dir="rtl">{APP_NAME_AR}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted" dir="auto">
                {APP_TAGLINE} — {APP_TAGLINE_AR}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted">{t('about.identityBody')}</p>
          <p className="mt-3 text-sm">
            <span className="font-semibold text-text">{t('about.founder')}: </span>
            <span>{APP_FOUNDER}</span>
            <span className="text-subtle"> · </span>
            <span dir="rtl">{APP_FOUNDER_AR}</span>
          </p>
          <p className="mt-4 text-sm font-semibold text-text">{t('about.scope')}</p>
          <p className="mt-1 text-sm text-muted">{t('about.scopeBody')}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {t('about.scopeItems')
              .split(',')
              .map((item) => (
                <span
                  key={item}
                  dir="auto"
                  className="rounded-full border border-line bg-surface-2/60 px-2.5 py-1 text-[11px] text-muted"
                >
                  {item}
                </span>
              ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('about.overview')} icon={<Layers className="h-4 w-4" />} />
            <div className="space-y-3 p-5 text-sm text-muted">
              <p>{t('about.overviewBody')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ['nav.lab', 'lab.subtitle'],
                  ['nav.toolkit', 'toolkit.subtitle'],
                  ['nav.solutions', 'knowledge.subtitle'],
                  ['nav.news', 'news.subtitle'],
                ].map(([titleKey, bodyKey]) => (
                  <div key={titleKey} className="rounded-lg border border-line bg-surface-2/60 p-3">
                    <p className="text-xs font-semibold text-text">{t(titleKey as Parameters<typeof t>[0])}</p>
                    <p className="mt-1 line-clamp-3 text-[11px] text-subtle">{t(bodyKey as Parameters<typeof t>[0])}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('about.honesty')} icon={<CheckCircle2 className="h-4 w-4" />} />
            <div className="p-5 text-sm text-muted">{t('about.honestyBody')}</div>
          </Card>

          <Card>
            <CardHeader title={t('about.security')} icon={<ShieldCheck className="h-4 w-4" />} />
            <div className="p-5 text-sm text-muted">{t('about.securityBody')}</div>
          </Card>

          <Card>
            <CardHeader title={t('about.architecture')} icon={<Cpu className="h-4 w-4" />} />
            <div className="space-y-3 p-5 text-sm text-muted">
              <p>
                React + TypeScript + Vite SPA, Netlify Functions for AI/search/news/network proxying, and optional Supabase
                for published content. Local tools run entirely in the browser.
              </p>
              <div className="overflow-x-auto rounded-lg border border-line">
                <pre className="p-3 text-[11px] leading-relaxed" dir="ltr">{`Browser (React)
  ├─ Local tools, knowledge, checklists, scripts
  ├─ /api/ai/*      → Netlify Function → provider API
  ├─ /api/research  → Tavily / Brave (optional)
  ├─ /api/news      → RSS feeds (optional)
  ├─ /api/net/*     → DNS / TLS inspection
  └─ /api/content   → Supabase (optional, read-only)`}</pre>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('about.providerSetup')} icon={<KeyRound className="h-4 w-4" />} />
            <div className="space-y-3 p-5 text-sm text-muted">
              <p>{t('about.providerSetupBody')}</p>
              <p className="text-xs font-semibold text-text">{t('about.environment')}</p>
              <div className="flex flex-wrap gap-1.5">
                {envVars.map((name) => (
                  <InlineCode key={name}>{name}</InlineCode>
                ))}
              </div>
              <Alert tone="warning">{t('about.deployBody')}</Alert>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('about.status')} icon={<TerminalSquare className="h-4 w-4" />} />
            <div className="space-y-2 p-5 text-xs">
              {error ? (
                <p className="text-warning">Health endpoint unreachable. Local features still work.</p>
              ) : health ? (
                <>
                  <p className="flex items-center justify-between">
                    <span className="text-subtle">{t('about.version')}</span>
                    <span className="font-mono">{health.version}</span>
                  </p>
                  <p className="flex items-center justify-between">
                    <span className="text-subtle">{t('about.database')}</span>
                    <StatusDot tone={health.services.database.configured ? 'success' : 'muted'} label={health.services.database.configured ? 'Supabase' : t('common.notConfigured')} />
                  </p>
                  <p className="flex items-center justify-between">
                    <span className="text-subtle">{t('health.ai')}</span>
                    <StatusDot tone={health.services.ai.configured ? 'success' : 'muted'} label={health.services.ai.configured ? health.services.ai.model ?? 'yes' : t('common.notConfigured')} />
                  </p>
                  <p className="flex items-center justify-between">
                    <span className="text-subtle">{t('health.research')}</span>
                    <StatusDot
                      tone={health.services.research.configured ? 'success' : 'muted'}
                      label={
                        health.services.research.configured
                          ? health.services.research.providers.join(', ') ||
                            (health.services.research.grounded?.webSearchEnabled ? 'Google Search grounding' : 'configured')
                          : t('common.notConfigured')
                      }
                    />
                  </p>
                  <p className="flex items-center justify-between">
                    <span className="text-subtle">{t('health.news')}</span>
                    <StatusDot
                      tone={health.services.news.configured ? 'success' : 'muted'}
                      label={
                        health.services.news.configured
                          ? health.services.news.sources
                            ? `${health.services.news.sources} RSS`
                            : 'RSS'
                          : t('common.notConfigured')
                      }
                    />
                  </p>
                  <p className="flex items-center justify-between border-t border-line pt-2">
                    <span className="text-subtle">Checked</span>
                    <span>{formatDate(health.time, settings.language)}</span>
                  </p>
                </>
              ) : (
                <p className="text-subtle">{t('common.loading')}</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title={t('about.shortcuts')} />
            <div className="divide-y divide-line text-xs">
              {[
                ['Ctrl / ⌘ + K', t('about.shortcutCommand')],
                ['/', t('about.shortcutSearch')],
                ['Ctrl / ⌘ + Enter', t('about.shortcutSend')],
                ['Esc', t('about.shortcutClose')],
              ].map(([keys, label]) => (
                <p key={keys} className="flex items-center justify-between gap-2 px-5 py-2">
                  <span className="text-muted">{label}</span>
                  <InlineCode>{keys}</InlineCode>
                </p>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title={t('about.buildInfo')} icon={<Database className="h-4 w-4" />} />
            <div className="space-y-1.5 p-5 text-xs">
              <p className="flex justify-between gap-2">
                <span className="text-subtle">{t('about.environment')}</span>
                <span className="font-mono">{import.meta.env.MODE}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span className="text-subtle">{t('about.architecture')}</span>
                <span className="font-mono">SPA + Functions</span>
              </p>
              <p className="flex justify-between gap-2">
                <span className="text-subtle">{t('about.license')}</span>
                <span>MIT</span>
              </p>
              {APP_LINKS.repository ? (
                <a href={APP_LINKS.repository} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 pt-1 text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  Repository
                </a>
              ) : null}
            </div>
          </Card>

          <Alert tone="info" title={t('about.disclaimer')}>
            {t('about.disclaimerBody')}
          </Alert>
        </div>
      </div>
    </div>
  )
}

export default AboutPage
