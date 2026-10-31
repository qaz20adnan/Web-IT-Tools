import dns from 'node:dns/promises'
import net from 'node:net'
import { allowedHosts, defaultBaseUrl, serverConfig } from './env'
import { HttpError } from './http'

const BUILTIN_HOSTS = new Set(
  (['openai', 'anthropic', 'gemini', 'openrouter', 'ollama'] as const)
    .map((kind) => defaultBaseUrl(kind))
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value).hostname.toLowerCase()),
)

const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa']

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fe80')) return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (normalized.startsWith('ff')) return true
  if (normalized.startsWith('2001:db8')) return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])
  return false
}

function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) return isPrivateIpv6(address)
  return true
}

export function normalizeHost(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!value || value.length > 253) throw new HttpError(400, 'invalid_input', 'Enter a valid hostname.')
  if (net.isIP(value)) return value
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) {
    throw new HttpError(400, 'invalid_input', 'Enter a valid public hostname, not a URL or path.')
  }
  return value
}

export async function assertPublicHost(rawHost: string, options: { allowLocal?: boolean } = {}): Promise<string> {
  const target = await resolvePublicAddress(rawHost, options)
  return target.host
}

export interface PublicTarget {
  /** The hostname the caller asked for, normalized. */
  host: string
  /** The literal address that passed the policy — connect to this, not to `host`. */
  address: string
  family: 4 | 6
}

/**
 * Resolves **once**, validates every answer, and returns the address to connect
 * to. `assertPublicHost()` on its own is not enough in front of a socket: a
 * caller that validates a name and then connects by that name resolves a second
 * time, and a record that flips between the two lookups gets a public check and
 * a private connection (finding M-3, DNS rebinding).
 */
export async function resolvePublicAddress(
  rawHost: string,
  options: { allowLocal?: boolean } = {},
): Promise<PublicTarget> {
  const host = normalizeHost(rawHost)
  const allowLocal = options.allowLocal ?? serverConfig.allowLocalAi
  const local = host === 'localhost' || host === '::1' || host === '127.0.0.1'
  if (local && !allowLocal) throw new HttpError(403, 'blocked_host', 'Local hosts are disabled on this deployment.')
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new HttpError(403, 'blocked_host', 'Internal hostnames are not allowed.')
  }

  const literalFamily = net.isIP(host)
  if (literalFamily) {
    if (!local && isPrivateAddress(host)) {
      throw new HttpError(403, 'blocked_host', 'Private or reserved addresses are not allowed.')
    }
    return { host, address: host, family: literalFamily as 4 | 6 }
  }

  let answers: Array<{ address: string; family: number }>
  try {
    answers = await dns.lookup(host, { all: true, verbatim: true })
  } catch {
    throw new HttpError(400, 'blocked_host', 'The hostname could not be resolved.')
  }
  if (answers.length === 0 || (!local && answers.some((entry) => isPrivateAddress(entry.address)))) {
    throw new HttpError(403, 'blocked_host', 'The hostname resolves to a private or reserved address.')
  }
  // Prefer v4 the way the socket-facing helpers in `net-diagnostics.ts` do, so one
  // hostname gets the same family from the checker and from the connection.
  const chosen = answers.find((entry) => entry.family === 4) ?? answers[0]
  return { host, address: chosen.address, family: chosen.family as 4 | 6 }
}

export function hostAllowed(host: string): boolean {
  const normalized = host.toLowerCase()
  if (BUILTIN_HOSTS.has(normalized)) return true
  if (allowedHosts().includes(normalized)) return true
  if (allowedHosts().some((entry) => entry.startsWith('.') && normalized.endsWith(entry))) return true
  return false
}

export async function validateAiEndpoint(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new HttpError(400, 'invalid_input', 'The provider base URL is not valid.')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(serverConfig.allowLocalAi && local && url.protocol === 'http:')) {
    throw new HttpError(403, 'blocked_host', 'AI endpoints must use HTTPS. Local HTTP is allowed only when ALLOW_LOCAL_AI=true.')
  }
  await assertPublicHost(url.hostname, { allowLocal: local })
  if (!hostAllowed(url.hostname)) {
    throw new HttpError(403, 'blocked_host', 'This provider host is not in AI_ALLOWED_HOSTS.')
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'invalid_input', 'Credentials must not be embedded in the base URL.')
  }
  return url
}
