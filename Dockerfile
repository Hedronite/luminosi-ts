# syntax=docker/dockerfile:1
# LuminosiTS web: the catalog (port 8080) and the Astro site (port 8081), built from source and
# served as static files by Caddy. Base images are pinned by digest; bump them in one PR.

# --- build: Node (Astro needs >= 22.23.4) plus a pinned Bun for the workspace ---
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS bun
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile && bun run icons:check && bun run build

# --- serve: static files only, no Node or Bun at runtime ---
FROM caddy:2.10-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d
# The official binary carries cap_net_bind_service for ports below 1024. We bind 8080 and 8081, and
# the container drops every capability, so remove it; otherwise exec fails under no-new-privileges.
RUN apk add --no-cache libcap && setcap -r /usr/bin/caddy && apk del libcap
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/catalog/dist /srv/catalog
COPY --from=build /repo/apps/site/dist /srv/site
EXPOSE 8080 8081
