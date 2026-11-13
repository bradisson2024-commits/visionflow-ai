#!/usr/bin/env bash
# YOUTUBE AUTOMATIZADO — arranque en Mac / Linux
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Falta Node.js: https://nodejs.org (versión LTS)"; exit 1; }
command -v ffmpeg >/dev/null || { echo "Falta FFmpeg. Mac: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg"; exit 1; }
( sleep 1; (command -v open >/dev/null && open http://127.0.0.1:5317) || xdg-open http://127.0.0.1:5317 ) >/dev/null 2>&1 &
node app/server.js
