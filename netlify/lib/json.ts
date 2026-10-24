import { HttpError } from './http'

export function extractJsonObject<T = unknown>(raw: string): T {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new HttpError(422, 'upstream_error', 'The model did not return a JSON object. Try again or switch models.')
  }
  const candidate = text.slice(start, end + 1)
  try {
    return JSON.parse(candidate) as T
  } catch {
    throw new HttpError(422, 'upstream_error', 'The model returned malformed JSON. Try again or switch models.')
  }
}
