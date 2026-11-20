/**
 * Puts the requested reasoning effort on the DeepSeek request body verbatim.
 *
 * DSH's DeepSeek serializer validates the effort against off/low/high/max and
 * writes it into `output_config.effort`; the adapter exposes no transport hook.
 * So the plugin:
 *
 *   1. hands the stock serializer a legal placeholder level (high),
 *   2. dispatches the call inside an AsyncLocalStorage scope that remembers the
 *      level the user actually picked,
 *   3. wraps `globalThis.fetch` once, so the outgoing JSON body has its
 *      `output_config.effort` replaced with that level.
 *
 * If the endpoint ever rejects the literal value, the iterator retries exactly
 * once with DeepSeek's documented alias (medium/xhigh -> high) and reports it,
 * so a rejected level never turns into a broken conversation.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { PLACEHOLDER_EFFORT, WIRE_ALIASES, isExtraEffort, rewritePayload } from './efforts.js'

const wire = new AsyncLocalStorage()

let installing = false

/** The verbatim effort in scope for the current dispatch, if any. */
export function currentWireEffort() {
  const store = wire.getStore()
  return store && typeof store.effort === 'string' ? store.effort : undefined
}

function isMessagesRequest(input) {
  try {
    const url = typeof input === 'string' ? input : input?.url
    if (typeof url !== 'string' || url.length === 0) return false
    return new URL(url).pathname.endsWith('/messages')
  } catch {
    return false
  }
}

/**
 * Install the request-body rewriter on `globalThis.fetch`. Idempotent: the
 * second call returns a no-op disposer. The returned disposer restores the
 * previous fetch only if ours is still the active one.
 */
export function installWireRewrite() {
  if (installing) return () => {}
  const base = globalThis.fetch
  if (typeof base !== 'function') return () => {}
  installing = true

  const patched = function dshAllEffortsFetch(input, init) {
    const effort = currentWireEffort()
    if (effort !== undefined && init && typeof init.body === 'string' && isMessagesRequest(input)) {
      const body = rewritePayload(init.body, effort)
      if (body !== init.body) init = { ...init, body }
    }
    return base.call(this, input, init)
  }

  globalThis.fetch = patched
  return function uninstall() {
    if (globalThis.fetch === patched) globalThis.fetch = base
  }
}

/** Run one iterator step inside the verbatim-effort scope. */
function scoped(iterable, effort) {
  const inner = iterable[Symbol.asyncIterator]()
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    next(value) {
      return wire.run({ effort }, () => inner.next(value))
    },
    return(value) {
      if (typeof inner.return !== 'function') return Promise.resolve({ done: true, value })
      return wire.run({ effort }, () => inner.return(value))
    },
    throw(error) {
      if (typeof inner.throw !== 'function') return Promise.reject(error)
      return wire.run({ effort }, () => inner.throw(error))
    },
  }
}

function looksRejected(error) {
  const status = error?.failure?.status ?? error?.status
  if (Number.isInteger(status)) return status >= 400 && status < 500
  const code = error?.failure?.code ?? error?.code
  return code === 'INVALID_REQUEST' || code === 'UNSUPPORTED_REASONING_EFFORT'
}

async function* withFallback(attempt, requested, onFallback) {
  let produced = 0
  try {
    for await (const chunk of attempt(true)) {
      produced += 1
      yield chunk
    }
    return
  } catch (error) {
    if (produced > 0 || !looksRejected(error)) throw error
    onFallback?.(requested, error)
  }
  yield* attempt(false)
}

/**
 * Dispatch one DeepSeek call, carrying medium/xhigh verbatim when requested.
 *
 * Calls with any other effort are passed to the original method untouched.
 */
export function dispatchEffort(original, receiver, options, onFallback) {
  const requested = options && typeof options === 'object' ? options.reasoningEffort : undefined
  if (!isExtraEffort(requested)) return original.call(receiver, options)

  const attempt = (verbatim) => {
    const nextOptions = verbatim
      ? { ...options, reasoningEffort: PLACEHOLDER_EFFORT }
      : { ...options, reasoningEffort: WIRE_ALIASES[requested] }
    const iterable = original.call(receiver, nextOptions)
    return verbatim ? scoped(iterable, requested) : iterable
  }

  return withFallback(attempt, requested, onFallback)
}
