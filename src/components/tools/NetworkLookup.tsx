import { useState } from 'react'
import { Lock, Search, ShieldCheck } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Spinner } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { ApiError, inspectTls, lookupDns, type DnsLookupResponse, type TlsInfo } from '@/services/api'
import { safeExternalUrl } from '@/lib/utils'
import type { LocalizedText } from '@/types'

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA', 'SRV', 'PTR'] as const

const DNS_PRESETS: Array<{ id: string; label: LocalizedText; type: (typeof RECORD_TYPES)[number]; prefix: string }> = [
  { id: 'website', label: { en: 'Website address', ar: 'عنوان الموقع' }, type: 'A', prefix: '' },
  { id: 'mail', label: { en: 'Mail servers', ar: 'خوادم البريد' }, type: 'MX', prefix: '' },
  { id: 'spf', label: { en: 'SPF', ar: 'SPF' }, type: 'TXT', prefix: '' },
  { id: 'dmarc', label: { en: 'DMARC', ar: 'DMARC' }, type: 'TXT', prefix: '_dmarc.' },
  { id: 'reverse', label: { en: 'Reverse (PTR)', ar: 'العكس (PTR)' }, type: 'PTR', prefix: '' },
]

export function DnsTool() {
  const L = useLabels()
  const { settings } = useApp()
  const [host, setHost] = useState('adnan-tech.netlify.app')
  const [type, setType] = useState<(typeof RECORD_TYPES)[number]>('A')
  const [preset, setPreset] = useState('website')
  const [result, setResult] = useState<DnsLookupResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const lookup = async () => {
    const target = host.trim().replace(/^https?:\/\//, '').split('/')[0]
    if (!target) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      setResult(await lookupDns(target, type))
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.code === 'not_configured'
            ? L('DNS lookup is not available on this deployment. Deploy the Netlify functions to enable it.', 'استعلام DNS غير متاح في هذا النشر. انشر دوال Netlify لتمكينه.')
            : caught.message
          : L('DNS lookup failed.', 'فشل استعلام DNS.'),
      )
    } finally {
      setLoading(false)
    }
  }

  const applyPreset = (entry: (typeof DNS_PRESETS)[number]) => {
    setPreset(entry.id)
    setType(entry.type)
    const bare = host.trim().replace(/^https?:\/\//, '').split('/')[0].replace(/^_dmarc\./, '')
    setHost(`${entry.prefix}${bare}`)
  }

  const tone = result === null ? 'default' : result.outcome === 'answered' ? (result.agreement ? 'success' : 'warning') : result.outcome === 'no-data' || result.outcome === 'nxdomain' ? 'warning' : 'danger'

  return (
    <Card>
      <CardHeader title={L('DNS Lookup', 'استعلام DNS')} icon={<Search className="h-4 w-4" />} subtitle={L('Asks two public resolvers over DNS-over-HTTPS, with real TTLs and the exact RCODE.', 'يسأل محلّلين عامين عبر DNS-over-HTTPS مع TTL حقيقية وRCODE دقيق.')} />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {DNS_PRESETS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => applyPreset(entry)}
              className="nx-chip nx-chip-button text-[11px]"
              data-active={preset === entry.id}
              aria-pressed={preset === entry.id}
            >
              {settings.language === 'ar' ? entry.label.ar : entry.label.en}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
          <Field label={L('Hostname or IP', 'اسم المضيف أو IP')} htmlFor="dns-host">
            <Input id="dns-host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="example.com" dir="ltr" className="force-ltr" onKeyDown={(event) => { if (event.key === 'Enter') void lookup() }} />
          </Field>
          <Field label={L('Type', 'النوع')} htmlFor="dns-type">
            <Select id="dns-type" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
              {RECORD_TYPES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button onClick={() => void lookup()} loading={loading} disabled={!host.trim()} icon={<Search className="h-4 w-4" />}>{L('Lookup', 'استعلام')}</Button>
          </div>
        </div>
        {loading ? <Spinner label={L('Querying resolvers…', 'جارٍ استعلام المحلّلات…')} /> : null}
        {error ? <Alert tone="danger" title={L('Lookup failed', 'فشل الاستعلام')}>{error}</Alert> : null}
        {result ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={tone}>{result.outcomeLabel}</Badge>
              <Badge tone={result.agreement ? 'success' : 'warning'}>
                {result.agreement ? L('Resolvers agree', 'المحلّلات متفقة') : L('Resolvers disagree', 'المحلّلات مختلفة')}
              </Badge>
              <span className="text-xs text-muted" dir="ltr">{result.askedAs} · {result.type}</span>
            </div>
            {result.answers.length === 0 ? (
              <p className="text-xs text-muted">{L('No record of this type exists for the name. That is an answer, not a failure.', 'لا يوجد سجل من هذا النوع للاسم. هذه إجابة وليست إخفاقًا.')}</p>
            ) : (
              <div className="overflow-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-subtle">
                    <tr>
                      <th className="p-2 text-start">{L('Name', 'الاسم')}</th>
                      <th className="p-2 text-start">TTL</th>
                      <th className="p-2 text-start">{L('Data', 'البيانات')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.answers.map((answer, index) => (
                      <tr key={`${answer.name}-${answer.data}-${index}`} className="border-t border-line">
                        <td className="break-all p-2 font-mono" dir="ltr">{answer.name}</td>
                        <td className="p-2 font-mono tabular-nums" dir="ltr">{answer.ttl}s</td>
                        <td className="break-all p-2 font-mono" dir="ltr">{answer.data}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="overflow-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-subtle">
                  <tr>
                    <th className="p-2 text-start">{L('Resolver', 'المحلّل')}</th>
                    <th className="p-2 text-start">{L('Outcome', 'النتيجة')}</th>
                    <th className="p-2 text-start">RCODE</th>
                    <th className="p-2 text-start">{L('Records', 'السجلات')}</th>
                    <th className="p-2 text-start">{L('Time', 'الزمن')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.resolvers.map((entry) => (
                    <tr key={entry.resolver} className="border-t border-line">
                      <td className="p-2 font-semibold">{entry.resolver}</td>
                      <td className="p-2">{entry.errorCode ? <span className="text-danger">{L('Unreachable', 'غير متاح')}</span> : entry.outcome}</td>
                      <td className="p-2 font-mono tabular-nums">{entry.rcode === null ? '—' : entry.rcode}</td>
                      <td className="p-2 font-mono tabular-nums">{entry.answers.length}</td>
                      <td className="p-2 font-mono tabular-nums" dir="ltr">{entry.elapsedMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-subtle">{result.note}</p>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

const TLS_PORTS = [443, 465, 587, 636, 990, 993, 995, 8443] as const

export function TlsTool() {
  const L = useLabels()
  const [host, setHost] = useState('learn.microsoft.com')
  const [port, setPort] = useState('443')
  const [info, setInfo] = useState<TlsInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const inspect = async () => {
    const target = host.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    const portNumber = Number(port)
    if (!target || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) return
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      setInfo(await inspectTls(target, portNumber))
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.code === 'not_configured'
            ? L('Certificate inspection is not available on this deployment. Deploy the Netlify functions to enable it.', 'فحص الشهادات غير متاح في هذا النشر. انشر دوال Netlify لتمكينه.')
            : caught.message
          : L('Certificate inspection failed.', 'فشل فحص الشهادة.'),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader title={L('TLS Certificate Inspector', 'فاحص شهادات TLS')} icon={<Lock className="h-4 w-4" />} subtitle={L('Best-effort certificate metadata for a public TLS endpoint.', 'بيانات وصفية للشهادة لمضيف TLS عام بأفضل جهد.')} />
      <div className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
          <Field label={L('Hostname', 'اسم المضيف')} htmlFor="tls-host">
            <Input id="tls-host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="example.com" dir="ltr" />
          </Field>
          <Field label={L('Port', 'المنفذ')} htmlFor="tls-port">
            <Select id="tls-port" value={port} onChange={(event) => setPort(event.target.value)}>
              {TLS_PORTS.map((entry) => <option key={entry} value={String(entry)}>{entry}</option>)}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button onClick={() => void inspect()} loading={loading} disabled={!host.trim()} icon={<ShieldCheck className="h-4 w-4" />}>{L('Inspect', 'فحص')}</Button>
          </div>
        </div>
        {loading ? <Spinner label={L('Opening a TLS connection…', 'جارٍ فتح اتصال TLS…')} /> : null}
        {error ? <Alert tone="warning" title={L('Inspection unavailable', 'الفحص غير متاح')}>{error}</Alert> : null}
        {info ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={info.daysRemaining > 30 ? 'success' : info.daysRemaining > 7 ? 'warning' : 'danger'}>
                {info.daysRemaining} {L('days remaining', 'يومًا متبقيًا')}
              </Badge>
              {info.protocol ? <Badge>{info.protocol}</Badge> : null}
            </div>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              {[
                [L('Subject', 'الموضوع'), info.subject],
                [L('Issuer', 'المُصدر'), info.issuer],
                [L('Valid from', 'صالح من'), info.validFrom],
                [L('Valid to', 'صالح حتى'), info.validTo],
                [L('Serial number', 'الرقم التسلسلي'), info.serialNumber],
                [L('Subject alternative names', 'الأسماء البديلة'), info.subjectAltNames.join(', ') || '—'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-surface-2 p-2.5">
                  <dt className="text-[10px] uppercase text-subtle">{label}</dt>
                  <dd className="mt-0.5 break-all font-mono" dir="ltr">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[10px] text-subtle">{L('Shown for inspection only. Certificate transparency and revocation status are not evaluated here.', 'تُعرض للفحص فقط. لا تُقيّم شفافية الشهادة أو حالة الإبطال هنا.')}</p>
          </div>
        ) : null}
        <p className="text-[10px] text-subtle">
          {safeExternalUrl('https://www.ssllabs.com/ssltest/') ? L('For a full assessment, use a dedicated TLS scanner such as Qualys SSL Labs.', 'لتقييم كامل، استخدم ماسح TLS متخصصًا مثل Qualys SSL Labs.') : null}
        </p>
      </div>
    </Card>
  )
}
