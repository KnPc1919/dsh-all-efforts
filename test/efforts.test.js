import assert from 'node:assert/strict'
import test from 'node:test'
import { extendEfforts, extendModelInfo, isExtraEffort, rewritePayload } from '../lib/efforts.js'
import { patchAdapterPrototype } from '../index.js'

const stockEfforts = () => [
  { id: 'off', name: 'Off', description: 'off' },
  { id: 'low', name: 'Low', description: 'low' },
  { id: 'high', name: 'High', description: 'high' },
  { id: 'max', name: 'Max', description: 'max' },
]

const stockInfo = () => ({
  provider: 'deepseek-official',
  id: 'deepseek-flash',
  name: 'DeepSeek Flash',
  contextWindow: 128000,
  defaultMaxTokens: 8192,
  reasoning: { efforts: stockEfforts(), defaultEffort: 'high' },
})

const ids = (info) => info.reasoning.efforts.map((effort) => effort.id)
const extended = ['off', 'low', 'medium', 'high', 'xhigh', 'max']

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

test('extendEfforts inserts medium and xhigh in presentation order', () => {
  const original = stockEfforts()
  const widened = extendEfforts(original)
  assert.deepEqual(widened.map((effort) => effort.id), extended)
  assert.equal(widened[1], original[1])
  assert.equal(widened[3], original[2])
  assert.equal(original.length, 4)
  assert.equal(original[2].id, 'high')
})

test('extendEfforts leaves non-stock sets alone', () => {
  const offOnly = [{ id: 'off', name: 'Off', description: 'off' }]
  assert.equal(extendEfforts(offOnly), offOnly)
  const custom = [{ id: 'low', name: 'Low', description: 'low' }, { id: 'high', name: 'High', description: 'high' }]
  assert.equal(extendEfforts(custom), custom)
  const already = extendEfforts(stockEfforts())
  assert.equal(extendEfforts(already), already)
  assert.equal(extendEfforts(undefined), undefined)
})

test('extendModelInfo keeps the default effort and leaves OFF_ONLY models alone', () => {
  const info = stockInfo()
  const widened = extendModelInfo(info)
  assert.deepEqual(ids(widened), extended)
  assert.equal(widened.reasoning.defaultEffort, 'high')
  assert.equal(info.reasoning.efforts.length, 4)
  const offOnly = { ...stockInfo(), reasoning: { efforts: [{ id: 'off', name: 'Off', description: 'off' }], defaultEffort: 'off' } }
  assert.equal(extendModelInfo(offOnly), offOnly)
  assert.equal(extendModelInfo(null), null)
})

test('isExtraEffort recognises exactly the two new levels', () => {
  assert.equal(isExtraEffort('medium'), true)
  assert.equal(isExtraEffort('xhigh'), true)
  assert.equal(isExtraEffort('high'), false)
  assert.equal(isExtraEffort('toString'), false)
  assert.equal(isExtraEffort(undefined), false)
})

test('rewritePayload writes the requested effort and keeps the rest of the body', () => {
  const body = JSON.stringify({ model: 'deepseek-flash', thinking: { type: 'enabled' }, output_config: { effort: 'high' }, max_tokens: 64 })
  const rewritten = JSON.parse(rewritePayload(body, 'medium'))
  assert.equal(rewritten.output_config.effort, 'medium')
  assert.equal(rewritten.thinking.type, 'enabled')
  assert.equal(rewritten.model, 'deepseek-flash')
  assert.equal(rewritten.max_tokens, 64)

  const noEffort = JSON.parse(rewritePayload(JSON.stringify({ model: 'x', stream: true }), 'xhigh'))
  assert.equal(noEffort.output_config.effort, 'xhigh')
  assert.equal(noEffort.stream, true)
})

test('rewritePayload never touches input it cannot rewrite', () => {
  const body = JSON.stringify({ output_config: { effort: 'high' } })
  assert.equal(rewritePayload(body, 'high'), body)
  assert.equal(rewritePayload('not json', 'medium'), 'not json')
  assert.equal(rewritePayload('[1,2]', 'medium'), '[1,2]')
  assert.equal(rewritePayload(undefined, 'medium'), undefined)
})

class FakeDeepSeekAdapter {
  async resolveModel() {
    return stockInfo()
  }

  async listModels() {
    return [stockInfo()]
  }

  async prepareCall() {
    const self = this
    return { model: stockInfo(), stream: (options) => self.stream(options) }
  }

  async *stream(options) {
    yield { via: 'stream', options }
  }
}

test('patchAdapterPrototype widens both dispatch paths and is idempotent', async () => {
  const proto = FakeDeepSeekAdapter.prototype
  assert.equal(patchAdapterPrototype(proto), true)
  assert.equal(patchAdapterPrototype(proto), false)

  const adapter = new FakeDeepSeekAdapter()
  assert.deepEqual(ids(await adapter.resolveModel()), extended)
  const listed = await adapter.listModels()
  assert.deepEqual(ids(listed[0]), extended)

  const call = await adapter.prepareCall()
  assert.deepEqual(ids(call.model), extended)

  const medium = await collect(call.stream({ reasoningEffort: 'medium' }))
  assert.equal(medium[0].options.reasoningEffort, 'high')
  const xhigh = await collect(adapter.stream({ reasoningEffort: 'xhigh' }))
  assert.equal(xhigh[0].options.reasoningEffort, 'high')
  const max = await collect(adapter.stream({ reasoningEffort: 'max' }))
  assert.equal(max[0].options.reasoningEffort, 'max')
})
