# ClipForge AI — imagen única para la web y el worker.
# Ubuntu 24.04: FFmpeg 6.1 con libass y Python 3.12 (las versiones con las que se probó).
ARG BASE_IMAGE=ubuntu:24.04
FROM node:22-bookworm-slim AS node
FROM ${BASE_IMAGE}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV DEBIAN_FRONTEND=noninteractive

# FFmpeg (con libass para subtítulos), Python para transcripción local y rostros
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip python3-venv curl ca-certificates bzip2 fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Dependencias Python en un entorno virtual
COPY worker/py/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/py && /opt/py/bin/pip install --no-cache-dir -r /tmp/requirements.txt
ENV PATH="/opt/py/bin:${PATH}" PYTHON_PATH=/opt/py/bin/python YTDLP_PATH=/opt/py/bin/yt-dlp

WORKDIR /app

# Modelos (Whisper base, VAD, detector de rostros) — capa propia para aprovechar la caché
COPY scripts/download-models.sh scripts/download-models.sh
RUN bash scripts/download-models.sh base

# Dependencias Node
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Código y compilación
COPY . .
RUN npm run build

ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["npm", "start"]
