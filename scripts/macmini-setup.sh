#!/bin/bash
# =============================================================================
# Mac Mini 私有维护员 —— 一次性接入脚本
# 在 Mac Mini 上执行（本机先做，之后 cron 自动化）
#
# 用法：
#   ssh macmini 'bash -s' < scripts/macmini-setup.sh
# 或直接复制到 Mac Mini 上 bash 运行。
#
# 作用：装 Claude Code CLI → 拉本象仓库 → 跑冒烟验证
# =============================================================================
set -euo pipefail

echo "==> [1/5] 检查前置工具"
command -v node >/dev/null || { echo "缺少 node"; exit 1; }
command -v git  >/dev/null || { echo "缺少 git";  exit 1; }
echo "    node: $(node --version)  git: $(git --version)"

echo "==> [2/5] 安装 Claude Code CLI（全局 npm）"
if command -v claude >/dev/null 2>&1; then
  echo "    claude 已安装: $(claude --version)"
else
  npm install -g @anthropic-ai/claude-code
  claude --version
fi

echo "==> [3/5] 拉取本象协议仓库"
WORK=~/work
mkdir -p "$WORK"
if [ ! -d "$WORK/2origin/.git" ]; then
  git clone https://github.com/dongsheng123132/2origin.git "$WORK/2origin"
else
  cd "$WORK/2origin" && git pull --ff-only
fi

echo "==> [4/5] 冒烟：跑全仓 verify（零第三方依赖，只需 Node）"
cd "$WORK/2origin"
npm run verify 2>&1 | tail -15

echo "==> [5/5] 冒烟：读本仓库自己的世界状态"
node compiler/cli.mjs status project.origin 2>&1 | head -20

echo ""
echo "✅ Mac Mini 维护员接入完成。"
echo "   下一步：手工跑一次完整维护循环（见 scripts/maintain-daily.sh 与 scripts/tasks/daily-maintain.md）"
echo "   然后：crontab -e 加入： 0 9 * * * $WORK/2origin/scripts/maintain-daily.sh"
