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
#
# ffprobe is NOT an enhancement. It is a separate executable from ffmpeg (see
# ffprobeBin() in video.ts) and it measures the source clip whose duration is the
# BILLING BASIS for the per-second video-to-video formats. If it is absent,
# hasFfprobe() returns false, 'reel-remake' / 'motion-transfer' / 'narrated-reel'
# are HIDDEN in the composer, and the feature silently does not exist in
# production — no error, no log, nothing to diagnose. Verified against the Alpine
# package index (branches v3.21, v3.22 and edge): /usr/bin/ffprobe ships inside
# the `ffmpeg` package itself; only `ffplay` is split out, and no `ffmpeg-tools`
# package exists. So no extra package — but assert it, because the whole point is
# that losing it is invisible at runtime. A base-image bump or an upstream
# subpackage split must break the BUILD, loudly, instead of quietly deleting a
# paid feature from the composer.
RUN apk add --no-cache ffmpeg font-dejavu

# The assertion itself. `command -v` already exits non-zero when the binary is
# absent, which is enough to fail the build; the echo just names the casualty in
# the build log. Two empty layers, no install, no cost.
RUN command -v ffmpeg || { echo "FATAL: ffmpeg is missing from the runtime image"; exit 1; }
RUN command -v ffprobe || { echo "FATAL: ffprobe is missing - video-to-video would be HIDDEN in the composer, not failed"; exit 1; }

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
