# ---- Build stage: install deps with native toolchain (for better-sqlite3) ----
FROM node:20-alpine AS deps

WORKDIR /app

# Build tools needed to compile better-sqlite3 against musl libc
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
# Install only production deps; tolerate missing lockfile
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---- Runtime stage ----
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# better-sqlite3 ships a precompiled binding inside node_modules/better-sqlite3/build/
# Carry node_modules over from the build stage as-is.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# SQLite file lives here — mount a volume to persist it
RUN mkdir -p /app/data && \
    addgroup -S app && adduser -S app -G app && \
    chown -R app:app /app
USER app

ENV PORT=4000
EXPOSE 4000

# Point better-sqlite3 at the data volume by symlinking
# (db.js writes data.sqlite next to the server folder)
VOLUME ["/app/data"]

CMD ["node", "src/index.js"]
