# syntax=docker/dockerfile:1
# Base images can be overridden (e.g. public.ecr.aws/docker/library/... if Docker Hub rate-limits).
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

# ---- Build ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Public Supabase settings, baked into the bundle at build time.
# Set these as build arguments in Dokploy / Coolify. Never pass the service role key.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" \
  || (echo "ERROR: build args VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required" && exit 1)
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- Serve ---------------------------------------------------------------
FROM ${NGINX_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
