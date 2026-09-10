/*
 * 源自 adapters/law/dialect.mjs 的 FACTORS 与 adjust 纯函数，语义一致：
 * ratio 为带符号比例，负数为从宽、正数为从严；范围端点均可取。
 * 浏览器不能直接 import Node ESM，故只内联可移植的判定部分。
 */
const FACTORS = {
  自首: { min: -0.40, max: 0, requiresLaw: 'law:刑法/67', rule: '自首可以减少基准刑的40%以下' },
  坦白: { min: -0.20, max: 0, requiresLaw: 'law:刑法/67', rule: '坦白可以减少基准刑的20%以下' },
  当庭自愿认罪: { min: -0.10, max: 0, requiresLaw: null, rule: '当庭自愿认罪可以减少基准刑的10%以下' },
  认罪认罚: { min: -0.30, max: 0, requiresLaw: 'law:刑事诉讼法/15', rule: '认罪认罚可以减少基准刑的30%以下' },
  一般立功: { min: -0.20, max: 0, requiresLaw: 'law:刑法/68', rule: '一般立功可以减少基准刑的20%以下' },
  重大立功: { min: -0.50, max: -0.20, requiresLaw: 'law:刑法/68', rule: '重大立功可以减少基准刑的20%-50%' },
  未遂: { min: -0.50, max: 0, requiresLaw: 'law:刑法/23', rule: '未遂可以比照既遂犯减少基准刑的50%以下' },
  从犯: { min: -0.50, max: -0.20, requiresLaw: 'law:刑法/27', rule: '从犯应当减少基准刑的20%-50%' },
  退赃退赔: { min: -0.30, max: 0, requiresLaw: null, rule: '退赃、退赔可以减少基准刑的30%以下' },
  赔偿谅解: { min: -0.40, max: 0, requiresLaw: null, rule: '赔偿并取得谅解可以减少基准刑的40%以下' },
  刑事和解: { min: -0.50, max: 0, requiresLaw: null, rule: '达成刑事和解协议可以减少基准刑的50%以下' },
  累犯: { min: 0.10, max: 0.40, requiresLaw: 'law:刑法/65', rule: '累犯应当增加基准刑的10%-40%' },
  前科: { min: 0, max: 0.10, requiresLaw: null, rule: '有前科可以增加基准刑的10%以下' },
  '未成年14-16': { min: -0.60, max: -0.30, requiresLaw: 'law:刑法/17', rule: '已满14不满16周岁应当减少基准刑的30%-60%' },
  '未成年16-18': { min: -0.50, max: -0.10, requiresLaw: 'law:刑法/17', rule: '已满16不满18周岁应当减少基准刑的10%-50%' },
};

const SAMPLES = {
  lawful: {
    text: '（2026）沪0101刑初001号：被告人周某到案后如实供述主要事实，并在侦查机关尚未掌握前主动投案。量刑评议以基准刑十个月为基础，对自首减少35%，拟宣告有期徒刑七个月。裁判依据引用《中华人民共和国刑法》第六十七条。',
    person: '周某', baseMonths: 10, declaredMonths: 7, factors: [{ name: '自首', ratio: -0.35, basis: '证据:E-01 主动投案记录' }], laws: ['law:刑法/67'], decision: '有期徒刑七个月',
  },
  illegal: {
    text: '（2026）沪0101刑初002号：被告人林某自动投案并如实供述。量刑评议以基准刑十个月为基础，对自首减少55%，拟宣告有期徒刑五个月。裁判依据引用《中华人民共和国刑法》第六十七条。',
    person: '林某', baseMonths: 10, declaredMonths: 5, factors: [{ name: '自首', ratio: -0.55, basis: '证据:E-02 投案笔录' }], laws: ['law:刑法/67'], decision: '有期徒刑五个月',
  },
  accomplice: {
    text: '（2026）沪0101刑初003号：被告人陈某在共同犯罪中起次要、辅助作用。量刑评议以基准刑十个月为基础，对从犯减少50%，拟宣告有期徒刑五个月。裁判依据引用《中华人民共和国刑法》第二十七条。',
    person: '陈某', baseMonths: 10, declaredMonths: 5, factors: [{ name: '从犯', ratio: -0.50, basis: '证据:E-03 分工及供述' }], laws: ['law:刑法/27'], decision: '有期徒刑五个月',
  },
};

function committedStateFor(key) {
  const state = structuredClone(SAMPLES[key]);
  if (key === 'illegal') {
    state.factors[0].ratio = -0.35;
    state.declaredMonths = 7;
    state.decision = '有期徒刑七个月';
  }
  return state;
}

