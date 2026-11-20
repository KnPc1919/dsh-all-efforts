/**
 * dsh-all-efforts — restore the Medium and XHigh reasoning-effort levels that
 * DeepSeek Harness leaves out of its built-in DeepSeek adapter.
 *
 * The plugin is a host-only Cordis bundle: it waits for the `llm` service,
 * looks at the registered adapters, and wraps the public methods of every
 * DeepSeek adapter instance. No imports from the DeepSeek packages are needed,
 * so the bundle works from any profile no matter where DSH is installed.
 *
 * Public adapter surface used (declared in
 * @deepseek-ai/dsh-llm-deepseek/lib/types/adapter.d.ts):
 *   resolveModel(provider, model, signal) -> model info
 *   prepareCall(provider, model, signal)  -> { model, stream(options) }
 *   stream(options)                       -> async iterable of chunks
 *   listModels(provider)                  -> catalog entries
 *
 * Medium and XHigh are dispatched verbatim: the stock serializer only accepts
 * off/low/high/max, so the call is dispatched with a legal placeholder and the
 * outgoing request body is rewritten to the requested level (see lib/wire.js).
 *
 * Each wrapper is idempotent and feature-detected: an adapter whose shape no
 * longer matches is left alone, and a missing registry only produces one log
 * line instead of a startup failure.
 */
import { extendModelInfo } from './lib/efforts.js'
import { dispatchEffort, installWireRewrite } from './lib/wire.js'

export const name = 'dsh-all-efforts'
export const inject = ['llm']

/** Marks a prototype that already carries the wrappers; stores the originals. */
const PATCHED = Symbol.for('dsh-all-efforts.patched')

function createLogger(ctx) {
  let logger
  try {
    logger = typeof ctx?.logger === 'function' ? ctx.logger(name) : ctx?.logger
  } catch {
    logger = undefined
  }
  return (level, message) => {
    try {
      const write = logger?.[level]
      if (typeof write === 'function') write.call(logger, message)
    } catch {
      // Diagnostics must never affect startup.
    }
  }
}

function isDeepSeekAdapter(adapter) {
  const ctor = adapter?.constructor
  return typeof ctor === 'function' && typeof ctor.name === 'string' && ctor.name.endsWith('DeepSeekAdapter')
}

/**
 * Wrap one DeepSeek adapter prototype. Exported for tests; the second call on
 * the same prototype is a no-op. `log` is optional and only used to report a
 * rejected effort level.
 */
export function patchAdapterPrototype(proto, log = () => {}) {
  if (!proto || proto[PATCHED]) return false
  const original = {
    resolveModel: proto.resolveModel,
    listModels: proto.listModels,
    prepareCall: proto.prepareCall,
    stream: proto.stream,
  }
  if (
    typeof original.resolveModel !== 'function'
    || typeof original.prepareCall !== 'function'
    || typeof original.stream !== 'function'
  ) {
    return false
  }

  const onFallback = (requested, error) => {
    const reason = error?.message ?? String(error)
    log('warn', `DeepSeek rejected reasoning effort "${requested}"; retried with "${WIRE_FALLBACK[requested] ?? 'high'}" (${reason})`)
  }

  Object.defineProperty(proto, PATCHED, { value: original, enumerable: false, configurable: true })

  proto.resolveModel = async function resolveModelWithExtraEfforts(...args) {
    return extendModelInfo(await original.resolveModel.apply(this, args))
  }

  if (typeof original.listModels === 'function') {
    proto.listModels = async function listModelsWithExtraEfforts(...args) {
      const models = await original.listModels.apply(this, args)
      return Array.isArray(models) ? models.map((model) => extendModelInfo(model)) : models
    }
  }

  proto.prepareCall = async function prepareCallWithExtraEfforts(...args) {
    const call = await original.prepareCall.apply(this, args)
    if (!call || typeof call !== 'object') return call
    const model = extendModelInfo(call.model)
    const inner = call.stream
    if (typeof inner !== 'function') return { ...call, model }
    return { ...call, model, stream: (options) => dispatchEffort(inner, call, options, onFallback) }
  }

  proto.stream = function streamWithExtraEfforts(options) {
    return dispatchEffort(original.stream, this, options, onFallback)
  }

  return true
}

/** Alias table mirrored for the warning message only. */
const WIRE_FALLBACK = Object.freeze({ medium: 'high', xhigh: 'high' })

export function apply(ctx) {
  const log = createLogger(ctx)
  const registry = ctx?.llm?.adapters
  if (!(registry instanceof Map)) {
    log('warn', 'llm adapter registry unavailable; DeepSeek keeps its stock effort levels')
    return
  }

  installWireRewrite()

  const seen = new WeakSet()
  const scan = () => {
    let patched = 0
    for (const entry of registry.values()) {
      const adapter = entry?.adapter ?? entry
      if (!adapter || typeof adapter !== 'object' || !isDeepSeekAdapter(adapter)) continue
      const proto = Object.getPrototypeOf(adapter)
      if (!proto || seen.has(proto)) continue
      seen.add(proto)
      if (patchAdapterPrototype(proto, log)) patched += 1
    }
    if (patched > 0) log('info', `extended DeepSeek reasoning efforts on ${patched} adapter(s)`)
    return patched
  }

  if (scan() === 0) log('debug', 'no DeepSeek adapter registered yet; waiting for llm/adapters-updated')
  if (typeof ctx.on === 'function') {
    ctx.on('llm/adapters-updated', () => {
      scan()
    })
  }
}

export default { name, inject, apply }
