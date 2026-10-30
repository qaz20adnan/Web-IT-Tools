import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileKey2, ShieldAlert } from 'lucide-react'
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Stat,
  Textarea,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { formatDateTime } from '@/i18n'
import type { Language } from '@/types'
import { readJson, writeJson } from '@/lib/storage'
import { downloadTextFile } from '@/lib/utils'
import {
  decodePemBundle,
  type CertChainCheck,
  type DecodeResult,
  type ParsedExtensions,
  type ParsedName,
  type PemBlockEntry,
  type SanEntry,
  type X509Info,
} from '@/lib/x509'

type LabelFn = (en: string, ar: string) => string

const PREFS_KEY = 'nexora.certdecode.prefs.v1'

const SAMPLE_PEM = `-----BEGIN CERTIFICATE-----
MIIDHDCCAwSgAwIBAgIGepsMHS4/MAsGCSqGSIb3DQEBBTA/MQswCQYDVQQGEwJT
QTETMBEGA1UEChMKQWRuYW4gVGVjaDEbMBkGA1UEAxMSQWRuYW4gVGVjaCBSb290
IENBMB4XDTI1MDkwMTAwMDAwMFoXDTI3MDEwMTAwMDAwMFowVDELMAkGA1UEBhMC
U0ExEzARBgNVBAoTCkFkbmFuIFRlY2gxEzARBgNVBAsTCk9wZXJhdGlvbnMxGzAZ
BgNVBAMTEmdhdGV3YXkuYWRuYW4udGVjaDCCASIwDQYJKoZIhvcNAQEBBQADggEP
ADCCAQoCggEBAMDe3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3n8CAwEAAaOCAQkwggEFMAwGA1UdEwEB
/wQCMAAwDgYDVR0PAQH/BAQDAgWgMBMGA1UdJQQMMAoGCCsGAQUFBwMBMEMGA1Ud
EQQ8MDqCEmdhdGV3YXkuYWRuYW4udGVjaIIOdnBuLmFkbmFuLnRlY2iBDm9wc0Bh
ZG5hbi50ZWNohwQKDAAFMC8GA1UdHwQoMCYwJKAioCCGHmh0dHA6Ly9jcmwuYWRu
YW4udGVjaC9yb290LmNybDATBgNVHSMEDDAKgAiaLxR9AWY7XDARBgNVHQ4ECgQI
TI0JHyJ3M6owMgYIKwYBBQUHAQEEJjAkMCIGCCsGAQUFBzABhhZodHRwOi8vb2Nz
cC5hZG5hbi50ZWNoMAsGCSqGSIb3DQEBBQMFADELbHc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBsjCCAZqgAwIBAgIHESIzRFVmdzALBgkqhkiG9w0BAQswPzELMAkGA1UEBhMC
U0ExEzARBgNVBAoTCkFkbmFuIFRlY2gxGzAZBgNVBAMTEkFkbmFuIFRlY2ggUm9v
dCBDQTAeFw0yNDAxMTUwMDAwMDBaFw0zNDAxMTUwMDAwMDBaMD8xCzAJBgNVBAYT
AlNBMRMwEQYDVQQKEwpBZG5hbiBUZWNoMRswGQYDVQQDExJBZG5hbiBUZWNoIFJv
b3QgQ0EwgZ8wDQYJKoZIhvcNAQEBBQADgY0AMIGJAoGBAMDe3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t5/AgMBAAGjOTA3MBIGA1UdEwEB/wQIMAYBAf8CAQEw
DgYDVR0PAQH/BAQDAgWgMBEGA1UdDgQKBAiaLxR9AWY7XDALBgkqhkiG9w0BAQsD
BQAxC2x3
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE REQUEST-----
MIICGTCCAgKgAwIBADBUMQswCQYDVQQGEwJTQTETMBEGA1UEChMKQWRuYW4gVGVj
aDETMBEGA1UECxMKT3BlcmF0aW9uczEbMBkGA1UEAxMSZ2F0ZXdheS5hZG5hbi50
ZWNoMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwN7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e
3t7efwIDAQABoH8wGAYJKoZIhvcNAQkHMQsTCXJvdGF0ZS1tZTAdBgkqhkiG9w0B
CQExEBMOb3BzQGFkbmFuLnRlY2gwRAYJKoZIhvcNAQkOMTcwNTAjBgNVHREEHDAa
ghJnYXRld2F5LmFkbmFuLnRlY2iHBAoMAAUwDgYDVR0PAQH/BAQDAgWgMAsGCSqG
SIb3DQEBCwMEAAobLA==
-----END CERTIFICATE REQUEST-----`

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line py-1.5 last:border-0">
      <span className="min-w-32 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</span>
      <span className="min-w-0 flex-1 text-xs">{children}</span>
    </div>
  )
}

