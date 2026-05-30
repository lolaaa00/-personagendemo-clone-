FROM node:20-slim

# Chromium system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation \
    libgbm-dev \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libxss1 \
    libasound2 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/factory/package.json services/factory/package-lock.json* ./
RUN npm ci --production --ignore-scripts=false

COPY services/factory/src/ ./src/

RUN mkdir -p /data/profiles /data/screenshots

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:8080/health || exit 1

USER node

CMD ["node", "src/server.js"]