let selectedKey = 'lawful';
let committed = committedStateFor(selectedKey);
let candidate = structuredClone(SAMPLES[selectedKey]);
const percentNumber = (n) => Math.round(n * 1000) / 10;
const percent = (n) => `${percentNumber(Math.abs(n)).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
const signedPercent = (n) => `${n < 0 ? '减少' : '增加'} ${percent(n)}`;
const rangeText = (factor) => `${percentNumber(factor.min).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}% ～ ${percentNumber(factor.max).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function checkFactor(item) {
  const rule = FACTORS[item.name];
  if (!rule) return { pass: false, reason: `未知量刑情节：${item.name}` };
  if (item.ratio < rule.min || item.ratio > rule.max) {
    return { pass: false, rule, reason: `“${item.name}${item.ratio < 0 ? '减少' : '增加'}${percent(item.ratio)}”超出法定范围 ${rangeText(rule)}` };
  }
  if (rule.requiresLaw && !candidate.laws.includes(rule.requiresLaw)) {
    return { pass: false, rule, reason: `认定“${item.name}”须引用 ${rule.requiresLaw}，当前裁判依据缺失` };
  }
  return { pass: true, rule, reason: '在法定范围内，且所需条文已在裁判依据中出现' };
}

function adjustedMonths() {
  const total = candidate.factors.reduce((sum, item) => sum + item.ratio, 0);
  return { total, adjusted: candidate.baseMonths * (1 + total) };
}

function renderTree() {
  const factors = committed.factors.map((f) => `<li><code>factor:${escapeHtml(f.name)}</code> · ${signedPercent(f.ratio)}</li>`).join('');
  document.querySelector('#object-tree').innerHTML = `<ul><li><code>case:${escapeHtml(committed.person)}</code><ul><li><code>person:${escapeHtml(committed.person)}</code></li><li>裁判依据<ul>${committed.laws.map((law) => `<li><code>${escapeHtml(law)}</code></li>`).join('')}</ul></li><li>量刑情节<ul>${factors}</ul></li><li><code>sentence:declared</code> · ${escapeHtml(committed.decision)}</li></ul></li></ul>`;
}

function renderWhy() {
  const checks = candidate.factors.map((item) => {
    const checked = checkFactor(item);
    const rule = checked.rule ?? FACTORS[item.name];
    const status = checked.pass ? '通过' : '拒绝';
    const cls = checked.pass ? 'hl' : 'dim';
    return `<tr><td>${escapeHtml(item.name)}</td><td>${item.ratio < 0 ? '减少' : '增加'} ${percent(item.ratio)}</td><td>${escapeHtml(rule?.rule ?? '无对应规则')}<br><code>${escapeHtml(rule?.requiresLaw ?? '无独立条文')}</code></td><td class="${cls}"><strong>${status}</strong><br>${escapeHtml(checked.reason)}</td></tr>`;
  }).join('');
  const committedFactors = committed.factors.map((item) => `${escapeHtml(item.name)} ${signedPercent(item.ratio)}`).join('；');
  const candidateFactors = candidate.factors.map((item) => `${escapeHtml(item.name)} ${signedPercent(item.ratio)}`).join('；');
  document.querySelector('#why-chain').innerHTML = `<div class="state-compare"><span class="state-pill">已提交：${committedFactors}</span><span class="state-pill candidate">候选：${candidateFactors}</span></div><table class="data-table"><thead><tr><th>量刑情节</th><th>候选调节</th><th>法定区间 / 条文</th><th>结论</th></tr></thead><tbody>${checks}</tbody></table>`;
}

function renderResult() {
  const results = candidate.factors.map(checkFactor);
  const failure = results.find((r) => !r.pass);
  const calculation = adjustedMonths();
  const withinDeclared = Math.abs(candidate.declaredMonths - calculation.adjusted) / calculation.adjusted <= 0.20;
  const result = document.querySelector('#result');
  if (failure || !withinDeclared) {
    const reason = failure?.reason ?? `拟宣告刑 ${candidate.declaredMonths} 个月偏离调节结果 ${calculation.adjusted.toFixed(1)} 个月超过 20%`;
    const committedFactors = committed.factors.map((item) => `${item.name}${signedPercent(item.ratio)}`).join('；');
    result.dataset.status = 'rejected';
    result.innerHTML = `<div class="honesty"><h3>✕ 候选事务已退回：违规零写入</h3><p><strong>拒绝理由：</strong>${escapeHtml(reason)}。</p><p><strong>已提交状态：</strong>${escapeHtml(committedFactors)}，对象树保持不变。只有修正后的新候选事务通过门禁，才可能写入。</p></div>`;
  } else {
    result.dataset.status = 'passed';
    result.innerHTML = `<div class="honesty"><h3>✓ 预检通过：候选事务尚未提交</h3><p>调节合计 ${signedPercent(calculation.total)}，基准刑 ${candidate.baseMonths} 个月，调节后 ${calculation.adjusted.toFixed(1)} 个月；拟宣告 ${candidate.declaredMonths} 个月在 20% 容许偏离内。</p><p>本地演示只做预检，不会自动改写左侧已提交对象树。</p></div>`;
  }
}

function render() {
  document.querySelector('#judgment-text').textContent = candidate.text;
  renderTree();
  renderWhy();
  renderResult();
}

document.querySelector('#sample-select').addEventListener('change', (event) => {
  selectedKey = event.target.value;
  committed = committedStateFor(selectedKey);
  candidate = structuredClone(SAMPLES[selectedKey]);
  render();
});
document.querySelector('#restore-sample').addEventListener('click', () => {
  candidate = structuredClone(SAMPLES[selectedKey]);
  render();
});
document.querySelector('#force-violation').addEventListener('click', () => {
  candidate = structuredClone(committed);
  const item = candidate.factors[0];
  const rule = FACTORS[item.name];
  item.ratio = rule.min < 0 ? rule.min - 0.15 : rule.max + 0.15;
  candidate.text += `\n【候选改写】将“${item.name}”调节改为 ${signedPercent(item.ratio)}，故意越界。`;
  render();
});

render();
