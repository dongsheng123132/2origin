// 模型调用抽象。
//   provider=stub  零成本，用固定剧本驱动，只为验证 harness 逻辑是否跑得通
//   provider=anthropic  真实调用（需 ANTHROPIC_API_KEY）
//
// ⚠ stub 模式产出的一切数字都不是实验结果，run.mjs 会在报告里显著标注。

const estTokens = (s) => Math.ceil([...s].reduce((n, c) => n + (/[一-龥]/.test(c) ? 1 : 0.3), 0))

/** 剧本：让 harness 能同时验证「合规路径」与「违规被拦截路径」 */
const STUB_SCRIPTS = {
  clean: (chapter) => ({
    text: `（stub 第 ${chapter} 章正文）林峥在茶肆坐到掌灯。赵七终于把那枚黑钥匙推过桌面，只说了一句：拿去，别叫我知道你用在哪里。`,
    state_changes:
      chapter === 15 ? [{ object: 'obj:black-key', field: 'holder', from: 'char:zhao-qi', to: 'char:lin-zheng' }] : [],
    assertions: ['zhao-qi-alive', 'gate-not-opened', 'betrayal-undisclosed'],
  }),
  violating: (chapter) => ({
    text: `（stub 第 ${chapter} 章正文）赵七气绝在案前。林峥忽然想起白遥近来常往北庭大营去，心下一沉。`,
    state_changes: [
      { object: 'char:zhao-qi', field: 'alive', from: true, to: false },
      { object: 'char:lin-zheng', field: 'knows', op: 'append', to: 'k:bai-yao-betrayal' },
    ],
    assertions: [],
  }),
}

function stubModel(scenario = 'clean') {
  return {
    id: `stub:${scenario}`,
    stub: true,
    async complete({ prompt, chapter }) {
      // 无状态臂的「请汇报当前世界状态」探测轮：给一份典型的部分正确答案，
      // 只为让判分代码在 stub 下也能走到有对有错的分支，不代表任何真实表现。
      if (prompt.includes('当前世界状态')) {
        const canned = {
          state: {
            'obj:black-key': { holder: 'char:lin-zheng', used: false, intact: true },
            'char:zhao-qi': { alive: true },
            'char:bai-yao': { left_hand_injured: false, secret_betrayal: true },
            'char:lin-zheng': { knows: ['k:space-gate-exists', 'k:black-key-exists'] },
          },
        }
        const out = JSON.stringify(canned)
        return { raw: out, parsed: canned, usage: { inputTokens: estTokens(prompt), outputTokens: estTokens(out), ms: 0 } }
      }
      const script = (STUB_SCRIPTS[scenario] ?? STUB_SCRIPTS.clean)(chapter)
      const out = JSON.stringify(script)
      return {
        raw: out,
        parsed: script,
        usage: { inputTokens: estTokens(prompt), outputTokens: estTokens(out), ms: 0 },
      }
    },
  }
}

function anthropicModel(model = 'claude-sonnet-5') {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('缺少 ANTHROPIC_API_KEY——真实调用前请先设置，或用 --provider stub 跑通流程')
  return {
    id: model,
    stub: false,
    async complete({ prompt, maxTokens = 8000 }) {
      const t0 = Date.now()
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`)
      const data = await res.json()
      const raw = data.content.map((c) => c.text ?? '').join('')
      let parsed = null
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) try { parsed = JSON.parse(m[0]) } catch {}
      return {
        raw,
        parsed,
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          ms: Date.now() - t0,
        },
      }
    },
  }
}

/**
 * 本机 Hermes CLI（当前配置：deepseek-v4-flash / 自定义端点）。
 * 便宜、够用、无需另配 Key——批量生成语料的默认通道。
 * 代价：CLI 不回报 token 用量，只能按字符估算（usageEstimated 标记会一路带到报告里）。
 */
function hermesModel(model) {
  return {
    id: `hermes:${model ?? 'default(deepseek-v4-flash)'}`,
    stub: false,
    usageEstimated: true,
    async complete({ prompt, maxTokens: _mt, timeoutMs = 300_000 }) {
      if (prompt.length > 25_000) throw new Error(`prompt 过长（${prompt.length} 字符），超出 CLI 参数上限`)
      const { spawn } = await import('node:child_process')
      const args = ['-z', prompt, ...(model ? ['-m', model] : [])]
      const t0 = Date.now()
      const raw = await new Promise((resolve, reject) => {
        // 必须直接 spawn 可执行文件、不经 shell——走 shell 会把多行提示词拆坏
        const bin = process.env.HERMES_BIN ?? (process.platform === 'win32' ? 'hermes.exe' : 'hermes')
        const p = spawn(bin, args, { shell: false })
        let out = '', err = ''
        const timer = setTimeout(() => { p.kill(); reject(new Error(`hermes 超时（${timeoutMs}ms）`)) }, timeoutMs)
        p.stdout.on('data', (d) => (out += d))
        p.stderr.on('data', (d) => (err += d))
        p.on('error', (e) => { clearTimeout(timer); reject(e) })
        p.on('close', (code) => {
          clearTimeout(timer)
          code === 0 ? resolve(out) : reject(new Error(`hermes 退出码 ${code}: ${err.slice(0, 500)}`))
        })
      })
      let parsed = null
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) try { parsed = JSON.parse(m[0]) } catch {}
      return {
        raw,
        parsed,
        usage: { inputTokens: estTokens(prompt), outputTokens: estTokens(raw), ms: Date.now() - t0, estimated: true },
      }
    },
  }
}

export function createModel({ provider = 'stub', model, scenario } = {}) {
  if (provider === 'stub') return stubModel(scenario)
  if (provider === 'anthropic') return anthropicModel(model)
  if (provider === 'hermes') return hermesModel(model)
  throw new Error(`未知 provider: ${provider}（可选 stub / hermes / anthropic）`)
}
