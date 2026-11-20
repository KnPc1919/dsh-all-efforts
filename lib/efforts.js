/**
 * Pure helpers behind the extra DeepSeek reasoning-effort levels.
 *
 * The stock DeepSeek adapter advertises four levels (off/low/high/max). This
 * module widens that set with the two levels other DeepSeek clients show
 * (medium/xhigh) and translates them to the values DeepSeek documents for the
 * wire.
 *
 * DeepSeek's official alias table maps a requested effort to the effort the
 * model actually runs with:
 *
 *   minimal -> low, low -> low, medium -> high, high -> high,
 *   xhigh -> high, max -> max, ultra -> max
 *
 * so medium and xhigh are UI aliases of high. The request body therefore keeps
 * carrying a value the API accepts (low/high/max).
 */

/** Levels added on top of the stock set, in presentation order. */
export const EXTRA_EFFORTS = Object.freeze([
  Object.freeze({
    id: 'medium',
    name: 'Medium',
    description: 'DeepSeek maps medium to its high effort. Use for everyday reasoning.',
  }),
  Object.freeze({
    id: 'xhigh',
    name: 'XHigh',
    description: 'DeepSeek maps xhigh to its high effort. Use for quality-first work.',
  }),
])

/** Presentation order of the extended set. */
export const LEVEL_ORDER = Object.freeze(['off', 'low', 'medium', 'high', 'xhigh', 'max'])

/** The exact ids the stock DeepSeek adapter advertises. */
const STOCK_IDS = Object.freeze(['off', 'low', 'high', 'max'])

/** UI level -> DeepSeek wire value (official alias table). */
export const WIRE_ALIASES = Object.freeze({ medium: 'high', xhigh: 'high' })

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
 * Translate a call's reasoning effort to its DeepSeek wire value.
 *
 * Returns the input object itself when no translation is needed, so untouched
 * calls stay byte-for-byte identical.
 */
export function translateOptions(options) {
  const effort = options && typeof options === 'object' ? options.reasoningEffort : undefined
  const mapped = typeof effort === 'string' ? WIRE_ALIASES[effort] : undefined
  if (!mapped || mapped === effort) return options
  return { ...options, reasoningEffort: mapped }
}
