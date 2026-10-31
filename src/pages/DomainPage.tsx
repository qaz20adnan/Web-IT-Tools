import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpen, ExternalLink, Wrench } from 'lucide-react'
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { KNOWLEDGE_META } from '@/data/knowledgeMeta'
import { TOOLS } from '@/data/tools'
import { DOMAINS, getDomain } from '@/data/domains'
import { REFERENCE_SITES } from '@/data/referenceSites'
import { CHECKLISTS } from '@/data/checklists'
import { pickText } from '@/i18n'
import type { ProblemCategory, ToolCategory } from '@/types'
import type { TranslationKey } from '@/i18n'

interface DomainHubProps {
  titleKey: TranslationKey
  domains: ProblemCategory[]
  toolCategories: ToolCategory[]
  referenceCategories: string[]
}

const HUBS: Record<string, DomainHubProps> = {
  windows: {
    titleKey: 'nav.windows',
    domains: ['windows-client', 'windows-server', 'printing'],
    toolCategories: ['windows', 'server'],
    referenceCategories: ['microsoft'],
  },
  linux: {
    titleKey: 'nav.linux',
    domains: ['linux'],
    toolCategories: ['server', 'developer'],
    referenceCategories: ['linux', 'sysadmin'],
  },
  m365: {
    titleKey: 'nav.m365',
    domains: ['microsoft-365'],
    toolCategories: ['windows'],
    referenceCategories: ['microsoft', 'microsoft-365'],
  },
  security: {
    titleKey: 'nav.security',
    domains: ['cybersecurity'],
    toolCategories: ['security'],
    referenceCategories: ['security'],
  },
  datacenter: {
    titleKey: 'nav.datacenter',
    domains: ['datacenter'],
    toolCategories: ['server'],
    referenceCategories: ['virtualization'],
  },
  backup: {
    titleKey: 'nav.backup',
    domains: ['backup-dr'],
    toolCategories: ['server', 'data'],
    referenceCategories: ['microsoft'],
  },
  cloud: {
    titleKey: 'nav.cloud',
    domains: ['cloud-devops'],
    toolCategories: ['developer', 'data'],
    referenceCategories: ['cloud', 'devops', 'code'],
  },
}

export function DomainPage({ hub }: { hub: keyof typeof HUBS }) {
  const { t, settings } = useApp()
  const [params, setParams] = useSearchParams()
  const config = HUBS[hub]
  const filter = params.get('domain') as ProblemCategory | null
  // Both branches return a stable reference (a one-element array built here, or
  // the module-level hub list), otherwise the article memo below recomputes and
  // re-sorts the whole catalog on every render.
  const allowed = useMemo(
    () => (filter && config.domains.includes(filter) ? [filter] : config.domains),
    [filter, config.domains],
  )

  const articles = useMemo(
    () => KNOWLEDGE_META.filter((article) => allowed.includes(article.domain)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [allowed],
  )
  const tools = useMemo(() => TOOLS.filter((tool) => config.toolCategories.includes(tool.category)), [config.toolCategories])
  const checklists = useMemo(
    () =>
      CHECKLISTS.filter((checklist) => {
        if (hub === 'backup') return checklist.id === 'backup-321'
        if (hub === 'security') return checklist.id === 'hardening' || checklist.id === 'incident-response'
        if (hub === 'linux') return checklist.id === 'server-health' || checklist.id === 'hardening'
        if (hub === 'windows' || hub === 'datacenter') return checklist.id === 'server-health'
        return false
      }),
    [hub],
  )
  const references = useMemo(
    () => REFERENCE_SITES.filter((site) => config.referenceCategories.includes(site.category)),
    [config.referenceCategories],
  )

  return (
    <div className="animate-in space-y-4">
      <PageHeader
        title={t(config.titleKey)}
        subtitle={t('knowledge.subtitle')}
        actions={
          <Link to="/lab" className="btn btn-primary text-sm">
            {t('lab.analyze')}
          </Link>
        }
      />

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('nav.solutions')} value={articles.length} icon={<BookOpen className="h-4 w-4" />} tone="primary" />
        <Stat label={t('nav.toolkit')} value={tools.length} icon={<Wrench className="h-4 w-4" />} tone="accent" />
        <Stat label={t('nav.windows')} value={config.domains.length} hint={t('knowledge.contentNotice')} />
        <Stat label={t('common.sources')} value={references.length} hint={t('research.officialHint')} />
      </div>

      {config.domains.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setParams({})}
            className={`badge cursor-pointer border border-line ${!filter ? 'badge-primary' : ''}`}
          >
            {t('common.all')}
          </button>
          {config.domains.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setParams({ domain: id })}
              className={`badge cursor-pointer border border-line ${filter === id ? 'badge-primary' : ''}`}
            >
              {t(getDomain(id).labelKey)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={t('nav.solutions')}
            subtitle={t('knowledge.articleCount', { count: articles.length })}
            actions={<Link to="/solutions" className="text-xs text-primary hover:underline">{t('dashboard.viewAll')}</Link>}
          />
          {articles.length === 0 ? (
            <div className="p-4">
              <EmptyState title={t('knowledge.empty')} />
            </div>
          ) : (
            <div className="divide-y divide-line">
              {articles.slice(0, 8).map((article) => (
                <Link key={article.id} to={`/solutions/${article.slug}`} className="block p-4 hover:bg-surface-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="primary">{t(getDomain(article.domain).labelKey)}</Badge>
                    <Badge tone={article.verification === 'draft' ? 'warning' : 'success'}>{t(`verification.${article.verification}`)}</Badge>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold">{pickText(article.title, settings.language)}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{pickText(article.summary, settings.language)}</p>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('nav.toolkit')} icon={<Wrench className="h-4 w-4" />} />
            <div className="grid gap-1.5 p-4">
              {tools.map((tool) => (
                <Link
                  key={tool.id}
                  to={`/toolkit?tool=${tool.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-line px-2.5 py-2 text-xs hover:border-primary/40"
                >
                  <span className="truncate">{pickText(tool.name, settings.language)}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-subtle rtl:rotate-180" />
                </Link>
              ))}
            </div>
          </Card>

          {checklists.length > 0 ? (
            <Card>
              <CardHeader title={t('checklists.title')} />
              <div className="grid gap-1.5 p-4">
                {checklists.map((checklist) => (
                  <Link
                    key={checklist.id}
                    to={`/toolkit?tool=checklist&checklist=${checklist.id}`}
                    className="rounded-md border border-line px-2.5 py-2 text-xs hover:border-primary/40"
                  >
                    {pickText(checklist.title, settings.language)}
                    <span className="mt-0.5 block text-[10px] text-subtle">{checklist.items.length} items</span>
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={t('research.officialSearchLinks')} subtitle={t('research.officialHint')} />
            <ul className="divide-y divide-line text-xs">
              {references.map((site) => (
                <li key={site.id}>
                  <a
                    href={site.search(t(config.titleKey))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-surface-2"
                  >
                    <span>{site.name}</span>
                    <ExternalLink className="h-3 w-3 text-subtle" />
                  </a>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-4">
            <p className="text-xs font-semibold">{t('nav.lab')}</p>
            <p className="mt-1 text-[11px] text-muted">{t('lab.subtitle')}</p>
            <Link to="/lab" className="btn btn-secondary mt-2 text-xs">
              {t('lab.analyze')}
            </Link>
          </Card>
        </div>
      </div>

      <p className="text-[11px] text-subtle">
        {DOMAINS.filter((domain) => allowed.includes(domain.id))
          .map((domain) => domain.description[settings.language])
          .join(' ')}
      </p>
    </div>
  )
}

export default DomainPage
