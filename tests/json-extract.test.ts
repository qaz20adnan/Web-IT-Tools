import { describe, expect, it } from 'vitest'
import { HttpError } from '../netlify/lib/http'
import { extractJsonObject } from '../netlify/lib/json'

/**
 * Every structured answer the AI tools show begins here. A model wraps its JSON in
 * prose or a code fence almost always, so this helper decides whether the user sees
 * a result or a failure — and the two failure sentences are the only thing that
 * distinguishes "the model said nothing machine-readable" from "the model said
 * something broken". Both must stay distinguishable, and neither may throw a raw
 * `SyntaxError` at a handler.
 */

function failure(raw: string): HttpError {
  try {
    extractJsonObject(raw)
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError)
    return error as HttpError
  }
  throw new Error('expected extractJsonObject to reject the answer')
}

describe('extractJsonObject recovers an object from a model answer', () => {
  const cases: Array<[string, string, unknown]> = [
    ['a bare object', '{"a":1}', { a: 1 }],
    ['a json fence', '```json\n{"a":1}\n```', { a: 1 }],
    ['an uppercase fence', '```JSON\n{"a":1}```', { a: 1 }],
    ['an empty object', '{}', {}],
    ['nested braces inside a fence', '```json\n{"a":{"b":[1,2]}}\n```', { a: { b: [1, 2] } }],
    ['prose before and after', 'Here you go: {"a":1} — done.', { a: 1 }],
    ['a fence in another language', '```ts\n{"a":1}\n```', { a: 1 }],
    ['trailing text that opens a brace', '{"a":1} trailing {', { a: 1 }],
    ['whitespace around the object', '   \n {"a":1}  \n', { a: 1 }],
    ['a fence with prose after it', '```json\n{"a":1}\n```\nP.S. {note}', { a: 1 }],
    ['the fenced object beats a second one outside', '```json\n{"tool":"ping"}\n```\nOr maybe {"tool":"dns"}', { tool: 'ping' }],
  ]

  it.each(cases)('reads %s', (_label, raw, expected) => {
    expect(extractJsonObject(raw)).toEqual(expected)
  })
})

describe('the two failure sentences stay distinct', () => {
  it('says nothing machine-readable was returned', () => {
    for (const raw of ['no json here', '', '   ', '{', 'an explanation with } but no start', '```json\n[1,2]\n```']) {
      const error = failure(raw)
      expect(error.statusCode).toBe(422)
      expect(error.code).toBe('upstream_error')
      expect(error.message).toBe('The model did not return a JSON object. Try again or switch models.')
    }
  })

  it('says the object it found was malformed', () => {
    for (const raw of ['{"a":}', '[{"a":1},{"b":2}]', '{"a":1}\n\n{"b":2}', 'The answer is {"a":1}. I hope {that} helps', '{"a":undefined}']) {
      const error = failure(raw)
      expect(error.statusCode).toBe(422)
      expect(error.code).toBe('upstream_error')
      expect(error.message).toBe('The model returned malformed JSON. Try again or switch models.')
    }
  })

  it('answers with an HttpError, never a raw SyntaxError, on a truncated object', () => {
    const error = failure('{"a":')
    expect(error.name).toBe('HttpError')
    // No closing brace at all, so the helper reports "no object" rather than "broken object".
    expect(error.message).toBe('The model did not return a JSON object. Try again or switch models.')
  })

  it('names the switch-models remedy in both sentences', () => {
    expect(failure('nothing').message).toMatch(/switch models/)
    expect(failure('{').message).toMatch(/switch models/)
  })
})

describe('the slicing rule is documented by its own limits', () => {
  it('takes the first brace to the last one, so two answers in one reply fail', () => {
    // Pinned rather than fixed: the helper cannot know which object was meant, and
    // guessing would show the user the wrong analysis.
    const error = failure('{"tool":"ping"}\n\n{"tool":"traceroute"}')
    expect(error.message).toBe('The model returned malformed JSON. Try again or switch models.')
  })

  it('drops a top-level array rather than returning its first item', () => {
    expect(failure('[{"a":1},{"b":2}]').message).toBe('The model returned malformed JSON. Try again or switch models.')
  })

  it('ignores a fence label but not its content', () => {
    expect(extractJsonObject('```ts\ninterface Shape {"a":1}\n```')).toEqual({ a: 1 })
  })
})
