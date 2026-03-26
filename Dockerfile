# Copyright (c) 2025, Sebastian Fast
# All rights reserved.
#
# This source code is licensed under the GPL-style license found in the
# LICENSE file in the root directory of this source tree.

# ---------------------------------------------------------------------------
# Stage 1 — Build
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder

WORKDIR /build

# Install dependencies (including devDependencies for tsc)
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — Production image
# ---------------------------------------------------------------------------
FROM node:22-slim

ARG VERSION=dev

# Only external runtime dependency: 7z
RUN apt-get update && apt-get install -y --no-install-recommends \
    p7zip-full \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /build/dist ./dist

# Runtime config
ENV NODE_ENV=production
ENV APP_VERSION=${VERSION}
LABEL org.opencontainers.image.version="${VERSION}"

# Source data directory (mount point for the data to back up)
RUN mkdir -p /data

ENTRYPOINT ["node", "dist/index.js"]
