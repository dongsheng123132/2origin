// schema-check.mjs — 让 schemas/task.origin.json 变成承重件（benjing/0.2）
//
// 事故背景：demo/task5 被一个缺 kind/id/goal/current_state 的对象覆盖，
// 整份从本境消失，而 verify-state 照样给绿灯 —— 因为**从来没有任何代码加载过那份 schema**。
// `grep -rn "schemas/task.origin.json" --include=*.mjs` 只命中一条注释。
//
// 一份没人校验的 schema 是装饰品，不是契约。它给人「格式被约束着」的错觉，
// 这本身就是「声明冒充事实」——文档声明了约束，现实里没有任何东西执行它。
//
// 这里不引外部依赖（ajv 之类），只实现本仓库 schema 真正用到的那几个关键字。
// 用不到的关键字**直接报错**，而不是静默忽略：静默忽略会让「schema 写了但没生效」
// 重新变成可能，那就绕回原点了。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(here, '..', 'schemas', 'task.origin.json');

const SUPPORTED = new Set([
  '$schema', '$id', 'title', 'description', 'type', 'required', 'properties',
  'items', 'const', 'enum', 'minimum', 'maximum', 'if', 'then'
]);

let cached = null;
export function loadSchema(p = SCHEMA_PATH) {
  if (cached && cached.p === p) return cached.s;
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  cached = { p, s };
  return s;
}

function typeOk(v, t) {
  switch (t) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number';
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    default: return true;
  }
}

function matchesIf(v, cond) {
  // 本仓库只用到 { properties: { x: { const: y } } } 这一种形态
  for (const [k, sub] of Object.entries(cond.properties || {})) {
    if (sub.const !== undefined && v?.[k] !== sub.const) return false;
    if (sub.enum && !sub.enum.includes(v?.[k])) return false;
  }
  return true;
}

function walk(value, schema, at, out) {
  for (const k of Object.keys(schema)) {
    if (!SUPPORTED.has(k)) {
      out.push({ at, msg: `schema 用了未实现的关键字 "${k}" —— 校验器必须跟上 schema，不许静默忽略` });
    }
  }
  if (schema.type && !typeOk(value, schema.type)) {
    out.push({ at, msg: `类型应为 ${schema.type}，实为 ${Array.isArray(value) ? 'array' : typeof value}` });
    return out;
  }
  if (schema.const !== undefined && value !== schema.const) {
    out.push({ at, msg: `应恒为 ${JSON.stringify(schema.const)}，实为 ${JSON.stringify(value)}` });
  }
  if (schema.enum && !schema.enum.includes(value)) {
    out.push({ at, msg: `应属于 ${JSON.stringify(schema.enum)}，实为 ${JSON.stringify(value)}` });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push({ at, msg: `应 ≥ ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) out.push({ at, msg: `应 ≤ ${schema.maximum}` });
  }

  // 条件必填：facts 里 verified:true 时 source 必填
  let required = schema.required || [];
  if (schema.if && schema.then && matchesIf(value, schema.if)) {
    required = [...new Set([...required, ...(schema.then.required || [])])];
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of required) {
      if (value[r] === undefined || value[r] === null || value[r] === '') {
        out.push({ at: at ? `${at}.${r}` : r, msg: '必填字段缺失或为空' });
      }
    }
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (value[k] !== undefined) walk(value[k], sub, at ? `${at}.${k}` : k, out);
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => walk(item, schema.items, `${at}[${i}]`, out));
  }
  return out;
}

/** 返回问题列表；空数组 = 合规。**不返回 boolean**——「合不合规」和「哪里不合规」是两件事。 */
export function checkState(state, schemaPath = SCHEMA_PATH) {
  return walk(state, loadSchema(schemaPath), '', []);
}

// CLI: node southbridge/schema-check.mjs <state.json> [...]
const invokedDirectly = (() => {
  const a1 = process.argv[1];
  if (!a1) return false;
  try { return import.meta.url === new URL(`file://${path.resolve(a1).replace(/\\/g, '/')}`).href; }
  catch { return false; }
})();
if (invokedDirectly) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('用法: node southbridge/schema-check.mjs <task.origin.json> [...]'); process.exit(1); }
  let bad = 0;
  for (const f of files) {
    let problems;
    try { problems = checkState(JSON.parse(fs.readFileSync(f, 'utf8'))); }
    catch (e) { console.log(`❌ ${f} 读取/解析失败: ${e.message}`); bad++; continue; }
    if (!problems.length) console.log(`✅ ${f}`);
    else { bad++; console.log(`❌ ${f}  ${problems.length} 处不合规`); problems.slice(0, 8).forEach(p => console.log(`     • ${p.at || '(顶层)'}: ${p.msg}`)); }
  }
  process.exit(bad ? 1 : 0);
}
