import { serverConfig } from './env'
import { HttpError } from './http'

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function enforceRateLimit(key: string, max = serverConfig.rateMax, windowMs = serverConfig.rateWindowMs): void {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    if (buckets.size > 5000) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(entryKey)
      }
    }
    return
  }
  if (bucket.count >= max) {
    const seconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    throw new HttpError(429, 'rate_limited', `Rate limit reached. Try again in ${seconds} seconds.`)
  }
  bucket.count += 1
}
