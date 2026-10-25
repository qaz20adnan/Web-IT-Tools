import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchText } from '../netlify/lib/fetch'

describe('fetchText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports an unreachable upstream with an actionable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    await expect(fetchText('https://example.supabase.co/auth/v1/signup')).rejects.toMatchObject({
      statusCode: 502,
      code: 'upstream_error',
      message: 'The upstream service could not be reached. Check its URL and the server network connection.',
      detail: 'fetch failed',
    })
  })
})
