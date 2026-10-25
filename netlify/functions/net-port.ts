import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, portRequestSchema } from '../lib/schema'
import { checkPorts, PUBLIC_PORT_ALLOWLIST } from '../lib/net-diagnostics'

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`net-port:${clientIp(event, context)}`, 8)
  const parsed = portRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  const allowed = new Set<number>(PUBLIC_PORT_ALLOWLIST)
  const rejected = parsed.data.ports.filter((port) => !allowed.has(port))
  if (rejected.length > 0) {
    throw new HttpError(400, 'invalid_input', `These ports are not on the public allowlist: ${rejected.join(', ')}. Allowed: ${[...allowed].join(', ')}.`)
  }
  const result = await checkPorts(parsed.data.host, parsed.data.ports)
  return json(200, result)
})
