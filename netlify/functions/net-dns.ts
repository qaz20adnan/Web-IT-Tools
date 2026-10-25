import { requireMember } from '../lib/auth'
import dns from 'node:dns/promises'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { assertPublicHost } from '../lib/host'
import { enforceRateLimit } from '../lib/rate'
import { dnsRequestSchema, flattenZod } from '../lib/schema'

const TYPE_CODES: Record<string, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  CAA: 257,
}

interface Answer {
  name: string
  type: number
  ttl: number
  data: string
}

function represent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join(' ')
  if (!value || typeof value !== 'object') return String(value)
  const record = value as Record<string, unknown>
  if (record.exchange !== undefined) return `${record.priority ?? 0} ${record.exchange}`
  if (record.nsname !== undefined) {
    return [record.nsname, record.hostmaster, record.serial, record.refresh, record.retry, record.expire, record.minttl].join(' ')
  }
  if (record.name !== undefined && record.port !== undefined) return `${record.priority ?? 0} ${record.weight ?? 0} ${record.port} ${record.name}`
  if (record.issue !== undefined || record.issuewild !== undefined || record.iodef !== undefined) {
    const tag = record.issue !== undefined ? 'issue' : record.issuewild !== undefined ? 'issuewild' : 'iodef'
    return `${record.critical ?? 0} ${tag} "${record[tag] ?? ''}"`
  }
  if (record.buffer !== undefined) return String(record.buffer)
  return JSON.stringify(value)
}

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`dns:${clientIp(event, context)}`, 30)
  const parsed = dnsRequestSchema.safeParse(readJsonBody(event, 32 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  const host = await assertPublicHost(parsed.data.host)
  const type = parsed.data.type

  let records: unknown[] = []
  try {
    if (type === 'A') records = await dns.resolve4(host)
    else if (type === 'AAAA') records = await dns.resolve6(host)
    else if (type === 'CNAME') records = await dns.resolveCname(host)
    else if (type === 'MX') records = await dns.resolveMx(host)
    else if (type === 'NS') records = await dns.resolveNs(host)
    else if (type === 'TXT') records = await dns.resolveTxt(host)
    else if (type === 'SOA') records = [await dns.resolveSoa(host)]
    else if (type === 'CAA') records = await dns.resolveCaa(host)
    else if (type === 'SRV') records = await dns.resolveSrv(host)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return json(200, { answers: [], status: code === 'ENOTFOUND' ? 3 : 0 })
    }
    throw new HttpError(502, 'upstream_error', 'The DNS resolver failed.', code ?? undefined)
  }

  const answers: Answer[] = records.map((record) => ({
    name: host,
    type: TYPE_CODES[type] ?? 0,
    ttl: 0,
    data: represent(record),
  }))
  return json(200, { answers, status: 0 })
})
