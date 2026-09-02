#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 website/ 下中英文页面合并成单页双语言 tab 版：all-in-one.html

用法：  python3 build-allinone.py
原则：  只做机械改写（id 前缀 / 链接与 fetch 路径重写），不改任何正文；
        每个标签内嵌中英两个语言变体，由前端 JS 切换显示（见 applyLang）；
        原页面更新后重跑本脚本即可再生成。
"""
import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent

# (key, 中文标签, 英文标签, 中文源(rel, base), 英文源(rel, base) 或 None)
# base = 该页相对 website/ 的目录前缀，用于补全链接；单语言页英文源填 None
PAGES = [
    ("home",      "首页",     "Home",
     ("zh/index.html", "zh/"), ("index.html", "")),
    ("manifesto", "宣言",     "Manifesto",
     ("zh/manifesto.html", "zh/"), ("manifesto.html", "")),
    ("solutions", "解决方案", "Solutions",
     ("zh/solutions.html", "zh/"), ("solutions.html", "")),
    ("cases",     "案例",     "Cases",
     ("zh/cases.html", "zh/"), ("cases.html", "")),
    ("challenge", "白鼓挑战", "Challenge",
     ("zh/challenge.html", "zh/"), ("challenge.html", "")),
    ("demo",      "法律Demo", "Law Demo",
     ("demo/index.html", "demo/"), None),
    ("longrun",   "长期任务", "Long-Run",
     ("longrun/index.html", "longrun/"), None),
]

TAB_KEYS = [p[0] for p in PAGES]

# 这些页的 id 与其他页无冲突、且被外部 JS 用原始 id 引用，跳过前缀改写
SKIP_ID_PREFIX = {"demo"}

# 页内互跳链接 → tab hash
TAB_LINKS = {
    "index.html": "home", "manifesto.html": "manifesto", "cases.html": "cases",
    "challenge.html": "challenge", "solutions.html": "solutions",
    "demo/index.html": "demo", "demo/": "demo",
}


def extract_body(html: str) -> str:
    m = re.search(r"<body[^>]*>(.*)</body>", html, re.S)
    return m.group(1) if m else html


def strip_nav_footer(s: str) -> str:
    s = re.sub(r'<nav class="nav">.*?</nav>\s*', "", s, flags=re.S)
    s = re.sub(r'<footer class="footer">.*?</footer>\s*', "", s, flags=re.S)
    s = re.sub(r'<a class="lang-switch"[^>]*>.*?</a>\s*', "", s, flags=re.S)  # 语言切换由顶栏接管
    return s.strip()


def extract_styles(html: str) -> list[str]:
    """提取页面级 <style> 块（如 longrun 的 .console/.agent-card 等）"""
    return re.findall(r"<style[^>]*>(.*?)</style>", html, re.S)


def scope_css(css: str, scope: str) -> str:
    """给每条规则的选择器加作用域前缀；@media 内层递归，@keyframes 等原样保留"""
    res, i, n = [], 0, len(css)
    while i < n:
        j = css.find("{", i)
        if j == -1:
            res.append(css[i:])
            break
        sel = css[i:j]
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == "{":
                depth += 1
            elif css[k] == "}":
                depth -= 1
            k += 1
        block = css[j + 1 : k - 1]
        head = sel.strip()
        if head.startswith(("@keyframes", "@font-face", "@charset")):
            res.append(css[i:k])
        elif head.startswith(("@media", "@supports")):
            res.append(sel + "{" + scope_css(block, scope) + "}")
        elif head.startswith("@"):
            res.append(css[i:k])
        else:
            sels = ",".join(
                (scope + " " + s.strip()) if s.strip() else s for s in sel.split(",")
            )
            res.append(sels + "{" + block + "}")
        i = k
    return "".join(res)


def prefix_ids(s: str, pfx: str) -> str:
    """id 属性与 getElementById 调用同步加前缀，避免跨页冲突"""
    for i in sorted(set(re.findall(r'id="([^"]+)"', s))):
        s = re.sub(r'id="%s"' % re.escape(i), 'id="%s-%s"' % (pfx, i), s)
        s = s.replace("getElementById('%s')" % i, "getElementById('%s-%s')" % (pfx, i))
        s = s.replace('getElementById("%s")' % i, 'getElementById("%s-%s")' % (pfx, i))
    return s


def rewrite_links(s: str, base: str) -> str:
    """把各页相对链接改写为 tab 切换或合并后的正确路径（href 与 src 都处理）"""
    def sub(m):
        attr, href = m.group(1), m.group(2)
        if href.startswith(("#", "http", "mailto:", "data:")):
            return m.group(0)
        h = href
        while h.startswith("../"):        # 子页里的 ../ 统一归到 website 根相对
            h = h[3:]
        key = h[3:] if h.startswith("zh/") else h   # 兼容 zh/ 前缀差异
        target = TAB_LINKS.get(key)
        if target:
            return '%s="#%s"' % (attr, target)
        if base and not h.startswith(("assets/", "zh/")):
            return '%s="%s%s"' % (attr, base, h)    # 同目录文件补 base
        return '%s="%s"' % (attr, h)
    return re.sub(r'(href|src)="([^"]+)"', sub, s)


def fix_fetch(s: str, base: str) -> str:
    s = s.replace("fetch('./stats.json')", "fetch('%sstats.json')" % base)
    s = s.replace("fetch('stats.json')",   "fetch('%sstats.json')" % base)
    s = s.replace("fetch('agents.json')",  "fetch('%sagents.json')" % base)
    # 带第二个参数的形态：fetch('agents.json', { cache: 'no-store' })
    s = re.sub(r"fetch\('(agents\.json)',", "fetch('%s\\1'," % base, s)
    s = re.sub(r"fetch\('(stats\.json)',",  "fetch('%s\\1'," % base, s)
    return s


def build_panel(key: str, lang: str, rel: str, base: str) -> str:
    """lang 为 zh/en；单语言页 lang 传空串（前端不做语言过滤，恒显示）"""
    html = (ROOT / rel).read_text(encoding="utf-8")
    body = strip_nav_footer(extract_body(html))
    if key not in SKIP_ID_PREFIX:
        body = prefix_ids(body, "%s-%s" % (key, lang) if lang else key)
    body = rewrite_links(body, base)
    body = fix_fetch(body, base)
    styles = "\n".join(
        "<style>\n%s\n</style>" % scope_css(css, '.tabx-panel[data-panel="%s"]' % key)
        for css in extract_styles(html)
    )
    return ('<section class="tabx-panel" data-panel="%s" data-lang="%s">\n%s\n%s\n</section>'
            % (key, lang, styles, body))


CSS = """
/* ---------- all-in-one 附加样式（沿用 design tokens） ---------- */
.tabx-header{position:sticky;top:0;z-index:60;background:rgba(17,17,19,.97);
  border-bottom:1px solid rgba(250,249,246,.08);backdrop-filter:blur(8px)}
