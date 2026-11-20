import assert from 'node:assert/strict'
import test from 'node:test'
import { currentWireEffort, dispatchEffort, installWireRewrite } from '../lib/wire.js'

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function adapterThat(behaviour) {
  return {
    stream: behaviour,
  }
}

test('dispatchEffort passes ordinary levels through untouched', async () => {
  const seen = []
  const options = { reasoningEffort: 'low', model: 'deepseek-flash' }
  const adapter = adapterThat(function stream(received) {
    seen.push(received)
    return (async function* () { yield 1 })()
  })
  const chunks = await collect(dispatchEffort(adapter.stream, adapter, options))
  assert.deepEqual(chunks, [1])
  assert.equal(seen[0], options)
  assert.equal(currentWireEffort(), undefined)
})

test('dispatchEffort runs medium and xhigh inside the verbatim scope', async () => {
  for (const level of ['medium', 'xhigh']) {
    const seen = []
    const adapter = adapterThat(function stream(received) {
      seen.push(received)
      return (async function* () {
        yield currentWireEffort()
      })()
    })
    const chunks = await collect(dispatchEffort(adapter.stream, adapter, { reasoningEffort: level }))
    // The stock serializer only sees a legal placeholder ...
    assert.equal(seen[0].reasoningEffort, 'high')
    // ... while the request itself is scoped to the requested level.
    assert.deepEqual(chunks, [level])
    assert.equal(currentWireEffort(), undefined)
  }
})

test('dispatchEffort retries once with the documented alias when rejected', async () => {
  const attempts = []
  const warnings = []
  const adapter = adapterThat(function stream(received) {
    attempts.push(received.reasoningEffort)
    if (attempts.length === 1) {
      return (async function* () {
        const error = new Error('unsupported effort')
        error.failure = { code: 'INVALID_REQUEST', status: 400 }
        throw error
      })()
    }
    return (async function* () {
      yield currentWireEffort() ?? 'fallback'
    })()
  })
  const chunks = await collect(dispatchEffort(adapter.stream, adapter, { reasoningEffort: 'medium' }, (level, error) => {
    warnings.push([level, error.message])
  }))
  assert.deepEqual(attempts, ['high', 'high'])
  assert.deepEqual(chunks, ['fallback'])
  assert.deepEqual(warnings, [['medium', 'unsupported effort']])
})

test('dispatchEffort does not retry after a chunk, or on unrelated failures', async () => {
  const attempts = []
  const adapter = adapterThat(function stream(received) {
    attempts.push(received.reasoningEffort)
    return (async function* () {
      yield 'first'
      const error = new Error('mid-stream')
      error.failure = { status: 400 }
      throw error
    })()
  })
  await assert.rejects(collect(dispatchEffort(adapter.stream, adapter, { reasoningEffort: 'xhigh' })), /mid-stream/)
  assert.equal(attempts.length, 1)

  const network = adapterThat(function stream() {
    return (async function* () {
      const error = new Error('socket hang up')
      error.code = 'ECONNRESET'
      throw error
    })()
  })
  await assert.rejects(collect(dispatchEffort(network.stream, network, { reasoningEffort: 'medium' })), /socket hang up/)
})

test('installWireRewrite rewrites the outgoing messages body only', async () => {
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: init?.body })
    return new Response('{}', { status: 200 })
  }
  const uninstall = installWireRewrite()
  try {
    const adapter = adapterThat(function stream() {
      return (async function* () {
        const body = JSON.stringify({ model: 'deepseek-flash', thinking: { type: 'enabled' }, output_config: { effort: 'high' } })
        await globalThis.fetch('https://api.deepseek.com/anthropic/v1/messages', { method: 'POST', body })
        yield 'ok'
      })()
    })
    await collect(dispatchEffort(adapter.stream, adapter, { reasoningEffort: 'medium' }))
    assert.equal(JSON.parse(calls[0].body).output_config.effort, 'medium')

    // Outside the scope nothing is rewritten.
    await globalThis.fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ output_config: { effort: 'high' } }),
    })
    assert.equal(JSON.parse(calls[1].body).output_config.effort, 'high')

    // Other endpoints are never rewritten.
    const scopedAdapter = adapterThat(function stream() {
      return (async function* () {
        await globalThis.fetch('https://example.com/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ output_config: { effort: 'high' } }),
        })
        yield 'ok'
      })()
    })
    await collect(dispatchEffort(scopedAdapter.stream, scopedAdapter, { reasoningEffort: 'xhigh' }))
    assert.equal(JSON.parse(calls[2].body).output_config.effort, 'high')
  } finally {
    uninstall()
    globalThis.fetch = realFetch
  }
})
