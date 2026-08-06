#!/usr/bin/env bash
# SkillHub 发布一键脚本（腾讯 SkillHub，中文主战场）
#
# 前置：用户已在 skillhub.cn 微信扫码登录并取得 API Token（skh_...）
#   获取方式：python ~/.skillhub/skills_store_cli.py login --key skh_xxx
#   或 skillhub.cn 网页登录后生成 token
#
# 用法：
#   SKILLHUB_TOKEN=skh_xxx bash scripts/publish-skillhub.sh          # 全部 4 个
#   SKILLHUB_TOKEN=skh_xxx bash scripts/publish-skillhub.sh origin-writer  # 只发一个
#
# 坑（2026-08-07 实测）：
#   SkillHub 不允许 LICENSE 文件随 skill 上传（400: 不允许的文件类型），
#   而 ClawHub 接受 LICENSE。故本脚本用临时副本剔除 LICENSE 再发布，
#   不改动 .agents/skills/ 源码目录。

set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$HOME/.skillhub/skills_store_cli.py"
TOKEN="${SKILLHUB_TOKEN:-}"
SKILLS=("${@:-benxiang-memory benxiang-protocol origin-office origin-writer}")

if [[ -z "$TOKEN" ]]; then
  echo "错误：未设置 SKILLHUB_TOKEN（skh_...）。"
  echo "  - 已登录：python $CLI auth token"
  echo "  - 未登录：python $CLI login --key skh_xxx"
  exit 1
fi

for d in "${SKILLS[@]}"; do
  echo "=== 发布 $d ==="
  SRCDIR="$HERE/.agents/skills/$d"
  [[ -d "$SRCDIR" ]] || { echo "  ✗ 目录不存在: $SRCDIR"; exit 1; }
  TMPDIR="$(mktemp -d)/$d"
  cp -r "$SRCDIR" "$TMPDIR"
  rm -f "$TMPDIR/LICENSE" "$TMPDIR/../$d/LICENSE"
  python "$CLI" publish "$TMPDIR" --token "$TOKEN" || {
    echo "  ✗ $d 发布失败（若为已存在版本，可加 --version 1.0.1）"
    exit 1
  }
done

echo ""
echo "✓ ${#SKILLS[@]} 个 skill 已发布到 SkillHub。验证："
echo "  python $CLI search benxiang"
echo "  python $CLI search origin"
