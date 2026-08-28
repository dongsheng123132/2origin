// SSE transport regression: no network, no model account. Run in verify.
import assert from 'node:assert/strict'
import { ReadableStream } from 'node:stream/web'
import { completeViaHttp } from './model.mjs'

const enc = new TextEncoder()
const cfg = { baseUrl: 'https://unit.test/v1/', apiKey: 'unit-key', defaultModel: 'unit-model' }
const basic = [
  'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n',
  'data: {"choices":[{"delta":{"content":"{\\"中文\\":"},"finish_reason":null}]}\n',
  'data: {"choices":[{"delta":{"content":"true}"},"finish_reason":"stop"}]}\n',
  'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"completion_tokens_details":{"reasoning_tokens":2}}}\n',
  'data: [DONE]\n',
].join('')

function stream(parts, { neverClose = false, signal } = {}) {
  let i = 0
  return new ReadableStream({
    start(controller) { signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError'))) },
    pull(controller) {
      if (i < parts.length) {
        const part = parts[i++]
        return controller.enqueue(part instanceof Uint8Array ? part : enc.encode(part))
      }
      if (!neverClose) controller.close()
    },
  })
}

async function withFetch(fake, fn) {
  const real = globalThis.fetch
  globalThis.fetch = fake
  try { return await fn() } finally { globalThis.fetch = real }
}

async function run(parts, { status = 200, neverClose = false, timeoutMs = 100 } = {}) {
  let request
  const result = await withFetch(async (_url, init) => {
    request = init
    return new Response(stream(parts, { neverClose, signal: init.signal }), { status })
  }, () => completeViaHttp(cfg, null, '测试提示词', 123, timeoutMs))
  return { result, request }
}

// Every byte boundary exercises TextDecoder streaming plus the line buffer.
for (let size = 1; size <= 13; size++) {
  const parts = Array.from({ length: Math.ceil(enc.encode(basic).length / size) }, (_, i) => enc.encode(basic).slice(i * size, (i + 1) * size))
  const { result, request } = await run(parts)
  assert.equal(result.raw, '{"中文":true}', `chunk=${size}`)
  assert.deepEqual(result.parsed, { 中文: true }, `chunk=${size}`)
  assert.equal(result.finishReason, 'stop')
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4, reasoningTokens: 2, estimated: false, ms: result.usage.ms })
  const body = JSON.parse(request.body)
  assert.equal(body.stream, true)
  assert.deepEqual(body.stream_options, { include_usage: true })
}

// An OpenAI-compatible gateway may close after its final frame without [DONE] or trailing LF.
const eof = 'data: {"choices":[{"delta":{"content":"{\\"ok\\":1}"},"finish_reason":"stop"}]}'
assert.deepEqual((await run([eof])).result.parsed, { ok: 1 })

await assert.rejects(() => run(['data: {"error":{"message":"quota"}}\n']), /hermes SSE 错误: quota/)
await assert.rejects(() => run(['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n']), /流不完整/)
await assert.rejects(() => run([], { neverClose: true, timeoutMs: 10 }), /AbortError/)
await assert.rejects(() => run(['unused'], { status: 500 }), /hermes 端点 500/)

console.log('model SSE selftest: 20/20')
