import assert from 'node:assert/strict'
import test from 'node:test'
import { extendEfforts, extendModelInfo, translateOptions } from '../lib/efforts.js'
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

test('translateOptions maps only the two aliases', () => {
  assert.equal(translateOptions({ reasoningEffort: 'medium' }).reasoningEffort, 'high')
  assert.equal(translateOptions({ reasoningEffort: 'xhigh' }).reasoningEffort, 'high')
  const low = { reasoningEffort: 'low' }
  assert.equal(translateOptions(low), low)
  const none = {}
  assert.equal(translateOptions(none), none)
})

class FakeDeepSeekAdapter {
  async resolveModel() {
    return stockInfo()
  }

  async listModels() {
    return [stockInfo()]
  }

  async prepareCall() {
    return { model: stockInfo(), stream: (options) => ({ via: 'prepareCall', options }) }
  }

  stream(options) {
    return { via: 'stream', options }
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
  assert.equal(call.stream({ reasoningEffort: 'medium' }).options.reasoningEffort, 'high')
  assert.equal(call.stream({ reasoningEffort: 'xhigh' }).options.reasoningEffort, 'high')
  assert.equal(call.stream({ reasoningEffort: 'max' }).options.reasoningEffort, 'max')

  assert.equal(adapter.stream({ reasoningEffort: 'xhigh' }).options.reasoningEffort, 'high')
  assert.equal(adapter.stream({ reasoningEffort: 'off' }).options.reasoningEffort, 'off')
})

test('patchAdapterPrototype refuses objects without the public surface', () => {
  class NotAnAdapter {
    stream() {}
  }
  assert.equal(patchAdapterPrototype(NotAnAdapter.prototype), false)
  assert.equal(patchAdapterPrototype(undefined), false)
})
