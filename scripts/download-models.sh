#!/usr/bin/env bash
# Descarga los modelos para la transcripción local (Whisper de sherpa-onnx + VAD Silero).
#   bash scripts/download-models.sh [tiny|base|small|medium]   (por defecto: base)
set -euo pipefail
SIZE="${1:-base}"
D="$(cd "$(dirname "$0")/.." && pwd)/models"
mkdir -p "$D"
BASE=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models
if [ ! -d "$D/sherpa-onnx-whisper-$SIZE" ]; then
  curl -fSL "$BASE/sherpa-onnx-whisper-$SIZE.tar.bz2" | tar xj -C "$D"
fi
[ -s "$D/silero_vad.onnx" ] || curl -fSL -o "$D/silero_vad.onnx" "$BASE/silero_vad.onnx"
[ -s "$D/face_detection_yunet_2023mar.onnx" ] || curl -fSL -o "$D/face_detection_yunet_2023mar.onnx" https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
echo "Modelos en $D. Configura LOCAL_WHISPER_MODEL_DIR=./models/sherpa-onnx-whisper-$SIZE"
