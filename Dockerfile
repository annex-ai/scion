# Stage 1: Build
FROM oven/bun:1 AS builder
WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
RUN bun run build

# Stage 2: Runtime
FROM oven/bun:1
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends libvips-dev curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r appgroup && useradd -r -g appgroup -s /usr/sbin/nologin appuser

# Copy built artifacts and runtime files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.mastra ./.mastra
COPY --from=builder /app/.agent ./.agent
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create writable directories and set ownership
RUN mkdir -p /app/.agent/data /app/.tmp && chown -R appuser:appgroup /app

USER appuser

EXPOSE 4111

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4111/_gateway/health || exit 1

CMD ["bun", "run", "start"]
