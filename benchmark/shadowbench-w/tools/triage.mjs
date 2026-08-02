#!/usr/bin/env node
// 分歧项初筛：把语义判官的分歧指控派给本机模型做二次判断。
//
// 分批派发（每批默认 4 条）——推理型模型会把输出预算大量花在思考上，
// 一次派 16 条会导致正文被 max_tokens 截断、返回空字符串。小批量是必需的，不是优化。
//
//   node tools/triage.mjs results/a3-bailian-clean.judged.json
//   node tools/triage.mjs <judged.json> --batch 4 --provider hermes

import { readFileSync, writeFileSync } from 'node:fs'
import { createModel } from '../arms/lib/model.mjs'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
if (!file) { console.log('用法: node tools/triage.mjs <judged.json> [--batch 4] [--provider hermes]'); process.exit(1) }

const data = JSON.parse(readFileSync(file, 'utf8'))
const items = data.disputed ?? []
const batchSize = Number(arg('batch', 4))
const model = createModel({ provider: arg('provider', 'hermes') })

const RUBRIC = `判断标准（严格执行）：
- 只有当文字明确表明人物知道了某项他不该知道的具体秘密，才算知识越界；「感到不安」「觉得对方有心事」这类模糊情绪不算
- 推测性物理推理（如「伸手够刀鞘必然要用另一只手扶」）不算矛盾
- 文学性的含蓄、留白、象征、悬念不算错误
- 作者新引入的设定元素，只要不与既有设定冲突，不算错误

既有设定：白遥与北庭有秘密约定，除裴照外无人知晓，林峥完全不知情；阿枝曾目睹白遥与北庭军官会面但从未告诉任何人；黑钥匙第 2 章起在赵七处；白遥第 9 章起左手有伤。`

const verdicts = []
for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize)
  const prompt = `判断下列「设定矛盾」指控是否站得住。

${RUBRIC}

${batch.map((f, k) => `### ${i + k + 1}. [ch${f.chapter} / ${f.type}]\n引用：「${(f.quote ?? '').slice(0, 110)}」\n理由：${(f.why ?? '').slice(0, 220)}`).join('\n\n')}

只输出 JSON：{"verdicts":[{"n":${i + 1},"stands":true,"reason":"一句话"}]}
必须给全这 ${batch.length} 条，reason 控制在 25 字内。`

  process.stdout.write(`  第 ${i / batchSize + 1} 批（${batch.length} 条）… `)
  const res = await model.complete({ prompt, maxTokens: 4096 })
  const got = res.parsed?.verdicts ?? []
  verdicts.push(...got)
  console.log(`${got.length} 条${got.length !== batch.length ? ' ⚠ 数量不符' : ''}`)
}

const stands = verdicts.filter((v) => v.stands)
console.log(`\n初筛结果：${verdicts.length} 条中 ${stands.length} 条站得住，${verdicts.length - stands.length} 条判为过度解读\n`)
for (const v of stands) {
  const src = items[v.n - 1]
  console.log(`  ✓ 第${v.n}条 [ch${src?.chapter} ${src?.type}] ${v.reason}`)
  console.log(`      「${(src?.quote ?? '').slice(0, 50)}」`)
}

const out = file.replace(/\.judged\.json$/, '.triaged.json')
writeFileSync(out, JSON.stringify({ total: verdicts.length, stands: stands.length, verdicts, items }, null, 2))
console.log(`\n已写入 ${out}`)
