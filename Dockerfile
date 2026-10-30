# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
# Vite imports the URL import middleware while loading its configuration.
COPY server ./server
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG YT_DLP_VERSION=2026.10.26

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5173 \
    PYTHONDONTWRITEBYTECODE=1 \
    YT_DLP_PATH=/opt/yt-dlp/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe
ENV PATH="/opt/yt-dlp/bin:${PATH}"

# The default extra includes yt-dlp-ejs for YouTube's JavaScript challenges.
# The importer supplies the Node binary as yt-dlp's JavaScript runtime.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        python3 \
        python3-venv \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]==${YT_DLP_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY src/media-source.js ./src/media-source.js

# Production server code uses only Node built-ins; no node_modules are needed.
USER 1000:1000
RUN node --version \
    && yt-dlp --version \
    && python3 -c "import yt_dlp_ejs" \
    && ffmpeg -version > /dev/null \
    && ffprobe -version > /dev/null

EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 5173) + '/', {signal: AbortSignal.timeout(3000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server/index.js"]
