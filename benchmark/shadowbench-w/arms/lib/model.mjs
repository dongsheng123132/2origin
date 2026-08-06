// 模型调用抽象。
//   provider=stub  零成本，用固定剧本驱动，只为验证 harness 逻辑是否跑得通
//   provider=anthropic  真实调用（需 ANTHROPIC_API_KEY）
//   provider=hermes  真实调用（复用本机 hermes 配置的模型端点，HTTP 直连，无提示词长度上限）
//   provider=bailian  真实调用（百炼 CLI，提示词走文件）
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
          // 探询现在也问伏笔（第八起：旧模板从不问它，却把它计入分母）。
          // 这里故意给一个错值，好让 stub 下的判分同时走到「答了但答错」的分支。
          hooks: { 'hook:shen-yan-suspicion': { status: 'resolved' } },
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
 * 本机 Hermes 配置的模型通道（当前：deepseek-v4-flash / 自定义 OpenAI 兼容端点）。
 * 便宜、够用、无需另配 Key——批量生成语料的默认通道。
 *
 * v2 修复（2026-08-02）：原先用 `hermes -z <提示词>` 把整段提示词塞进命令行参数，
 * 撞上 Windows argv 上限（CreateProcess 32767 字符），>25k 字符的提示词直接报
 * 「超出 CLI 参数上限」——那不是模型上下文不够，是传输通道太窄。
 * 现改为直接 HTTP 调用 hermes 配置里的同一个 OpenAI 兼容端点：
 *   - 无提示词长度上限（带前文章节/世界状态的长提示词不再炸）
 *   - 回报真实 token 用量（usage 不再标 estimated）
 * 配置来源与 hermes CLI 同源（$HERMES_HOME/config.yaml 的 model: 段）。
 * 兜底：读不到配置时退回 CLI 通道（-z，仍受 argv 上限约束，仅适合短提示词）。
 */
function hermesModel(model) {
  return {
    // 默认配额按**带思维链的模型**设定：reasoning 与正文共享 max_tokens，8192 在长基线上
    // 会被推演吃光（实测单次可烧掉 22162 个 reasoning token），正文一个字没写就 finish=length；
    // 300s 同样不够——M 级提示词大，一次生成实测 241s 起步，跨模型验证首跑即因此 AbortError。
    // 这是基础设施参数，不是实验变量：三臂共用同一组，跨模型比较的是「方法是否成立」。
    id: `hermes:${model ?? 'default(deepseek-v4-flash)'}`,
    stub: false,
    usageEstimated: false,
    async complete({ prompt, maxTokens = 32768, timeoutMs = 900_000 }) {
      const cfg = await readHermesModelConfig()
      if (cfg) return completeViaHttp(cfg, model, prompt, maxTokens, timeoutMs)
      return completeViaCli(model, prompt, timeoutMs)
    },
  }
}

/** 读取 hermes 配置里的模型段（与 hermes CLI 同源，尊重 HERMES_HOME 覆盖） */
async function readHermesModelConfig() {
  try {
    const { readFileSync, existsSync } = await import('node:fs')
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const cfgPath = join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'config.yaml')
    if (!existsSync(cfgPath)) return null
    const yaml = readFileSync(cfgPath, 'utf8')
    // 注意：JS 正则没有 \Z（Python 有），`(?=^\S|\Z)` 里 \Z 会被当作字面 Z 导致整个匹配
    // 永远失败——2026-08-06 在 GitHub Actions 上实测暴露（本机一直走 CLI 兜底所以没发现）。
    // 无 /m 模式下 ^ 只匹配字符串开头、$ 只匹配字符串末尾，正好表达「取 model: 段到文件尾」。
    const sec = yaml.match(/^model:\s*\n([\s\S]*?)(?=^\S|$)/)?.[1]
    if (!sec) return null
    const get = (k) => {
      // 模板字面量里 \\s 才是「一个反斜杠+s」→ 正则空白符。
      // 写成 \s（单反斜杠）会被 JS 当作非法转义、退化成字面 s——正则变成 /^s*k:/，
      // 永远匹配不到任何键，config 读不出来，整个通道退化成 CLI 兜底。
      // （2026-08-06 事故记录说已修成 \\s，但字节核对发现 077692d 里仍是单反斜杠——
      //   修复从未真正提交。此次核对后已改为 \\s，并加了单臂回归验证。）
      const m = sec.match(new RegExp(`^\\s*${k}:\\s*(?:['\"]([^'\"]+)['\"]|(\\S+))`, 'm'))
      return m ? (m[1] ?? m[2]).trim() : null
    }
    const cfg = { baseUrl: get('base_url'), apiKey: get('api_key'), defaultModel: get('default') }
    return cfg.baseUrl && cfg.apiKey ? cfg : null
  } catch {
    return null
  }
}

