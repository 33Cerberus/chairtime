# syntax=docker/dockerfile:1
# One image: the API, which also serves the built web app. One origin for pages, API and cookies.

# ---- Build ---------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Manifests first, so the dependency layer is reused until they change.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Install scripts are skipped (the Prisma schema is not copied yet). The one that matters is
# run by hand: it fetches the engine that applies migrations when the container starts.
RUN npm ci --ignore-scripts \
 && (cd node_modules/@prisma/engines && node scripts/postinstall.js)

COPY apps ./apps
RUN npm run generate -w apps/api \
 && npm run build \
 # Reinstall with only what the API needs at run time: no build tools, and none of the web
 # app's libraries (it is already compiled to static files).
 && rm -rf node_modules apps/api/node_modules apps/web/node_modules \
 && npm ci --omit=dev --ignore-scripts --workspace apps/api \
 && (cd node_modules/@prisma/engines && node scripts/postinstall.js) \
 && npm run generate -w apps/api \
 && mkdir -p apps/api/node_modules

# ---- Run -----------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS run
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=4000 \
    WEB_DIST=/app/apps/web/dist

WORKDIR /app/apps/api
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/web/dist /app/apps/web/dist

# Uploaded photos live here when S3 is not configured: mount a volume.
RUN mkdir -p uploads && chown -R node:node uploads
USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are applied on every start; they are idempotent.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