function Technical({ value }: { value: string }) {
  return (
    <span className="break-all font-mono text-xs" dir="ltr">
      {value}
    </span>
  )
}

function SanList({ entries }: { entries: SanEntry[] }) {
  return (
    <ul className="space-y-1">
      {entries.map((entry, index) => (
        <li key={`${entry.kind}-${index}`} className="flex flex-wrap items-center gap-2">
          <Badge tone={entry.kind === 'iPAddress' ? 'accent' : 'default'}>{entry.label}</Badge>
          <Technical value={entry.value} />
          <span className="text-[10px] text-subtle" dir="ltr">
            {entry.kind}
          </span>
        </li>
      ))}
    </ul>
  )
}

function DnView({ name, L }: { name: ParsedName | null; L: LabelFn }) {
  if (!name) return <span className="text-xs text-subtle">{L('Could not be decoded', 'تعذّر فك الترميز')}</span>
  return (
    <ol className="space-y-1.5">
      {name.rdns.map((rdn, index) => (
        <li key={index} className="flex flex-wrap items-center gap-1.5">
          {rdn.map((attribute, inner) => (
            <span key={`${attribute.oid}-${inner}`} className="rounded border border-line bg-surface-2 px-1.5 py-0.5" dir="ltr">
              <span className="text-[10px] font-semibold uppercase text-subtle" title={attribute.oid}>
                {attribute.shortName}
              </span>
              <span className="ms-1.5 font-mono text-xs">{attribute.value}</span>
              <span className="ms-1.5 text-[10px] text-subtle">{attribute.stringType}</span>
            </span>
          ))}
          {rdn.length > 1 ? <span className="text-[10px] text-warning">{L('multi-valued RDN', 'RDN متعدد القيم')}</span> : null}
        </li>
      ))}
      <li className="text-[10px] text-subtle">
        <Technical value={name.dn} />
      </li>
    </ol>
  )
}

