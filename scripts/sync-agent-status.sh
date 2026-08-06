#!/bin/bash
# =============================================================================
# 本机：从 Mac Mini 拉取维护员状态，同步到网站 longrun/agents.json
# 这样 2origin.org/longrun/ 就能展示「本象协议正在被长期维护」的实时状态。
#
# 用法：bash scripts/sync-agent-status.sh
# 建议 cron：每小时一次（状态不频繁变化）
#   crontab 0 * * * * bash ~/work/2origin/scripts/sync-agent-status.sh
# =============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/website/longrun/agents.json"

echo "==> 从 macmini 拉取 agents.json"
if ssh -o ConnectTimeout=8 -o BatchMode=yes macmini "test -f ~/work/2origin/longrun/agents.json && cat ~/work/2origin/longrun/agents.json" > "$OUT.tmp" 2>/dev/null && [ -s "$OUT.tmp" ]; then
  mv "$OUT.tmp" "$OUT"
  echo "✅ 已同步 -> $OUT"
  node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log('    agent:', d.agents[0].name, '| status:', d.agents[0].status, '| updated:', d.updated_at)" "$OUT"
else
  echo "⚠️ 拉取失败（Mac Mini 未产出状态文件？），保留上次状态"
  rm -f "$OUT.tmp"
fi