.tabx-brand{max-width:1080px;margin:0 auto;padding:14px 20px 0;display:flex;
  align-items:center;justify-content:space-between}
.tabx-brand a.brand{display:flex;align-items:center;gap:8px;text-decoration:none;
  color:#faf9f6;font-weight:700;font-size:17px}
.tabx-brand .brand-mark{width:18px;height:18px;border-radius:5px;background:#111113;
  position:relative;display:inline-block;border:1px solid #333}
.tabx-brand .brand-mark::after{content:"";position:absolute;right:2px;top:2px;
  width:7px;height:7px;border-radius:50%;background:var(--gold)}
.tabx-brand .zh-name{font-weight:500;color:rgba(250,249,246,.55);font-size:14px}
.tabx-right{display:flex;align-items:center;gap:14px}
.tabx-lang{display:flex;gap:4px}
.tabx-lang button{appearance:none;border:1px solid rgba(250,249,246,.25);background:none;
  color:rgba(250,249,246,.7);font-size:12.5px;padding:4px 10px;border-radius:999px;
  cursor:pointer;font-family:inherit;transition:all .15s}
.tabx-lang button:hover{border-color:var(--gold);color:var(--gold)}
.tabx-lang button.active{background:var(--gold);color:var(--ink);border-color:var(--gold);
  font-weight:700}
.tabx-brand .gh{color:rgba(250,249,246,.75);text-decoration:none;font-size:13.5px;font-weight:600}
.tabx-brand .gh:hover{color:var(--gold)}
.tabx-tabs{max-width:1080px;margin:0 auto;display:flex;gap:2px;overflow-x:auto;
  padding:10px 20px 0;scrollbar-width:none}
.tabx-tabs::-webkit-scrollbar{display:none}
.tabx-tab{appearance:none;border:0;background:none;font-family:inherit;font-size:15px;
  color:rgba(250,249,246,.6);padding:10px 18px 12px;cursor:pointer;white-space:nowrap;
  border-bottom:2px solid transparent;transition:color .15s,border-color .15s}
.tabx-tab:hover{color:#faf9f6}
.tabx-tab.active{color:var(--gold);border-bottom-color:var(--gold);font-weight:600}
.tabx-panel{display:none}
.tabx-panel.active{display:block;animation:tabx-fade .25s ease}
@keyframes tabx-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media(max-width:640px){.tabx-tab{padding:10px 13px 12px;font-size:14px}}
"""

JS = """
(function () {
  var tabs   = Array.prototype.slice.call(document.querySelectorAll('.tabx-tab'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('.tabx-panel'));
  var langBtns = Array.prototype.slice.call(document.querySelectorAll('.tabx-lang button'));
  var TITLES = { zh: '2Origin 本象协议 · 一页总览', en: '2Origin Protocol · All-in-One' };
  var lang = 'zh';

  function storedLang() {
    try { return localStorage.getItem('tabx-lang'); } catch (e) { return null; }
  }

  function show(key) {
    var t = tabs.filter(function (x) { return x.dataset.tab === key })[0] || tabs[0];
    tabs.forEach(function (x) { x.classList.toggle('active', x === t); });
    panels.forEach(function (p) {
      p.classList.toggle('active', p.dataset.panel === t.dataset.tab &&
        (!p.dataset.lang || p.dataset.lang === lang));
    });
    window.scrollTo({ top: 0 });
  }
  function current() {
    var k = location.hash.replace('#', '');
    return tabs.some(function (x) { return x.dataset.tab === k }) ? k : tabs[0].dataset.tab;
  }
  function applyLang(l) {
    lang = l;
    try { localStorage.setItem('tabx-lang', l); } catch (e) {}
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
    document.title = TITLES[l];
    langBtns.forEach(function (b) { b.classList.toggle('active', b.dataset.lang === l); });
    tabs.forEach(function (t) { t.textContent = l === 'zh' ? t.dataset.zh : t.dataset.en; });
    show(current());
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () { location.hash = t.dataset.tab; });
  });
  langBtns.forEach(function (b) {
    b.addEventListener('click', function () { applyLang(b.dataset.lang); });
  });
  // 页内改写过的 tab 链接（如案例卡里的“白鼓挑战规则 →”）也走切换
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var k = a.getAttribute('href').slice(1);
    if (tabs.some(function (x) { return x.dataset.tab === k })) { e.preventDefault(); location.hash = k; }
  });
  window.addEventListener('hashchange', function () { show(current()); });

  var saved = storedLang();
  applyLang(saved === 'zh' || saved === 'en' ? saved
    : ((navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'));
})();
"""


def main():
    nav = "\n".join(
        '<button class="tabx-tab" data-tab="%s" data-zh="%s" data-en="%s">%s</button>'
        % (k, zh, en, zh) for k, zh, en, _, _ in PAGES)
    panels = []
    for key, _, _, zh_src, en_src in PAGES:
        panels.append(build_panel(key, "zh", zh_src[0], zh_src[1]))
        if en_src:
            panels.append(build_panel(key, "en", en_src[0], en_src[1]))

    doc = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>2Origin 本象协议 · 一页总览</title>
<meta name="description" content="本象协议双语一页版：首页 / 宣言 / 解决方案 / 案例 / 白鼓挑战 / 法律Demo / 长期任务。">
<link rel="stylesheet" href="assets/style.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23111113'/%3E%3Ccircle cx='22' cy='10' r='5' fill='%23c9a227'/%3E%3C/svg%3E">
<style>{CSS}</style>
</head>
<body>

<header class="tabx-header">
  <div class="tabx-brand">
    <a class="brand" href="#home"><span class="brand-mark" aria-hidden="true"></span><span>2Origin</span><span class="zh-name">本象协议</span></a>
    <div class="tabx-right">
      <div class="tabx-lang" role="group" aria-label="Language">
        <button data-lang="zh">中文</button>
        <button data-lang="en">EN</button>
      </div>
      <a class="gh" href="https://github.com/dongsheng123132/2origin" target="_blank" rel="noopener">GitHub ↗</a>
    </div>
  </div>
  <nav class="tabx-tabs" aria-label="页面切换">
{nav}
  </nav>
</header>

{chr(10).join(panels)}

<script>{JS}</script>
</body>
</html>
"""
    out = ROOT / "all-in-one.html"
    out.write_text(doc, encoding="utf-8")
    print("已生成 %s（%.1f KB）" % (out, out.stat().st_size / 1024))


if __name__ == "__main__":
    main()
