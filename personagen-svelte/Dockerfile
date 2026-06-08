# Multi-stage build for SvelteKit Node adapter
FROM node:20-alpine AS builder

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
FROM node:20-alpine AS runner

WORKDIR /app

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
