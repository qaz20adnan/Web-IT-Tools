import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Wrench } from 'lucide-react'
import { Badge, Card, EmptyState, Input, Modal, PageHeader, Tab, Tabs } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { TOOLS, TOOL_CATEGORIES } from '@/data/tools'
import { pickText } from '@/i18n'
import type { ToolCategory } from '@/types'
import {
  BackupTool,
  BandwidthTool,
  CertTool,
  Ipv6Tool,
  RaidTool,
  RtoTool,
  SubnetTool,
} from '@/components/tools/Calculators'
import {
  ApiTool,
  Base64Tool,
  CronTool,
  HashTool,
  JsonTool,
  LogFormatTool,
  MarkdownTool,
  RegexTool,
  TimestampTool,
  UrlTool,
  YamlTool,
} from '@/components/tools/EncodingTools'
import {
  AuditTool,
  ChecklistTool,
  CommandBuilderTool,
  CvssTool,
  HeadersTool,
  IocTool,
  VulnTool,
} from '@/components/tools/SecurityTools'
import { EventLogTool } from '@/components/tools/WindowsTools'
import { PermissionsTool } from '@/components/tools/LinuxTools'
import { VlsmTool } from '@/components/tools/VlsmPlanner'
import { CidrOverlapTool } from '@/components/tools/CidrOverlapTool'
import { MtuTool } from '@/components/tools/MtuTool'
import { CapacityTool } from '@/components/tools/CapacityTool'
import { CertDecodeTool } from '@/components/tools/CertDecodeTool'
import { TextDiffTool } from '@/components/tools/TextDiffTool'
import { CsvJsonTool } from '@/components/tools/CsvJsonTool'
import { DnsTool, TlsTool } from '@/components/tools/NetworkLookup'
import { SpeedTestTool } from '@/components/tools/SpeedTestTool'
import { PortCheckTool } from '@/components/tools/PortCheckTool'
import {
  BackupReadinessTool,
  DiskCapacityTool,
  FirewallDocTool,
  LatencyTool,
  PortReferenceTool,
} from '@/components/tools/OperationsTools'

const COMPONENTS: Record<string, () => React.JSX.Element | null> = {
  subnet: SubnetTool,
  ipv6: Ipv6Tool,
  dns: DnsTool,
  bandwidth: BandwidthTool,
  tls: TlsTool,
  speed: SpeedTestTool,
  portcheck: PortCheckTool,
  raid: RaidTool,
  backup: BackupTool,
  rto: RtoTool,
  cert: CertTool,
  commandbuilder: CommandBuilderTool,
  log: EventLogTool,
  cvss: CvssTool,
  headers: HeadersTool,
  checklist: ChecklistTool,
  ioc: IocTool,
  vuln: VulnTool,
  audit: AuditTool,
  hash: HashTool,
  base64: Base64Tool,
  url: UrlTool,
  json: JsonTool,
  regex: RegexTool,
  timestamp: TimestampTool,
  cron: CronTool,
  yaml: YamlTool,
  markdown: MarkdownTool,
  api: ApiTool,
  logformat: LogFormatTool,
  ports: PortReferenceTool,
  latency: LatencyTool,
  diskcapacity: DiskCapacityTool,
  firewalldoc: FirewallDocTool,
  backupcheck: BackupReadinessTool,
  vlsm: VlsmTool,
  permissions: PermissionsTool,
  cidroverlap: CidrOverlapTool,
  mtu: MtuTool,
  capacity: CapacityTool,
  certdecode: CertDecodeTool,
  textdiff: TextDiffTool,
  csvjson: CsvJsonTool,
}

const CATEGORY_LABEL: Record<ToolCategory, 'toolkit.network' | 'toolkit.server' | 'toolkit.windows' | 'toolkit.security' | 'toolkit.developer' | 'toolkit.data'> = {
  network: 'toolkit.network',
  server: 'toolkit.server',
  windows: 'toolkit.windows',
  security: 'toolkit.security',
  developer: 'toolkit.developer',
  data: 'toolkit.data',
}

export function ToolkitPage() {
  const { t, settings } = useApp()
  const [params, setParams] = useSearchParams()
  const [category, setCategory] = useState<'all' | ToolCategory>('all')
  const [query, setQuery] = useState('')
  const selectedId = params.get('tool')
  const selected = selectedId ? TOOLS.find((tool) => tool.id === selectedId) : undefined
  const Component = selected ? COMPONENTS[selected.id] : undefined

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return TOOLS.filter((tool) => {
      if (category !== 'all' && tool.category !== category) return false
      if (!term) return true
      return (
        pickText(tool.name, settings.language).toLowerCase().includes(term) ||
        pickText(tool.description, settings.language).toLowerCase().includes(term) ||
        tool.keywords.some((keyword) => keyword.toLowerCase().includes(term))
      )
    })
  }, [category, query, settings.language])

  const openTool = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('tool', id)
    setParams(next, { replace: true })
  }

  const closeTool = () => {
    const next = new URLSearchParams(params)
    next.delete('tool')
    setParams(next, { replace: true })
  }

  return (
    <div className="animate-in">
      <PageHeader
        title={t('toolkit.title')}
        subtitle={t('toolkit.subtitle')}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('toolkit.searchPlaceholder')} className="min-w-64 ps-8" />
          </div>
        }
      />
      <Tabs value={category} onChange={(value) => setCategory(value as typeof category)} className="mb-4">
        <Tab id="all">{t('toolkit.all')}</Tab>
        {TOOL_CATEGORIES.map((entry) => <Tab key={entry} id={entry}>{t(CATEGORY_LABEL[entry])}</Tab>)}
      </Tabs>
      {filtered.length === 0 ? (
        <EmptyState icon={<Wrench className="h-8 w-8" />} title={t('toolkit.noTools')} description={t('toolkit.subtitle')} />
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((tool) => (
            <button key={tool.id} type="button" onClick={() => openTool(tool.id)} className="card lift card-pad group text-start hover:border-primary/60">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold">{pickText(tool.name, settings.language)}</h2>
                <Badge>{t(CATEGORY_LABEL[tool.category])}</Badge>
              </div>
              <p className="mt-1.5 line-clamp-3 text-xs text-muted">{pickText(tool.description, settings.language)}</p>
              <span className="mt-3 inline-block text-xs font-medium text-primary transition-transform group-hover:scale-110">{t('toolkit.open')} →</span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-4 text-[11px] text-subtle">{t('toolkit.localNotice')}</p>

      <Modal open={Boolean(selected)} onClose={closeTool} title={selected ? pickText(selected.name, settings.language) : ''} size="xl">
        {selected && Component ? <Component /> : <Card className="p-4 text-sm text-muted">{t('toolkit.noTools')}</Card>}
      </Modal>
    </div>
  )
}

export default ToolkitPage
