# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app
COPY apps/renderer/package*.json ./
RUN npm install
COPY apps/renderer/tsconfig.json ./
COPY apps/renderer/src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

# System dependencies for chrome-headless-shell + FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
    fonts-liberation \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    unzip \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Download chrome-headless-shell — required by HyperFrames for the BeginFrame API
# that enables frame-precise video rendering. Regular chromium does not have this API.
RUN npx --yes @puppeteer/browsers install chrome-headless-shell@stable --path /opt/chrome \
    && CHROME_BIN=$(find /opt/chrome -name 'chrome-headless-shell' -type f | head -1) \
    && chmod +x "$CHROME_BIN" \
    && ln -sf "$CHROME_BIN" /usr/local/bin/chrome-headless-shell-real \
    && echo "chrome-headless-shell installed at: $CHROME_BIN"

# Install wrapper script that clamps Chrome's GPU memory budget to a container-safe
# value. HyperFrames calls os.totalmem() (reads HOST RAM, e.g. 32 GB) and passes
# --force-gpu-mem-available-mb=16384 to SwiftShader. Inside a 512 MB container this
# causes immediate SIGKILL. The wrapper intercepts and replaces it with 256 MB.
COPY apps/renderer/scripts/chrome-wrapper.sh /usr/local/bin/chrome-headless-shell
RUN chmod +x /usr/local/bin/chrome-headless-shell

ENV PRODUCER_HEADLESS_SHELL_PATH=/usr/local/bin/chrome-headless-shell

WORKDIR /app
COPY apps/renderer/package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/tmp

EXPOSE 3001
CMD ["node", "dist/index.js"]
