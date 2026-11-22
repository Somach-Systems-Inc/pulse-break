#!/bin/bash
# Build the demo video: the footage the SDK read (left) next to the app's own
# terminal (right), both on the clip's clock. Needs agg, ffmpeg, python3 + Pillow.
#   tools/make_demo.sh <retimed.cast> <clip the SDK read> <clip start s> <background.png> <out.mp4>
# Make the cast with tools/retime_cast.mjs and the background with tools/make_background.py.
set -euo pipefail
CAST=$1; CLIP=$2; MAIN=$3; BG=$4; OUT=$5
LAST=${LAST:-6}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

agg --font-size 30 --line-height 1.3 --theme monokai --idle-time-limit 1000 --last-frame-duration "$LAST" --fps-cap 15 "$CAST" "$WORK/term.gif"
TERM_LEN=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK/term.gif")
CLIP_LEN=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CLIP")
TAIL=$(echo "$TERM_LEN - $MAIN - $CLIP_LEN" | bc -l)
if (( $(echo "$TAIL < 0" | bc -l) )); then TAIL=0; fi
echo "terminal ${TERM_LEN}s, clip ${CLIP_LEN}s, clip starts at ${MAIN}s, last frame held ${TAIL}s"

ffmpeg -v error -y \
  -loop 1 -framerate 30 -i "$BG" \
  -i "$CLIP" \
  -i "$WORK/term.gif" \
  -filter_complex "\
[1:v]scale=720:-2,tpad=start_mode=clone:start_duration=${MAIN}:stop_mode=clone:stop_duration=${TAIL},fps=30,setpts=PTS-STARTPTS[face];\
[2:v]fps=30,scale=1040:-2,setpts=PTS-STARTPTS[term];\
[0:v][face]overlay=x=70:y=170[a];\
[a][term]overlay=x=820:y=170:eof_action=repeat,format=yuv420p[v]" \
  -map "[v]" -t "$TERM_LEN" -r 30 -c:v libx264 -preset medium -crf 20 -movflags +faststart "$OUT"
echo "wrote $OUT"
