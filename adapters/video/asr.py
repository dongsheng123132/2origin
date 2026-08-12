#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""本象·video 方言 —— 语音通道（ASR）

n=2 实测证明：没有文本通道，整条管线只剩一个分镜表（见 docs/02-n2-真直播素材.md §2）。
本模块补的就是这条通道。

## 关于 basis：转写不是观察，也不是测量

`basis` 原有三档 observed / measured / asserted，ASR 一个都不属于：
  - 不是 observed —— 我没在画面上读到这句话
  - 不是 measured —— 它是模型输出，会幻觉、会漏、会把方言听成别的词
  - 不是 asserted —— 它不是判断，是有对错的事实主张

所以新增第四档 **transcribed**：模型从音频转写，可回到原片同一时间码复听，
但转写本身可能错，**必须带置信度**。这是 bugscope A1 的直接应用——
「这段文字存在」不等于「他说了这句话」。

输出的每个 segment 都带 avg_logprob 与 no_speech_prob，下游据此决定信不信。

用法:
  python asr.py <音频或视频> [--model small] [--lang zh] [--start S] [--end E] [--out x.json]
"""
import argparse, hashlib, json, os, subprocess, sys, tempfile, time

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--model", default="small")
ap.add_argument("--lang", default="zh")
ap.add_argument("--start", type=float, default=0.0)
ap.add_argument("--end", type=float, default=None)
ap.add_argument("--out", default=None)
ap.add_argument("--device", default="cpu")
a = ap.parse_args()

if not os.path.exists(a.src):
    sys.exit(f"找不到 {a.src}")

sha = hashlib.sha256(open(a.src, "rb").read()).hexdigest()
dur = float(subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
     "-of", "default=nw=1:nk=1", a.src],
    capture_output=True, text=True).stdout.strip())
end = a.end if a.end is not None else dur

# 统一转 16k 单声道 wav —— ASR 引擎的标准输入，避免容器/编码差异带来的静默失败
wav = os.path.join(tempfile.gettempdir(), f"asr_{sha[:12]}_{int(a.start)}_{int(end)}.wav")
if not os.path.exists(wav):
    cmd = ["ffmpeg", "-y", "-v", "error", "-nostdin"]
    if a.start > 0 or end < dur:
        cmd += ["-ss", str(a.start), "-to", str(end)]
    cmd += ["-i", a.src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]
    subprocess.run(cmd, check=True)

from faster_whisper import WhisperModel

t0 = time.time()
model = WhisperModel(a.model, device=a.device, compute_type="int8")
load_s = time.time() - t0

t1 = time.time()
segs, info = model.transcribe(
    wav, language=a.lang, beam_size=5,
    vad_filter=True, vad_parameters=dict(min_silence_duration_ms=400),
    condition_on_previous_text=False,   # 长音频上防止错误滚雪球
)
out = []
for s in segs:
    out.append({
        "t": [round(a.start + s.start, 2), round(a.start + s.end, 2)],
        "text": s.text.strip(),
        "avg_logprob": round(s.avg_logprob, 3),
        "no_speech_prob": round(s.no_speech_prob, 3),
        "compression_ratio": round(s.compression_ratio, 2),
    })
run_s = time.time() - t1
span = end - a.start

# 置信度分档——下游不该平等对待所有转写行
low = [s for s in out if s["avg_logprob"] < -1.0 or s["no_speech_prob"] > 0.5]
speech_s = sum(s["t"][1] - s["t"][0] for s in out)

doc = {
    "$schema": "origin/dialect-video/asr/v0.1",
    "source": {"file": a.src, "sha256": sha, "duration_s": round(dur, 2)},
    "range": [a.start, round(end, 2)],
    "engine": {
        "impl": "faster-whisper", "model": a.model, "device": a.device,
        "compute_type": "int8", "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "vad_filter": True,
    },
    "basis": "transcribed",
    "perf": {"load_s": round(load_s, 1), "transcribe_s": round(run_s, 1),
             "realtime_factor": round(span / run_s, 2) if run_s else None},
    "totals": {
        "segments": len(out),
        "speech_seconds": round(speech_s, 1),
        "speech_ratio": round(speech_s / span, 3) if span else 0,
        "low_confidence_segments": len(low),
    },
    "limits": [
        {"code": "A-TRANSCRIBED-NOT-OBSERVED", "kind": "unverified", "scope": "segments[*].text",
         "statement": "转写是模型输出，不是观察。会幻觉、会漏词、会把方言/产品名听成别的词。"
                      f"本次有 {len(low)}/{len(out)} 条命中低置信阈值（avg_logprob<-1.0 或 no_speech_prob>0.5）。",
         "remedy": "对 value≥0.7 的事件，回到 ref 的时间码人工复听一遍再定稿"},
        {"code": "A-NO-EMOTION", "kind": "lossy", "scope": "segments[*]",
         "statement": "本引擎只出文字，不出情绪、语速、音量、说话人。"
                      "『爆点』在很大程度上是语气而非用词——这条通道仍然缺席。",
         "remedy": "腾讯云 asr CreateRecTask 支持 EmotionRecognition/EmotionalEnergy/SpeakerDiarization，"
                   "需先在控制台开通『语音识别』（当前账号 UserNotRegistered）"},
        {"code": "A-VAD-DROPS", "kind": "lossy", "scope": "覆盖率",
         "statement": f"启用了 VAD 静音过滤，本次识别出语音 {round(speech_s,1)}s / 区间 {round(span,1)}s"
                      f"（{round(speech_s/span*100,1) if span else 0}%）。VAD 判为静音的部分不会被转写，"
                      "低声说话、气声可能被整段丢弃且不报告。",
         "remedy": "怀疑漏话时用 --no-vad 重跑对比（尚未实现）"},
    ],
    "segments": out,
}

dest = a.out or (os.path.splitext(a.src)[0] + f".asr.{a.model}.json")
with open(dest, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)

print(f"源 {a.src} {dur:.1f}s  区间 {a.start}–{end:.1f}s")
print(f"引擎 faster-whisper/{a.model}/{a.device}  语言 {info.language} ({info.language_probability:.2f})")
print(f"耗时 加载 {load_s:.1f}s + 转写 {run_s:.1f}s = {span/run_s if run_s else 0:.1f}x 实时")
print(f"{len(out)} 段 / 语音 {speech_s:.1f}s ({speech_s/span*100 if span else 0:.0f}%) / 低置信 {len(low)} 段")
print(f"→ {dest}")
