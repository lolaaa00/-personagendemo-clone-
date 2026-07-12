# Multi-stage build for SvelteKit Node adapter
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy codebase
COPY . .

# Set env to trigger adapter-node build
ENV IS_DOCKER=true

# Build production artifact
RUN npm run build

# --- Production Runner Stage ---
FROM node:22-alpine AS runner

WORKDIR /app

# Runtime media deps: ffmpeg + a DejaVu font power the optional on-screen caption
# and "AI GENERATED" badge burn (src/lib/server/video.ts). Without them the burn
# silently no-ops (captions are an enhancement, never a hard dep) — install them
# so the feature actually works in the container. font-dejavu lands the .ttf at
# /usr/share/fonts/dejavu/, which findFont() looks for. Own layer = cached across
# app rebuilds.
RUN apk add --no-cache ffmpeg font-dejavu

# Copy built package and manifest files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/build ./build

# Install ONLY production dependencies to keep image size small
RUN npm ci --omit=dev

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Start SvelteKit server
CMD ["node", "build/index.js"]