function ExtensionsView({ extensions, L }: { extensions: ParsedExtensions; L: LabelFn }) {
  const critical = (flag: boolean) => (flag ? <Badge tone="warning">critical</Badge> : null)
  const hasSomething =
    extensions.basicConstraints ||
    extensions.keyUsage ||
    extensions.extendedKeyUsage ||
    extensions.subjectAltName ||
    extensions.issuerAltName ||
    extensions.crlDistributionPoints ||
    extensions.authorityKeyIdentifier ||
    extensions.subjectKeyIdentifier ||
    extensions.authorityInfoAccess ||
    extensions.certificatePolicies ||
    extensions.nameConstraints

  return (
    <div className="space-y-2">
      {!hasSomething && extensions.raw.length === 0 ? (
        <p className="text-xs text-subtle">{L('No X.509 v3 extensions present.', 'لا توجد امتدادات X.509 v3.')}</p>
      ) : null}

      {extensions.basicConstraints ? (
        <Row label="Basic Constraints">
          <Badge tone={extensions.basicConstraints.ca ? 'primary' : 'default'}>
            CA: {extensions.basicConstraints.ca ? 'TRUE' : 'FALSE'}
          </Badge>
          {extensions.basicConstraints.pathLen !== null ? (
            <span className="ms-2 text-xs">
              pathLenConstraint = <Technical value={String(extensions.basicConstraints.pathLen)} />
            </span>
          ) : null}
          <span className="ms-2">{critical(extensions.basicConstraints.critical)}</span>
        </Row>
      ) : null}

      {extensions.keyUsage ? (
        <Row label="Key Usage">
          <div className="flex flex-wrap gap-1.5">
            {extensions.keyUsage.usages.map((usage) => (
              <Badge key={usage} tone="accent">
                {usage}
              </Badge>
            ))}
            {extensions.keyUsage.otherBits.length > 0 ? (
              <Badge tone="warning">{L('reserved bits', 'بتات محجوزة')} {extensions.keyUsage.otherBits.join(', ')}</Badge>
            ) : null}
          </div>
          <span className="ms-2">{critical(extensions.keyUsage.critical)}</span>
        </Row>
      ) : null}

      {extensions.extendedKeyUsage ? (
        <Row label="Extended Key Usage">
          <div className="flex flex-wrap gap-1.5">
            {extensions.extendedKeyUsage.purposes.map((purpose, index) => (
              <Badge key={purpose + index}>{purpose}</Badge>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {extensions.extendedKeyUsage.oids.map((oidValue) => (
              <Technical key={oidValue} value={oidValue} />
            ))}
          </div>
          <span className="ms-2">{critical(extensions.extendedKeyUsage.critical)}</span>
        </Row>
      ) : null}

      {extensions.subjectAltName ? (
        <Row label="Subject Alternative Name (SAN)">
          <SanList entries={extensions.subjectAltName.entries} />
          {critical(extensions.subjectAltName.critical)}
        </Row>
      ) : null}

      {extensions.issuerAltName ? (
        <Row label="Issuer Alternative Name">
          <SanList entries={extensions.issuerAltName.entries} />
          {critical(extensions.issuerAltName.critical)}
        </Row>
      ) : null}

      {extensions.crlDistributionPoints ? (
        <Row label="CRL Distribution Points">
          <ul className="space-y-1">
            {extensions.crlDistributionPoints.map((point, index) => (
              <li key={`${point}-${index}`}>
                <Technical value={point} />
              </li>
            ))}
          </ul>
        </Row>
      ) : null}

      {extensions.authorityKeyIdentifier ? (
        <Row label="Authority Key Identifier">
          <Technical value={extensions.authorityKeyIdentifier} />
        </Row>
      ) : null}

      {extensions.subjectKeyIdentifier ? (
        <Row label="Subject Key Identifier">
          <Technical value={extensions.subjectKeyIdentifier} />
        </Row>
      ) : null}

      {extensions.authorityInfoAccess && extensions.authorityInfoAccess.length > 0 ? (
        <Row label="Authority Information Access">
          <ul className="space-y-1">
            {extensions.authorityInfoAccess.map((access, index) => (
              <li key={`${access.method}-${index}`} className="flex flex-wrap items-center gap-2">
                <Badge>{access.method}</Badge>
                <Technical value={access.location} />
              </li>
            ))}
          </ul>
        </Row>
      ) : null}

      {extensions.certificatePolicies && extensions.certificatePolicies.length > 0 ? (
        <Row label="Certificate Policies">
          <div className="flex flex-wrap gap-2">
            {extensions.certificatePolicies.map((policy, index) => (
              <Technical key={`${policy}-${index}`} value={policy} />
            ))}
          </div>
        </Row>
      ) : null}

      {extensions.nameConstraints ? (
        <Row label="Name Constraints">
          <p className="text-xs">
            {L('permitted', 'مسموح')}: {extensions.nameConstraints.permitted.length > 0 ? <Technical value={extensions.nameConstraints.permitted.join(', ')} /> : '—'}
          </p>
          <p className="mt-1 text-xs">
            {L('excluded', 'مستبعد')}: {extensions.nameConstraints.excluded.length > 0 ? <Technical value={extensions.nameConstraints.excluded.join(', ')} /> : '—'}
          </p>
        </Row>
      ) : null}

      {extensions.raw.length > 0 ? (
        <Row label={L('All extensions (ASN.1)', 'كل الامتدادات (ASN.1)')}>
          <ul className="space-y-1">
            {extensions.raw.map((entry, index) => (
              <li key={`${entry.oid}-${index}`} className="flex flex-wrap items-center gap-2">
                <Technical value={entry.oid} />
                <span className="text-xs">{entry.name}</span>
                {entry.critical ? <Badge tone="warning">critical</Badge> : null}
                {!entry.handled ? <Badge tone="accent">{L('raw value', 'قيمة خام')}</Badge> : null}
                <Technical value={entry.hexPreview} />
              </li>
            ))}
          </ul>
        </Row>
      ) : null}
    </div>
  )
}

function BlockDetail({
  block,
  L,
  threshold,
  showSecrets,
  lang,
}: {
  block: PemBlockEntry
  L: LabelFn
  threshold: number
  showSecrets: boolean
  lang: Language
}) {
  const info: X509Info | null = block.info
  if (!info) {
    return (
      <Alert tone="danger" title={L('This block could not be decoded', 'تعذّر فك ترميز هذا القسم')}>
        <Technical value={block.issue?.detail ?? block.issue?.code ?? L('unknown failure', 'خطأ غير محدد')} />
      </Alert>
    )
  }

  const validity = info.validity
  const days = validity?.daysRemaining ?? null
  const daysTone = validity?.expired || (days !== null && days < 0) ? 'danger' : days !== null && days <= threshold ? 'warning' : 'success'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={info.kind === 'csr' ? 'accent' : 'primary'}>{info.kind === 'csr' ? 'CSR (PKCS#10)' : 'X.509 certificate'}</Badge>
        <Badge>{info.versionLabel ?? '—'}</Badge>
        <Badge tone={info.signatureAlgorithm.flagged ? 'danger' : 'default'}>
          {info.signatureAlgorithm.flagged ? L('weak signature', 'توقيع ضعيف') : info.signatureAlgorithm.hash}
        </Badge>
        {info.publicKey?.weak ? <Badge tone="danger">{L('weak key', 'مفتاح ضعيف')}</Badge> : null}
        {validity?.expired ? <Badge tone="danger">{L('expired', 'منتهي')}</Badge> : null}
        {validity?.notYetValid ? <Badge tone="warning">{L('not yet valid', 'غير صالح بعد')}</Badge> : null}
        <span className="text-[11px] text-subtle" dir="ltr">
          {block.byteLength} bytes
        </span>
      </div>

      <div className="rounded-lg border border-line px-3">
        <Row label="PEM type">
          <Technical value={block.pemType} />
        </Row>
        <Row label={L('Serial number (hex)', 'الرقم التسلسلي (ست عشري)')}>
          {info.serialHex ? <Technical value={info.serialHex} /> : '—'}
        </Row>
        <Row label={L('Signature algorithm', 'خوارزمية التوقيع')}>
          <Technical value={info.signatureAlgorithm.name} />
          <span className="ms-2 text-xs text-subtle">
            {L('hash', 'التجزئة')}: <Technical value={info.signatureAlgorithm.hash} />
          </span>
          <div className="mt-0.5">
            <Technical value={info.signatureAlgorithm.oid ?? '—'} />
          </div>
        </Row>
        <Row label={L('Subject public key', 'المفتاح العام للموضوع')}>
          {info.publicKey ? (
            <>
              <Technical value={info.publicKey.algorithm} />
              {info.publicKey.keyBits ? <span className="ms-2 text-xs">{info.publicKey.keyBits} bits</span> : null}
              {info.publicKey.curve ? <span className="ms-2 text-xs">{info.publicKey.curve}</span> : null}
              {info.publicKey.detail ? <span className="ms-2 text-xs text-subtle">{info.publicKey.detail}</span> : null}
              <div className="mt-0.5">
                <Technical value={info.publicKey.algorithmOid ?? '—'} />
              </div>
            </>
          ) : (
            '—'
          )}
        </Row>
        {validity ? (
          <Row label={L('Validity', 'الصلاحية')}>
            <div className="space-y-0.5">
              <p className="text-xs">
                notBefore: {validity.notBeforeIso ? formatDateTime(validity.notBeforeIso, lang) : '—'} <Technical value={validity.notBeforeRaw} />
              </p>
              <p className="text-xs">
                notAfter: {validity.notAfterIso ? formatDateTime(validity.notAfterIso, lang) : '—'} <Technical value={validity.notAfterRaw} />
              </p>
              <p className="text-xs">
                <Badge tone={daysTone}>
                  {days === null
                    ? L('expiry unknown', 'انتهاء غير معروف')
                    : days < 0
                      ? L(`${Math.abs(days)} days overdue`, `تجاوز الصلاحية ${Math.abs(days)} يومًا`)
                      : L(`${days} days remaining`, `متبقٍ ${days} يومًا`)}
                </Badge>
              </p>
            </div>
          </Row>
        ) : (
          <Row label={L('Validity', 'الصلاحية')}>
            <span className="text-xs text-subtle">{L('A CSR has no validity period.', 'طلب توقيع شهادة لا يحتوي على مدة صلاحية.')}</span>
          </Row>
        )}
        <Row label={L('Issuer', 'الجهة المصدرة')}>
          <DnView name={info.issuer} L={L} />
        </Row>
        <Row label={L('Subject', 'الموضوع')}>
          <DnView name={info.subject} L={L} />
        </Row>
        <Row label={L('Signature bytes', 'بايتات التوقيع')}>
          <Technical value={info.signatureHexPreview} />
        </Row>
      </div>

      {info.kind === 'csr' && info.csrAttributes.length > 0 ? (
        <div className="rounded-lg border border-line px-3">
          <p className="border-b border-line py-2 text-xs font-semibold">{L('Requested attributes', 'السمات المطلوبة')}</p>
          <ul className="divide-y divide-line">
            {info.csrAttributes.map((attribute, index) => {
              const secret = /password/i.test(attribute.name) && !showSecrets
              return (
                <li key={`${attribute.oid}-${index}`} className="space-y-1 py-2">
                  <p className="text-xs font-medium">{attribute.name}</p>
                  <Technical value={attribute.oid} />
                  <ul className="mt-1 space-y-0.5">
                    {attribute.values.map((value, position) => (
                      <li key={`${value}-${position}`}>{secret ? <Technical value={`${'•'.repeat(Math.min(value.length, 12))}`} /> : <Technical value={value} />}</li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {info.kind === 'csr' && info.requestedExtensions ? (
        <div className="rounded-lg border border-line px-3">
          <p className="border-b border-line py-2 text-xs font-semibold">{L('Requested extensions (extensionRequest)', 'الامتدادات المطلوبة (extensionRequest)')}</p>
          <div className="py-2">
            <ExtensionsView extensions={info.requestedExtensions} L={L} />
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-line px-3">
        <p className="border-b border-line py-2 text-xs font-semibold">
          {info.kind === 'csr' ? L('Extensions carried in the request', 'الامتدادات داخل الطلب') : L('X.509 v3 extensions', 'امتدادات X.509 v3')}
        </p>
        <div className="py-2">
          <ExtensionsView extensions={info.extensions} L={L} />
        </div>
      </div>

      {info.warnings.length > 0 ? (
        <Alert tone="warning" title={L('Decoder warnings', 'تحذيرات المفكّك')}>
          <ul className="space-y-1">
            {info.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                <Technical value={warning.detail} />
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  )
}

function ChainTable({ checks, links, L }: { checks: CertChainCheck[]; links: DecodeResult['links']; L: LabelFn }) {
  if (checks.length === 0) return <EmptyState title={L('No certificate subjects to match.', 'لا توجد موضوعات شهادات لمطابقتها.')} />
  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-subtle">
            <tr>
              <th className="p-2 text-start">#</th>
              <th className="p-2 text-start">{L('Subject', 'الموضوع')}</th>
              <th className="p-2 text-start">{L('Issuer', 'الجهة المصدرة')}</th>
              <th className="p-2 text-start">{L('Issuer found in this bundle', 'الجهة المصدرة موجودة في هذه الحزمة')}</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => (
              <tr key={check.block} className="border-t border-line">
                <td className="p-2 font-mono">{check.block}</td>
                <td className="max-w-56 truncate p-2 font-mono" dir="ltr" title={check.subject}>
                  {check.subject}
                </td>
                <td className="max-w-56 truncate p-2 font-mono" dir="ltr" title={check.issuer}>
                  {check.issuer}
                </td>
                <td className="p-2">
                  {check.selfSigned ? (
                    <Badge tone="success">{L('self-signed', 'موقعة ذاتيًا')}</Badge>
                  ) : check.issuerBlock !== null ? (
                    <Badge tone="success">#{check.issuerBlock}</Badge>
                  ) : (
                    <Badge tone="warning">{L('not in bundle', 'غير موجودة في الحزمة')}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {links.length > 0 ? (
        <ul className="space-y-1.5">
          {links.map((link, index) => (
            <li key={`${link.a}-${link.b}-${index}`} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={link.relation === 'unmatched' ? 'warning' : 'primary'}>#{link.a} ↔ #{link.b}</Badge>
              {link.relation === 'unmatched' ? (
                <span className="text-muted">
                  {L('no signature path between these two: their names do not pair up.', 'لا يوجد مسار توقيع بينهما: أسماء الطرفين لا تتطابق.')}
                </span>
              ) : (
                <span className="text-muted">
                  {L('subject of', 'موضوع الشهادة')} #{link.relation === 'a-issued-by-b' ? link.a : link.b} {L('is issued by', 'صادرة عن')}{' '}
                  <Technical value={link.issuerDn} />
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <Alert tone="info">
        {L(
          'Name matching is indicative only. A real chain needs the issuer public key and a signature check over the TBSCertificate bytes.',
          'مطابقة الأسماء للاستدلال فقط. السلسلة الحقيقية تتطلب المفتاح العام للجهة المصدرة والتحقق من التوقيع على بايتات TBSCertificate.',
        )}
      </Alert>
    </div>
  )
}

function bundleToText(result: DecodeResult, threshold: number): string {
  const lines: string[] = []
  lines.push(`PEM blocks: ${result.stats.blocks}  certificates: ${result.stats.certificates}  CSRs: ${result.stats.csrs}`)
  if (result.issues.length > 0) {
    lines.push('', 'Issues:')
    for (const entry of result.issues) lines.push(`- ${entry.block ? `#${entry.block} ` : ''}${entry.code}: ${entry.detail}`)
  }
  for (const block of result.blocks) {
    lines.push('', `----- Block #${block.index}: ${block.pemType} (${block.byteLength} bytes) -----`)
    if (!block.info) {
      lines.push(`  undecodable: ${block.issue?.detail ?? block.issue?.code ?? 'unknown'}`)
      continue
    }
    const info = block.info
    lines.push(`  kind: ${info.kind}  version: ${info.versionLabel ?? '—'}`)
    lines.push(`  serial: ${info.serialHex ?? '—'}`)
    lines.push(`  signature: ${info.signatureAlgorithm.name} (hash ${info.signatureAlgorithm.hash})${info.signatureAlgorithm.flagged ? '  DEPRECATED' : ''}`)
    if (info.publicKey) {
      lines.push(
        `  subject key: ${info.publicKey.algorithm}${info.publicKey.keyBits ? ` ${info.publicKey.keyBits} bits` : ''}${info.publicKey.curve ? ` ${info.publicKey.curve}` : ''}${info.publicKey.weak ? '  WEAK' : ''}`,
      )
    }
    if (info.validity) {
      const days = info.validity.daysRemaining
      lines.push(`  notBefore: ${info.validity.notBeforeRaw}  notAfter: ${info.validity.notAfterRaw}`)
      lines.push(
        `  status: ${info.validity.expired ? 'EXPIRED' : info.validity.notYetValid ? 'NOT YET VALID' : days !== null && days <= threshold ? `EXPIRES IN ${days} DAYS` : `valid (${days ?? '—'} days remaining)`}`,
      )
    }
    lines.push(`  issuer: ${info.issuer?.dn ?? '—'}`)
    lines.push(`  subject: ${info.subject?.dn ?? '—'}`)
    const ext = info.kind === 'csr' ? (info.requestedExtensions ?? info.extensions) : info.extensions
    if (ext.basicConstraints) lines.push(`  BasicConstraints: CA=${ext.basicConstraints.ca} pathLen=${ext.basicConstraints.pathLen ?? '—'}`)
    if (ext.keyUsage) lines.push(`  KeyUsage: ${ext.keyUsage.usages.join(', ')}`)
    if (ext.extendedKeyUsage) lines.push(`  ExtendedKeyUsage: ${ext.extendedKeyUsage.purposes.join(', ')}`)
    if (ext.subjectAltName) lines.push(`  SAN: ${ext.subjectAltName.entries.map((entry) => `${entry.label}=${entry.value}`).join(', ')}`)
    if (ext.crlDistributionPoints) lines.push(`  CRL DP: ${ext.crlDistributionPoints.join(', ')}`)
    if (ext.authorityKeyIdentifier) lines.push(`  AKI: ${ext.authorityKeyIdentifier}`)
    if (ext.subjectKeyIdentifier) lines.push(`  SKI: ${ext.subjectKeyIdentifier}`)
    if (ext.authorityInfoAccess) lines.push(`  AIA: ${ext.authorityInfoAccess.map((access) => `${access.method} ${access.location}`).join(', ')}`)
    for (const entry of ext.raw.filter((item) => !item.handled)) lines.push(`  ${entry.name} (${entry.oid}): ${entry.hexPreview}`)
    for (const attribute of info.csrAttributes) lines.push(`  requested attribute ${attribute.name}: ${attribute.values.join(', ')}`)
    for (const warning of info.warnings) lines.push(`  warning: ${warning.detail}`)
  }
  if (result.chainChecks.length > 0) {
    lines.push('', 'Chain checks:')
    for (const check of result.chainChecks) {
      lines.push(
        `  #${check.block} ${check.subject} <- ${check.issuer} [${check.selfSigned ? 'self-signed' : check.issuerBlock !== null ? `issuer is #${check.issuerBlock}` : 'issuer not in bundle'}]`,
      )
    }
  }
  return lines.join('\n')
}

export function CertDecodeTool() {
  const { settings } = useApp()
  const L: LabelFn = (en, ar) => (settings.language === 'ar' ? ar : en)
  const [input, setInput] = useState('')
  const [threshold, setThreshold] = useState(() => readJson<number>(PREFS_KEY, 30))
  const [showSecrets, setShowSecrets] = useState(false)

  useEffect(() => {
    writeJson(PREFS_KEY, threshold)
  }, [threshold])

  const result = useMemo(() => decodePemBundle(input), [input])
  const decoded = input.trim().length > 0 && result.blocks.length > 0
  const infos = result.blocks.map((block) => block.info).filter((info): info is X509Info => info !== null)
  const expired = infos.filter((info) => info.validity?.expired).length
  const expiring = infos.filter((info) => {
    const days = info.validity?.daysRemaining
    return days !== null && days !== undefined && days >= 0 && days <= threshold
  }).length
  const weakKeys = infos.filter((info) => info.publicKey?.weak).length
  const flagged = infos.filter((info) => info.signatureAlgorithm.flagged).length
  const summary = decoded ? bundleToText(result, threshold) : ''

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={L('X.509 / PEM decoder', 'مفكّك X.509 / PEM')}
          icon={<FileKey2 className="h-4 w-4" />}
          subtitle={L(
            'Paste a certificate, a CSR or a full chain. The ASN.1/DER walk runs in this browser only — no upload, no OCSP, no network.',
            'ألصق شهادة أو طلب توقيع شهادة أو سلسلة كاملة. يتم تحليل ASN.1/DER داخل المتصفح فقط — بلا رفع ولا OCSP ولا شبكة.',
          )}
        />
        <div className="space-y-3 p-4">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="min-h-44 font-mono text-xs"
            dir="ltr"
            spellCheck={false}
            aria-label={L('PEM text', 'نص PEM')}
            placeholder={'-----BEGIN CERTIFICATE-----\nMIIDHD...\n-----END CERTIFICATE-----'}
          />
          <div className="flex flex-wrap items-end gap-3">
            <Button size="sm" variant="secondary" onClick={() => setInput(SAMPLE_PEM)}>
              {L('Load sample chain', 'تحميل سلسلة مثال')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setInput('')}>
              {L('Clear', 'مسح')}
            </Button>
            <Button size="sm" variant="secondary" disabled={!decoded} onClick={() => downloadTextFile('certificate-report.txt', summary)}>
              {L('Download report', 'تنزيل التقرير')}
            </Button>
            <Field label={L('Warn if expires within (days)', 'تحذير إذا انتهت خلال (يوم)')} className="w-32">
              <Input
                type="number"
                min={1}
                max={3650}
                value={threshold}
                onChange={(event) => setThreshold(Math.max(1, Math.min(3650, Number(event.target.value) || 30)))}
                dir="ltr"
              />
            </Field>
            <Checkbox label={L('Show CSR password attributes', 'إظهار سمات كلمة المرور في الطلب')} checked={showSecrets} onChange={(event) => setShowSecrets(event.target.checked)} />
          </div>

          {!decoded ? (
            <EmptyState
              icon={<ShieldAlert className="h-5 w-5" />}
              title={input.trim().length > 0 ? L('No readable PEM block found.', 'لم يُعثر على قسم PEM قابل للقراءة.') : L('Paste a PEM block to decode it.', 'ألصق قسم PEM لفك ترميزه.')}
              description={L(
                'Only BEGIN CERTIFICATE and BEGIN CERTIFICATE REQUEST armour is decoded. Private keys are reported as unsupported and never parsed.',
                'يفكّ الترميز أقسام BEGIN CERTIFICATE و BEGIN CERTIFICATE REQUEST فقط. تُبلَّغ المفاتيح الخاصة كنوع غير مدعوم ولا تُحلَّل.',
              )}
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label={L('Blocks', 'الأقسام')} value={result.stats.blocks} />
                <Stat label={L('Certificates', 'الشهادات')} value={result.stats.certificates} />
                <Stat label={L('CSRs', 'الطلبات')} value={result.stats.csrs} />
                <Stat label={L('Deprecated signatures', 'تواقيع مهملة')} value={flagged} tone={flagged ? 'warning' : undefined} />
                <Stat label={L('Expired', 'منتهية')} value={expired} tone={expired ? 'warning' : undefined} />
                <Stat label={L(`Expires ≤ ${threshold}d`, `تنتهي خلال ${threshold} يومًا`)} value={expiring} tone={expiring ? 'warning' : undefined} />
              </div>

              {result.issues.length > 0 ? (
                <Alert tone="danger" title={L('Decoding issues', 'مشكلات في فك الترميز')}>
                  <ul className="space-y-1">
                    {result.issues.map((entry, index) => (
                      <li key={`${entry.code}-${index}`} className="flex flex-wrap gap-2">
                        {entry.block ? <Badge>#{entry.block}</Badge> : null}
                        <Technical value={`${entry.code}: ${entry.detail}`} />
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : null}

              {weakKeys > 0 ? (
                <Alert tone="warning" title={L('Weak subject keys', 'مفاتيح موضوع ضعيفة')}>
                  {L(
                    'RSA below 2048 bits, DSA below 2048 bits and curves below 224 bits are reported as weak by this decoder.',
                    'يُصنّف هذا المفكّك RSA أقل من 2048 بت و DSA أقل من 2048 بت والمنحنيات أقل من 224 بت كمفاتيح ضعيفة.',
                  )}
                </Alert>
              ) : null}
            </>
          )}
        </div>
      </Card>

      {decoded ? (
        <Card>
          <CardHeader title={L('Chain order and name matching', 'ترتيب السلسلة ومطابقة الأسماء')} />
          <div className="p-4">
            <ChainTable checks={result.chainChecks} links={result.links} L={L} />
          </div>
        </Card>
      ) : null}

      {decoded && result.blocks.length > 0 ? (
        <Accordion
          items={result.blocks.map((block) => ({
            id: `block-${block.index}`,
            defaultOpen: block.index === 1,
            title: (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">#{block.index}</span>
                <span>{block.pemType}</span>
                {block.info ? (
                  <span className="min-w-0 max-w-64 truncate text-xs text-subtle" dir="ltr">
                    {block.info.subject?.dn ?? '—'}
                  </span>
                ) : (
                  <Badge tone="danger">{L('error', 'خطأ')}</Badge>
                )}
                {block.info?.signatureAlgorithm.flagged ? <Badge tone="danger">{L('weak signature', 'توقيع ضعيف')}</Badge> : null}
                {block.info?.validity?.expired ? <Badge tone="danger">{L('expired', 'منتهي')}</Badge> : null}
              </span>
            ),
            content: <BlockDetail block={block} L={L} threshold={threshold} showSecrets={showSecrets} lang={settings.language} />,
          }))}
        />
      ) : null}

      {decoded ? (
        <Alert tone="info" title={L('Read the decoded values as untrusted input', 'اقرأ القيم المفكّكة كمدخل غير موثوق')}>
          {L(
            'Subject and SAN strings come from whoever created the certificate. Control and bidirectional-override characters are replaced with \uFFFD, and nothing here is rendered as HTML.',
            'نصوص الموضوع و SAN تأتي من منشئ الشهادة. تُستبدل أحرف التحكم وإعادة اتجاه الكتابة بالرمز \uFFFD، ولا يُعرض أي شيء هنا كـ HTML.',
          )}
        </Alert>
      ) : null}
    </div>
  )
}
