#!/usr/bin/env bash
# Genera videos reales de prueba con FFmpeg en tests/fixtures (no se versionan).
set -euo pipefail
D="$(dirname "$0")/../tests/fixtures"
mkdir -p "$D"
f() { [ -s "$D/$1" ] || ffmpeg -v error -y "${@:2}" "$D/$1"; }
# 1080p, 30 s, ~20 MB: obliga a subir en varias partes de 8 MB
f big-1080p.mp4 -f lavfi -i "testsrc2=size=1920x1080:rate=30" -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 30 -c:v libx264 -preset ultrafast -b:v 5M -c:a aac -pix_fmt yuv420p
f clip.mov -f lavfi -i "testsrc2=size=1280x720:rate=25" -f lavfi -i "sine=frequency=660" -t 6 -c:v libx264 -preset ultrafast -c:a aac -pix_fmt yuv420p
f vertical.mp4 -f lavfi -i "testsrc2=size=1080x1920:rate=30" -f lavfi -i "sine=frequency=550" -t 5 -c:v libx264 -preset ultrafast -c:a aac -pix_fmt yuv420p
f no-audio.mp4 -f lavfi -i "testsrc2=size=640x360:rate=24" -t 4 -c:v libx264 -preset ultrafast -pix_fmt yuv420p
[ -s "$D/fake.mp4" ] || printf 'esto no es un video, solo texto con extensión mp4\n%.0s' {1..200} > "$D/fake.mp4"
ls -la "$D"
