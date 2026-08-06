#!/bin/bash
# ShadowBench-W 接力链：等 S级a0 收尾 → M级deepseek 三臂×10 → M级qwen 三臂×10
# 2026-08-06 由 Hermes 启动；每臂崩溃自动 --rep-offset 续跑（最多 4 次尝试）
# 日志：benchmark/shadowbench-w/results-v3-m/relay.log
cd "/d/uking编程/本象协议/benchmark/shadowbench-w" || exit 1
export HERMES_HOME="Y:/compare-upstream/hermes-home"
LOG="results-v3-m/relay.log"
mkdir -p results-v3-m
echo "=== relay start $(date +%F\ %T) ===" >> "$LOG"

# ── 阶段 0：等 S 级 a0 补跑完毕（rep1-10 全落盘），上限 6 小时 ──
all_reps() { for i in 1 2 3 4 5 6 7 8 9 10; do [ -f "results-v3/a0-hermes-rep$i.json" ] || return 1; done; return 0; }
deadline=$(( $(date +%s) + 6*3600 ))
while ! all_reps; do
  if [ $(date +%s) -gt $deadline ]; then
    echo "[S级a0] 超时未齐（可能崩溃），按现状放行 M 级 $(date +%T)" >> "$LOG"
    break
  fi
  sleep 120
done
# 锁还在且进程活着 → 等；锁残留但进程死了 → 清理
for i in $(seq 1 120); do
  [ -f "results-v3/.run.lock" ] || break
  LOCKPID=$(python -c "import json;print(json.load(open('results-v3/.run.lock'))['pid'])" 2>/dev/null)
  if [ -z "$LOCKPID" ] || ! kill -0 "$LOCKPID" 2>/dev/null; then
    rm -f "results-v3/.run.lock"
    break
  fi
  sleep 60
done
SREPS=$(ls results-v3/a0-hermes-rep*.json 2>/dev/null | wc -l)
echo "[S级a0] 落盘 ${SREPS} 轮，进入 M 级阶段 $(date +%T)" >> "$LOG"

# ── 通用：跑一个臂，崩溃自动续跑 ──
run_arm() {  # $1=provider $2=arm
  local provider=$1 arm=$2 tries=0 rc
  while [ $tries -lt 4 ]; do
    local maxrep=$(ls ${arm}-m-${provider}-rep*.json 2>/dev/null | sed -E "s/${arm}-m-${provider}-rep([0-9]+)\.json/\1/" | sort -n | tail -1)
    local off=0; [ -n "$maxrep" ] && off=$maxrep
    local reps=$((10 - off))
    if [ $reps -le 0 ]; then echo "[$provider $arm] 已完成 10 轮" >> "$LOG"; return 0; fi
    echo "[$provider $arm] 启动 offset=$off repeat=$reps $(date +%T)" >> "$LOG"
    node run.mjs --provider "$provider" --task continuation-m.json --arm "$arm" --rep-offset "$off" --repeat "$reps" --out results-v3-m >> "$LOG" 2>&1
    rc=$?
    if [ $rc -eq 0 ]; then echo "[$provider $arm] 完成 $(date +%T)" >> "$LOG"; return 0; fi
    tries=$((tries+1))
    echo "[$provider $arm] 崩溃 rc=$rc 第${tries}次重试 $(date +%T)" >> "$LOG"
    sleep 30
  done
  echo "[$provider $arm] 重试耗尽，跳过（事后手动续）" >> "$LOG"
  return 1
}

# ── 阶段 1：M 级 deepseek 三臂 ×10（hermes 通道）──
for arm in a0 a1 a3; do run_arm hermes $arm; done
echo "[deepseek] M 级三臂阶段结束 $(date +%T)" >> "$LOG"

# ── 阶段 2：M 级 qwen 三臂 ×10（百炼 bl CLI）──
for arm in a0 a1 a3; do run_arm bailian $arm; done
echo "[qwen] M 级三臂阶段结束 $(date +%T)" >> "$LOG"

echo "=== relay done $(date +%F\ %T) ===" >> "$LOG"
