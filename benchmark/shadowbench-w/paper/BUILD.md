# 论文构建 —— 两条命令，以及一个踩过的坑

```bash
cd benchmark/shadowbench-w/paper
pandoc -s -o shadowbench-w-paper.tex shadowbench-w-paper-en-v0.4.md
xelatex -interaction=nonstopmode -halt-on-error shadowbench-w-paper.tex
```

2026-08-12 实测：带 `\usepackage{lmodern}` 直接通过（11 页，exit 0）。
若哪台机器的 MiKTeX 卡在 lmodern 字库生成上（2026-08-07 遇到过），把那一行注释掉即可，
arXiv 接受默认 CM 字体。

```
```

## 必须用 XeLaTeX，不能用 pdfLaTeX

正文含 `≈ ± ≥ → ↓ × §` 等非 ASCII 字符。pdfLaTeX + `inputenc utf8` 在第一个 `≈`（U+2248）
就致命退出，不产出 PDF。**arXiv 支持 XeLaTeX**，提交时在 `00README.XXX` 里声明即可。

## 2026-08-07 那份 .tex 从未编译通过（2026-08-12 发现并修复）

旧 .tex 里所有 ± 被写成 `$\\pm$`、→ 被写成 `$\\to$`。数学模式里 `\\` 是换行符，
不是 `\pm`——这七处会让表格排版垮掉。成因是那一版 .tex 经过了一层手工/脚本后处理，
而不是 pandoc 直出。

**结论：.tex 是产物，不是源文件。改论文只改 `.md`，然后重跑上面两条命令。**
不要直接编辑 .tex——那正是这个 bug 的来源。

## 产物

- `shadowbench-w-paper.pdf` —— 11 页，最后一次构建 2026-08-12，exit 0。
  **未纳入版本控制**（产物会随 .md 漂移）；要发给别人时按上面重新构建一份。
