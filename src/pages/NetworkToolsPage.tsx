import { useState } from 'react'
import { Network } from 'lucide-react'
import { Alert, PageHeader, Tab, Tabs } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { getTool } from '@/data/tools'
import { pickText } from '@/i18n'
import { BandwidthTool, SubnetTool } from '@/components/tools/Calculators'
import { DnsTool, TlsTool } from '@/components/tools/NetworkLookup'
import { DdnsPortAnalyzer } from '@/components/tools/DdnsPortAnalyzer'
import { PrinterDiagnostics } from '@/components/tools/PrinterDiagnostics'

export function NetworkToolsPage() {
  const { t, settings } = useApp()
  const label = (id: string) => {
    const tool = getTool(id)
    return tool ? pickText(tool.name, settings.language) : id
  }
  const [tab, setTab] = useState('subnet')
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)

  return (
    <div className="animate-in">
      <PageHeader title={t('toolkit.networkToolsTitle')} subtitle={t('toolkit.networkToolsSubtitle')} badge={<Network className="h-5 w-5 text-primary" />} />
      <Tabs value={tab} onChange={setTab} className="mb-4">
        <Tab id="subnet">{label('subnet')}</Tab>
        <Tab id="dns">{label('dns')}</Tab>
        <Tab id="tls">{label('tls')}</Tab>
        <Tab id="ddns">{L('DDNS & Ports', 'DDNS والمنافذ')}</Tab>
        <Tab id="printer">{L('Printer Diagnostics', 'تشخيص الطابعات')}</Tab>
        <Tab id="bandwidth">{label('bandwidth')}</Tab>
      </Tabs>
      {tab === 'subnet' ? <SubnetTool /> : null}
      {tab === 'dns' ? <DnsTool /> : null}
      {tab === 'tls' ? <TlsTool /> : null}
      {tab === 'ddns' ? <DdnsPortAnalyzer /> : null}
      {tab === 'printer' ? <PrinterDiagnostics /> : null}
      {tab === 'bandwidth' ? <BandwidthTool /> : null}
      <Alert tone="info" className="mt-4">{t('toolkit.localNotice')}</Alert>
    </div>
  )
}

export default NetworkToolsPage
