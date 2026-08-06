#!/bin/bash
# =============================================================================
# Mac Mini 私有维护员 —— 每日维护循环入口（cron 调用）
#
# crontab 建议：  0 9 * * * ~/work/2origin/scripts/maintain-daily.sh
# 手动冒烟：     ssh macmini 'bash ~/work/2origin/scripts/maintain-daily.sh'
# 日志：         ~/work/2origin/logs/daily-YYYY-MM-DD.log
# =============================================================================
set -uo pipefail

REPO=~/work/2origin
LOG_DIR="$REPO/logs"
mkdir -p "$LOG_DIR"
DATE=$(date +%F)
LOG="$LOG_DIR/daily-$DATE.log"

exec > >(tee -a "$LOG") 2>&1
echo "======================================================"
echo "维护员日报 · $DATE · $(date +%H:%M)"
echo "======================================================"

cd "$REPO"

# 1. 拉最新
echo "==> [1/7] git pull"
git pull --ff-only 2>&1 || echo "!! pull 失败（可能无远端更新或冲突），继续"

# 2. 读世界状态（本象协议核心：先问边界、再看状态）
echo "==> [2/7] 读取世界状态"
node compiler/cli.mjs status project.origin 2>&1 | head -40
node compiler/cli.mjs diagnose project.origin 2>&1 | head -20

# 3. 准备任务文件（长提示词走文件模式，不塞 -z）
#    daily-maintain.md 模板由维护员每次用真实的一天输入填充
echo "==> [3/7] 检查/生成当日任务文件"
TASK=scripts/tasks/daily-maintain.md
if [ ! -f "$TASK" ]; then
  echo "!! 缺少 $TASK，跳过本日（首次运行请先跑一次手工冒烟）"
  exit 0
fi

# 4. 执行（claude 无头模式，读任务文件干活）
echo "==> [4/7] claude 执行每日维护"
if command -v claude >/dev/null 2>&1; then
  claude -p "$(cat "$TASK")" \
    --allowedTools "Bash(git:*),Read,Write,Edit,Bash(npm run verify:*),Bash(node compiler/cli.mjs:*)" \
    2>&1 | tail -60
else
  echo "!! 未安装 claude CLI，本日仅做检视（pull + status + diagnose 已跑）"
fi

# 5. 维护员自己的状态也要提交（dogfooding：协议管好自己的状态）
echo "==> [5/7] 世界状态变更提交检查"
git status --short project.origin/ 2>&1 | head -20

# 6. 全仓验证
echo "==> [6/7] 全仓 verify"
if [ -x node ]; then
  npm run verify 2>&1 | tail -8
fi

# 7. 写日报摘要（append 到日志）
echo "==> [7/7] 完成"
echo "本日结束。完整日志：$LOG"
echo "明天 09:00 再见。"
