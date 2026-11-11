#!/bin/zsh
# Generate an image with FLUX.2 klein 4B (distilled) via mflux / MLX.
#
#   ./gen.sh "a watercolor fox reading a book"
#   ./gen.sh "a watercolor fox" -W 768 -H 1024 -s 42 -n 4
#   FAST=1 ./gen.sh "quick draft"          # 768x768 draft, ~20 s instead of ~33 s
#
# Options: -W width  -H height  -s seed  -n number of images  -o output file
# Env:     Q=4|8 (quantization, default 4)   STEPS (default 4)
#          FAST=1  -> 768x768 unless -W/-H given
# Uses the pre-quantized copies in ./models (made with mflux-save); falls back
# to quantizing the full weights on the fly, which loads slower.
set -euo pipefail

[[ $# -ge 1 ]] || { sed -n '2,11p' "$0"; exit 1; }
prompt=$1; shift

[[ -n ${FAST:-} ]] && side=768 || side=1024
width=$side height=$side seed="" count=1 out=""
while getopts "W:H:s:n:o:" opt; do
  case $opt in
    W) width=$OPTARG ;; H) height=$OPTARG ;; s) seed=$OPTARG ;;
    n) count=$OPTARG ;; o) out=$OPTARG ;;
    *) exit 1 ;;
  esac
done

q=${Q:-4}
extra=()
root=${0:A:h}
if [[ -d $root/models/flux2-klein-4b-q$q ]]; then
  model=($root/models/flux2-klein-4b-q$q --base-model flux2-klein-4b)
else
  model=(flux2-klein-4b --quantize $q)
fi

dir=$root/out
mkdir -p "$dir"
[[ -n $out ]] || out="$dir/$(date +%Y%m%d-%H%M%S).png"

if [[ -n $seed ]]; then
  extra+=(--seed "$seed")
elif (( count > 1 )); then
  extra+=(--auto-seeds "$count")   # model loads once, then N images
fi

exec mflux-generate-flux2 \
  --model "${model[@]}" \
  --prompt "$prompt" \
  --steps "${STEPS:-4}" \
  --guidance 1.0 \
  --width "$width" --height "$height" \
  --output "$out" \
  "${extra[@]}"
