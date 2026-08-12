#!/usr/bin/env bash
# 投影渲染器：读 <timeline> 的 projections.<name>.pick，把本象投影成一条成片。
# 用法: ./render.sh <projection> [timeline.origin.json]
set -euo pipefail
cd "$(dirname "$0")"

NAME="${1:-douyin_30s}"
TL="${2:-timeline.origin.json}"
TLDIR="$(dirname "$TL")"
SRC="$TLDIR/$(node -e "console.log(require('./$TL').source.file)")"
OUT="$TLDIR/out_${NAME}.mp4"

# fail-closed：不过校验就不许出片。
# 这条管线的致命失效（时间码错基准、素材被换、pick 越界）全部**不会让 ffmpeg 报错**——
# 它会成功输出一个时长精确的 mp4 并打印 OK。所以缺席必须在入口拦。
if ! node validate.mjs "$TL" > /tmp/origin-video-validate.log 2>&1; then
  echo "拒绝渲染：$TL 未通过校验" >&2
  cat /tmp/origin-video-validate.log >&2
  exit 1
fi
grep -E '^⚠' /tmp/origin-video-validate.log >&2 || true

PICKS=$(node -e "
const t=require('./$TL');
const p=t.projections['$NAME'];
if(!p){console.error('no projection: $NAME');process.exit(1)}
console.log(p.pick.map(s=>s.join(',')).join(' '));
")

W=$(ffprobe -v error -select_streams v -show_entries stream=width -of default=nw=1:nk=1 "$SRC" | head -1)
H=$(ffprobe -v error -select_streams v -show_entries stream=height -of default=nw=1:nk=1 "$SRC" | head -1)
if [ "$W" -ge "$H" ]; then
  VF='scale=1080:-2,setsar=1'
  BG='scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:2'
else
  VF='scale=-2:1920,crop=min(iw\,1080):1920,setsar=1'
  BG='scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:2'
fi

fc=""; n=0
for seg in $PICKS; do
  s=${seg%,*}; e=${seg#*,}
  fc+="[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS,${VF}[fg${n}];"
  fc+="[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS,${BG}[bg${n}];"
  fc+="[bg${n}][fg${n}]overlay=(W-w)/2:(H-h)/2[v${n}];"
  fc+="[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${n}];"
  n=$((n+1))
done
for ((i=0;i<n;i++)); do fc+="[v${i}][a${i}]"; done
fc+="concat=n=${n}:v=1:a=1[v][a]"

ffmpeg -y -v error -i "$SRC" -filter_complex "$fc" -map '[v]' -map '[a]' \
  -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 128k "$OUT"

ffprobe -v error -show_entries format=duration -show_entries stream=width,height \
  -of default=noprint_wrappers=1 "$OUT"
echo "OK -> $OUT"
