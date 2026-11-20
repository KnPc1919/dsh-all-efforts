/**
 * Pure helpers behind the extra DeepSeek reasoning-effort levels.
 *
 * The stock DeepSeek adapter advertises four levels (off/low/high/max) and its
 * serializer refuses anything else. This module widens that set with the two
 * levels other DeepSeek clients show (medium/xhigh) and keeps the helpers that
 * put the requested level on the wire verbatim.
 *
 * DeepSeek's documented alias table (what a client asks for -> what the model
 * runs with) is minimal->low, low->low, medium->high, high->high, xhigh->high,
 * max->max, ultra->max. DSH's built-in serializer only accepts low/high/max, so
 * getting `medium`/`xhigh` onto the wire needs a request-body rewrite; mapping
 * them to `high` is only the safety net used when DeepSeek rejects the literal
 * value (see lib/wire.js).
 */

/** Levels added on top of the stock set, in presentation order. */
export const EXTRA_EFFORTS = Object.freeze([
  Object.freeze({
    id: 'medium',
    name: 'Medium',
    description: 'Intermediate reasoning effort, sent to DeepSeek verbatim.',
  }),
  Object.freeze({
    id: 'xhigh',
    name: 'XHigh',
    description: 'Extra-high reasoning effort, sent to DeepSeek verbatim.',
  }),
])

/** Presentation order of the extended set. */
export const LEVEL_ORDER = Object.freeze(['off', 'low', 'medium', 'high', 'xhigh', 'max'])

/** The exact ids the stock DeepSeek adapter advertises. */
const STOCK_IDS = Object.freeze(['off', 'low', 'high', 'max'])

/**
 * Fallback mapping used only if the endpoint rejects a literal medium/xhigh
 * value. Mirrors DeepSeek's documented alias table.
 */
export const WIRE_ALIASES = Object.freeze({ medium: 'high', xhigh: 'high' })

/**
 * Placeholder level handed to the stock serializer while the real value is
 * restored on the request body. Must stay inside the serializer's own allowed
 * set (off/low/high/max), and must keep thinking enabled.
 */
export const PLACEHOLDER_EFFORT = 'high'

/** True for the two levels this plugin adds. */
export function isExtraEffort(effort) {
  return typeof effort === 'string' && Object.hasOwn(WIRE_ALIASES, effort)
}

function isStockSet(efforts) {
  if (efforts.length !== STOCK_IDS.length) return false
  return efforts.every((effort, index) => effort && typeof effort === 'object' && effort.id === STOCK_IDS[index])
}

/**
 * Widen a reasoning.efforts list with medium/xhigh.
 *
 * Returns the input untouched unless it is exactly the stock DeepSeek set, so
 * models with thinking disabled (off only) and any future adapter revision that
 * changes the list keep their own behaviour.
 */
export function extendEfforts(efforts) {
  if (!Array.isArray(efforts) || !isStockSet(efforts)) return efforts
  const byId = new Map(efforts.map((effort) => [effort.id, effort]))
  for (const extra of EXTRA_EFFORTS) {
    if (!byId.has(extra.id)) byId.set(extra.id, { ...extra })
  }
  return LEVEL_ORDER.map((id) => byId.get(id)).filter((effort) => effort !== undefined)
}

/** Widen the reasoning block of one resolved model info, if it is stock. */
export function extendModelInfo(info) {
  if (!info || typeof info !== 'object') return info
  const reasoning = info.reasoning
  if (!reasoning || !Array.isArray(reasoning.efforts)) return info
  const efforts = extendEfforts(reasoning.efforts)
  if (efforts === reasoning.efforts) return info
  return { ...info, reasoning: { ...reasoning, efforts } }
}

/**
 * Rewrite the serialized Messages request body so it carries `effort` verbatim.
 *
 * The stock serializer already emitted a legal placeholder effort; this replaces
 * that value with the level the user picked and leaves every other field as-is.
 * Input that is not a JSON object string is returned untouched, so a request we
 * do not understand is never corrupted.
 */
export function rewritePayload(payload, effort) {
  if (typeof payload !== 'string' || !isExtraEffort(effort)) return payload
  let body
  try {
    body = JSON.parse(payload)
  } catch {
    return payload
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return payload
  const previous = body.output_config && typeof body.output_config === 'object' ? body.output_config : {}
  return JSON.stringify({
    ...body,
    thinking: { type: 'enabled' },
    output_config: { ...previous, effort },
  })
}
