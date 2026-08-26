# -*- coding: utf-8 -*-
"""生成 90 秒演示的浓缩 GIF：全部文案来自真实终端输出（2026-08-26 实跑）。"""
from PIL import Image, ImageDraw, ImageFont

W, H = 920, 600
HEADER_H = 64
BG = (255, 255, 255)
HEADER_BG = (20, 54, 93)        # 深蓝题头
ACCENT = (37, 99, 235)          # 单蓝强调
TEXT = (31, 41, 55)
GREEN = (22, 163, 74)
RED = (220, 38, 38)
AMBER = (180, 83, 9)
GRAY = (107, 114, 128)
PROMPT = ACCENT

FONT_PATH = "C:/Windows/Fonts/msyh.ttc"
try:
    F = ImageFont.truetype(FONT_PATH, 19)
    FB = ImageFont.truetype(FONT_PATH, 22)
    FH = ImageFont.truetype(FONT_PATH, 26)
except Exception:
    F = ImageFont.load_default()
    FB = F
    FH = F

def colorize(line):
    if line.startswith("$"):
        return PROMPT
    if line.startswith("✓"):
        return GREEN
    if line.startswith(("✗", "错误", "error")):
        return RED
    if line.startswith("warning"):
        return AMBER
    if line.startswith("#") or line.startswith("「"):
        return GRAY
    return TEXT

SCENES = [
    # (场景标题, 行列表, 每行停留帧数)
    ("", [
        "",
        "   本象协议 Benxiang · Origin IR",
        "",
        "   AI 只提交语义事务，确定性编译器校验后才落地。",
        "   落地之后，包里每个字段都能回答：",
        "",
        "   「凭什么是这个值？」",
        "",
        "   下面是真实终端输出。 —— 90 秒看懂",
    ], 10),
    ("status · 这个包里有什么", [
        "$ benxiang status demo.origin",
        "",
        "artifact      sales-2026",
        "objects       5",
        "relations     2",
        "constraints   0/2 可机器判定",
        "changes       2",
        "last_change   projection:revenue-trend.chart",
        "",
        "# 一个 .origin 包 = 对象+关系+状态+约束+来源+边界",
    ], 14),
    ("commit · 唯一写入口：校验不过，一个字节都不写", [
        "$ benxiang commit demo.origin tx-change-chart.json \\",
        "      --expect 2 --by demo",
        "",
        "✓ 已落盘 seq 2–2，责任者 demo",
        "warning  unenforceable 约束 revenue must_not_be_negative 无机器判定，未校验",
        "",
        "# 连自己管不了的约束都当面告诉你 —— 边界进包",
    ], 14),
    ("why · 这个值凭什么是这个值", [
        "$ benxiang why demo.origin revenue-trend.chart",
        "",
        "当前值：Stacked Bar Chart（经 2 次事务改动）",
        "",
        "seq  by            tx                 变化",
        "2    model@demo    tx-…803-004   Grouped → Stacked",
        "1    claude@draft  tx-…802-001   Line → Grouped",
        "",
        "# 完整证据链：谁、何时、基于什么改的",
    ], 14),
    ("冲突 · 有人插队？当场拒绝", [
        "$ benxiang commit demo.origin tx-bad.json \\",
        "      --expect 1 --by attacker",
        "",
        "error  write-conflict",
        "       读取时世界在第 1 号，现已是第 2 号——有人插队，",
        "       请基于最新状态重写",
        "✗ 未落盘（1 条错误）",
        "",
        "# 乐观锁内置：AI 并发写作不打架",
    ], 14),
    ("", [
        "",
        "   npm i -g benxiang-origin",
        "",
        "   github.com/dongsheng123132/2origin",
        "",
        "   一源万影：保存本象，按需投影。",
    ], 12),
]

def render(lines_shown, scene_title, progress_note=""):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # 题头
    d.rectangle([0, 0, W, HEADER_H], fill=HEADER_BG)
    title = "本象协议 Benxiang · 终端实录" if not scene_title else scene_title
    d.text((24, HEADER_H // 2 - 15), title, font=FB, fill=(255, 255, 255))
    d.ellipse([W - 44, 20, W - 24, 40], fill=ACCENT)
    # 正文
    y = HEADER_H + 30
    for ln in lines_shown:
        c = colorize(ln)
        d.text((36, y), ln, font=F, fill=c)
        y += 32
    # 底部进度条
    if progress_note:
        frac = progress_note
        d.rectangle([0, H - 8, int(W * frac), H], fill=ACCENT)
    return img

frames = []
total_scenes = len(SCENES)
for si, (title, lines, hold) in enumerate(SCENES):
    # 打字机逐行显现
    for k in range(1, len(lines) + 1):
        frac = (si + k / len(lines)) / total_scenes
        frames.append(render(lines[:k], title, frac))
    # 停留帧
    for _ in range(hold):
        frac = (si + 1) / total_scenes
        frames.append(render(lines, title, frac))

out = r"D:/uking编程/本象协议/tmp/demo.gif"
frames[0].save(out, save_all=True, append_images=frames[1:], duration=110, loop=0, optimize=True)
import os
print("GIF 完成:", out, "| 帧数:", len(frames), "| 大小: %.1f MB" % (os.path.getsize(out) / 1048576))
