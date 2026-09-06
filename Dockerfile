# ---------- builder ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps dulu (cache-friendly)
COPY package.json package-lock.json ./
RUN npm ci

# Build TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Butuh wget untuk HEALTHCHECK (alpine minimal tidak selalu ada)
RUN apk add --no-cache wget

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Jalankan sebagai non-root demi keamanan
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
  && chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health | grep -q '"status":"ok"' || exit 1

CMD ["node", "dist/index.js"]