/** 主通道：OpenAI 兼容 HTTP（无 argv 上限，真实 token 用量） */
async function completeViaHttp(cfg, modelOverride, prompt, maxTokens, timeoutMs) {
  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: modelOverride ?? cfg.defaultModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`hermes 端点 ${res.status}: ${(await res.text()).slice(0, 400)}`)
    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content ?? ''
    let parsed = null
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) try { parsed = JSON.parse(m[0]) } catch {}
    return {
      raw,
      parsed,
      // 空 raw 时唯一能区分「被截断」与「模型真没说话」的线索：length 表示配额耗尽，
      // 对带思维链的模型意味着 reasoning 吃光了 max_tokens，正文根本没开始写
      finishReason: data.choices?.[0]?.finish_reason ?? null,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? estTokens(prompt),
        outputTokens: data.usage?.completion_tokens ?? estTokens(raw),
        reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        ms: Date.now() - t0,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 兜底通道：hermes CLI 单发（仅适合短提示词；长提示词请走 HTTP 主通道） */
async function completeViaCli(model, prompt, timeoutMs) {
  if (prompt.length > 24_000)
    throw new Error(
      `prompt 过长（${prompt.length} 字符）且读不到 hermes 配置（无法走 HTTP 通道）。` +
        `请检查 $HERMES_HOME/config.yaml 的 model: 段，或把提示词拆短。`
    )
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
}

/**
 * 本机百炼 CLI（`bl`）。相比 hermes 的三个优势：
 *   ① 回报真实 token 用量（成本不必估算）② 长提示词稳定 ③ 快
 * 默认 qwen-plus——非推理模型。实测 qwen3.6-plus 会把 8472 个输出 token 里的 7354 个
 * 花在思考上，对「按设定写正文」这类任务纯属浪费。
 */
function bailianModel(model = 'qwen-plus') {
  return {
    id: `bailian:${model}`,
    stub: false,
    usageEstimated: false,
    async complete({ prompt, maxTokens = 4096, timeoutMs = 300_000 }) {
      const { spawn } = await import('node:child_process')
      const { writeFileSync, mkdtempSync } = await import('node:fs')
      const { join } = await import('node:path')
      const { tmpdir } = await import('node:os')
      // 提示词走文件，命令行只传短路径：既绕开 npm .cmd 包装必须用 shell 的限制，
      // 又避免长提示词被 shell 的引号/换行处理弄坏
      const msgFile = join(mkdtempSync(join(tmpdir(), 'bl-')), 'messages.json')
      writeFileSync(msgFile, JSON.stringify([{ role: 'user', content: prompt }]), 'utf8')
      const args = ['text', 'chat', '--model', model, '--max-tokens', String(maxTokens), '--messages-file', msgFile]
      const t0 = Date.now()
      const raw = await new Promise((resolve, reject) => {
        const p = spawn('bl', args, { shell: process.platform === 'win32' })
        let out = '', err = ''
        const timer = setTimeout(() => { p.kill(); reject(new Error(`bl 超时（${timeoutMs}ms）`)) }, timeoutMs)
        p.stdout.on('data', (d) => (out += d))
        p.stderr.on('data', (d) => (err += d))
        p.on('error', (e) => { clearTimeout(timer); reject(e) })
        p.on('close', (c) => { clearTimeout(timer); c === 0 ? resolve(out) : reject(new Error(`bl 退出码 ${c}: ${err.slice(0, 400)}`)) })
      })
      const envelope = JSON.parse(raw)
      const content = envelope.choices?.[0]?.message?.content ?? ''
      let parsed = null
      const m = content.match(/\{[\s\S]*\}/)
      if (m) try { parsed = JSON.parse(m[0]) } catch {}
      return {
        raw: content,
        parsed,
        usage: {
          inputTokens: envelope.usage?.prompt_tokens ?? 0,
          outputTokens: envelope.usage?.completion_tokens ?? 0,
          reasoningTokens: envelope.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
          ms: Date.now() - t0,
        },
      }
    },
  }
}

/**
 * 瞬时故障重试包装。
 * 实测：一次 "Network request failed" 就把跑了 40 分钟的 10 轮批量实验整个打死。
 * 长时间批量作业必须容忍瞬时网络抖动——重跑一次远比重跑一整批便宜。
 * 只重试网络/限流/超时类错误；参数错误、鉴权失败等确定性错误立即抛出，重试没有意义。
 */
const TRANSIENT = /network|timeout|超时|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|429|502|503|504|rate.?limit|Throttling/i

function withRetry(m, { tries = 3, baseDelayMs = 5000 } = {}) {
  const inner = m.complete.bind(m)
  return {
    ...m,
    async complete(opts) {
      let last
      for (let i = 1; i <= tries; i++) {
        try {
          return await inner(opts)
        } catch (e) {
          last = e
          if (!TRANSIENT.test(String(e.message)) || i === tries) throw e
          const wait = baseDelayMs * i
          console.error(`  ⚠ 第 ${i} 次调用失败（${String(e.message).slice(0, 60)}…），${wait / 1000}s 后重试`)
          await new Promise((r) => setTimeout(r, wait))
        }
      }
      throw last
    },
  }
}

export function createModel({ provider = 'stub', model, scenario, retry = true } = {}) {
  const wrap = (m) => (retry && !m.stub ? withRetry(m) : m)
  if (provider === 'stub') return stubModel(scenario)
  if (provider === 'anthropic') return wrap(anthropicModel(model))
  if (provider === 'hermes') return wrap(hermesModel(model))
  if (provider === 'bailian') return wrap(bailianModel(model))
  throw new Error(`未知 provider: ${provider}（可选 stub / bailian / hermes / anthropic）`)
}
