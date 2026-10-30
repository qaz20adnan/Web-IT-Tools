import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { normalizeDnsName, pointerName, resolveDoh, type DohResolution, type DnsRecordType } from '../lib/net-doh'
import { enforceRateLimit } from '../lib/rate'
import { dnsRequestSchema, flattenZod } from '../lib/schema'

/**
 * DNS lookups ask public resolvers about a name; they never open a socket to it.
 * That is why this route does not use the connect-target guard: `_dmarc`, SRV and
 * not-yet-existing names are legitimate questions, and an unanswered name is a
 * result rather than a client error.
 */

function outcomeLabel(outcome: DohResolution['outcome']): string {
  return {
    answered: 'Answered',
    nxdomain: 'NXDOMAIN — no such name',
    'no-data': 'The name exists but has no record of this type',
    servfail: 'SERVFAIL — the authoritative servers failed',
    refused: 'REFUSED — the resolver declined to answer',
    error: 'The resolver could not be reached',
  }[outcome]
}

function agree(resolutions: DohResolution[]): boolean {
  const signatures = resolutions
    .filter((entry) => entry.errorCode === null)
    .map((entry) => `${entry.outcome}:${entry.answers.map((answer) => answer.data).sort().join(',')}`)
  return new Set(signatures).size <= 1
}

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`dns:${clientIp(event, context)}`, 30)
  const parsed = dnsRequestSchema.safeParse(readJsonBody(event, 32 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))

  let name: string
  try {
    name = normalizeDnsName(parsed.data.host)
  } catch (error) {
    throw new HttpError(400, 'invalid_input', error instanceof Error ? error.message : 'Enter a valid hostname.')
  }

  const type = parsed.data.type as DnsRecordType
  let queried = name
  if (type === 'PTR') {
    const arpa = pointerName(name)
    if (!arpa) throw new HttpError(400, 'invalid_input', 'Enter an IP address to look up its reverse record.')
    queried = arpa
  }

  const resolutions = await resolveDoh(queried, type, ['cloudflare', 'google'])
  const answered = resolutions.find((entry) => entry.outcome === 'answered') ?? resolutions[0]
  const reachable = resolutions.filter((entry) => entry.errorCode === null)

  return json(200, {
    name: queried,
    askedAs: name,
    type,
    checkedAt: new Date().toISOString(),
    outcome: reachable.length === 0 ? 'error' : answered.outcome,
    outcomeLabel: outcomeLabel(answered.outcome),
    rcode: answered.rcode,
    answers: answered.answers,
    resolvers: resolutions.map((entry) => ({
      resolver: entry.resolver,
      outcome: entry.outcome,
      rcode: entry.rcode,
      elapsedMs: entry.elapsedMs,
      errorCode: entry.errorCode,
      answers: entry.answers,
    })),
    agreement: agree(resolutions),
    note:
      reachable.length === 0
        ? 'No public resolver answered. This is a resolver problem, not an answer about the name.'
        : 'TTLs and RCODEs are read directly from public DNS-over-HTTPS resolvers, so a difference between them means the record is still propagating.',
  })
})
