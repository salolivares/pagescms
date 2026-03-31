FROM node:20-alpine AS base

# --- Dependencies ---
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# --- Builder ---
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Skip postbuild migration during image build (no DB available)
# BASE_URL placeholder is needed because Next.js evaluates it at build time
RUN sed -i '/"postbuild"/d' package.json && \
    BASE_URL=http://localhost:3000 npm run build

# --- Runner ---
FROM base AS runner
WORKDIR /app

ARG NODE_ENV=production
ARG PORT=3000

ENV NODE_ENV=${NODE_ENV}
ENV PORT=${PORT}
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Lightweight migration runner with postgres driver
COPY --from=builder /app/db/migrations ./db/migrations
COPY --from=builder /app/db/migrate.mjs ./db/migrate.mjs
COPY --from=deps /app/node_modules/postgres ./node_modules/postgres

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
