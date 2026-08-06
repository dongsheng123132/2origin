#!/bin/bash
# =============================================================================
# Mac Mini 维护员 —— 跑完每日循环后，把状态写成本机可读的 agents.json
# 在 maintain-daily.sh 末尾调用；或手动执行。
#
# 产物：~/work/2origin/longrun/agents.json
# 本机查看：ssh macmini 'cat ~/work/2origin/longrun/agents.json'
#           （或 Syncthing 同步到本机 ~/.uking/longrun/agents.json）
# =============================================================================
set -uo pipefail

REPO=~/work/2origin
OUT="$REPO/longrun/agents.json"
mkdir -p "$REPO/longrun"

# --- 采集真实状态（不编造） ---
DATE_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LAST_LOG=$(ls -t "$REPO"/logs/daily-*.log 2>/dev/null | head -1)
LAST_RESULT=""
if [ -n "$LAST_LOG" ]; then
  LAST_RESULT=$(grep -E "✅|📦|verify|commit" "$LAST_LOG" 2>/dev/null | tail -3 | tr '\n' ' ')
fi

# world state 摘要
OBJ=$(node "$REPO/compiler/cli.mjs" status "$REPO/project.origin" 2>/dev/null | grep -oE "objects\s+[0-9]+" | grep -oE "[0-9]+" | head -1)
CHG=$(node "$REPO/compiler/cli.mjs" status "$REPO/project.origin" 2>/dev/null | grep -oE "changes\s+[0-9]+" | grep -oE "[0-9]+" | head -1)

# 最近的日志 tail（≤4KB）
LOG_TAIL=""
if [ -n "$LAST_LOG" ]; then
  LOG_TAIL=$(tail -c 4096 "$LAST_LOG")
fi

# 状态判定：最近一次日志是否 2 天内 → running，否则 idle
STATUS="idle"
if [ -n "$LAST_LOG" ] && [ "$(find "$LAST_LOG" -mtime -2 2>/dev/null)" = "$LAST_LOG" ]; then
  STATUS="running"
fi

# --- 写 JSON（用 python 保证合法 JSON，python 自己落盘） ---
python3 - "$DATE_ISO" "$STATUS" "$LAST_RESULT" "$OBJ" "$CHG" "$LOG_TAIL" "$OUT" <<'PYEOF'
import json, sys
date_iso, status, result, obj, chg, log_tail, out = sys.argv[1:8]
data = {
  "version": 1,
  "updated_at": date_iso,
  "agents": [{
    "id": "macmini-maintainer",
    "name": "本象协议维护员",
    "host": "macmini",
    "os": "macOS 15.6.1",
    "status": status,
    "last_run_at": date_iso,
    "last_run_result": result.strip() or "no run yet",
    "next_run_at": None,
    "schedule": "0 9 * * *",
    "log_tail": log_tail.strip()[-4096:],
    "world": {"objects": obj or 0, "changes": chg or 0}
  }]
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("状态已写入: " + out)
PYEOF

cat "$OUT"
