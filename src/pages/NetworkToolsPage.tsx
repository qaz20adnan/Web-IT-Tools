import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Network } from 'lucide-react'
import { Alert, PageHeader, Tab, Tabs } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { getTool } from '@/data/tools'
import { pickText } from '@/i18n'
import { BandwidthTool, SubnetTool } from '@/components/tools/Calculators'
import { DnsTool, TlsTool } from '@/components/tools/NetworkLookup'
import { DdnsPortAnalyzer } from '@/components/tools/DdnsPortAnalyzer'
import { PrinterDiagnostics } from '@/components/tools/PrinterDiagnostics'
import { SpeedTestTool } from '@/components/tools/SpeedTestTool'
import { PortCheckTool } from '@/components/tools/PortCheckTool'

const TAB_IDS = ['subnet', 'dns', 'tls', 'ddns', 'ports', 'speed', 'printer', 'bandwidth'] as const

export function NetworkToolsPage() {
  const { t, settings } = useApp()
  const label = (id: string) => {
    const tool = getTool(id)
    return tool ? pickText(tool.name, settings.language) : id
  }
  const [params] = useSearchParams()
  const requested = params.get('tab') ?? params.get('tool')
  const [tab, setTab] = useState(() => (requested && TAB_IDS.includes(requested as never) ? requested : 'subnet'))
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)

  useEffect(() => {
    if (requested && TAB_IDS.includes(requested as never)) setTab(requested)
  }, [requested])

  return (
    <div className="animate-in">
      <PageHeader title={t('toolkit.networkToolsTitle')} subtitle={t('toolkit.networkToolsSubtitle')} badge={<Network className="h-5 w-5 text-primary" />} />
      <Tabs value={tab} onChange={setTab} className="mb-4">
        <Tab id="subnet">{label('subnet')}</Tab>
        <Tab id="dns">{label('dns')}</Tab>
        <Tab id="tls">{label('tls')}</Tab>
        <Tab id="ddns">{L('DDNS & Ports', 'DDNS والمنافذ')}</Tab>
        <Tab id="ports">{L('Port checker', 'فحص المنافذ')}</Tab>
        <Tab id="speed">{L('Speed test', 'فحص السرعة')}</Tab>
        <Tab id="printer">{L('Printer Diagnostics', 'تشخيص الطابعات')}</Tab>
        <Tab id="bandwidth">{label('bandwidth')}</Tab>
      </Tabs>
      <div key={tab} className="animate-fade">
        {tab === 'subnet' ? <SubnetTool /> : null}
        {tab === 'dns' ? <DnsTool /> : null}
        {tab === 'tls' ? <TlsTool /> : null}
        {tab === 'ddns' ? <DdnsPortAnalyzer /> : null}
        {tab === 'ports' ? <PortCheckTool /> : null}
        {tab === 'speed' ? <SpeedTestTool /> : null}
        {tab === 'printer' ? <PrinterDiagnostics /> : null}
        {tab === 'bandwidth' ? <BandwidthTool /> : null}
      </div>
      <Alert tone="info" className="mt-4">{t('toolkit.localNotice')}</Alert>
    </div>
  )
}

export default NetworkToolsPage
