#!/usr/bin/env bash
# SkillHub 发布一键脚本（腾讯 SkillHub，中文主战场）
#
# 前置：用户已在 skillhub.cn 微信扫码登录并取得 API Token（skh_...）
#   获取方式：skillhub auth token（若已 login）或在 skillhub.cn 网页生成
#
# 用法：
#   SKILLHUB_TOKEN=*** bash scripts/publish-skillhub.sh

set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$HOME/.skillhub/skills_store_cli.py"
TOKEN="${SKILLHUB_TOKEN:-}"

if [[ -z "$TOKEN" ]]; then
  echo "错误：未设置 SKILLHUB_TOKEN（skh_...）。"
  echo "  - 已登录：python $CLI auth token"
  echo "  - 未登录：skillhub.cn 网页登录后生成 token"
  exit 1
fi

cd "$HERE/.agents/skills"

for d in origin-writer benxiang-memory origin-office; do
  echo "=== 发布 $d ==="
  python "$CLI" publish "$d" --token "$TOKEN" || {
    echo "  ✗ $d 发布失败（若为已存在版本，可加 --version 1.0.1）"
    exit 1
  }
done

echo ""
echo "✓ 三个 skill 已发布到 SkillHub。验证："
echo "  python $CLI search origin-writer"
