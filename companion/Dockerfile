# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG NODE_RUNTIME_IMAGE=node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3

FROM ${NODE_IMAGE} AS workspace
WORKDIR /app

COPY package.json package-lock.json ./
COPY companion/package.json companion/package.json
COPY packages/contracts/package.json packages/contracts/package.json

FROM workspace AS build
RUN npm ci \
    --include-workspace-root=false \
    --workspace @wave/contracts \
    --workspace @wave/companion

COPY companion/tsconfig.json companion/tsconfig.build.json companion/
COPY companion/src companion/src
COPY packages/contracts/tsconfig.json packages/contracts/
COPY packages/contracts/src packages/contracts/src

RUN npm run build --workspace @wave/companion

FROM workspace AS production-dependencies
RUN npm ci \
    --omit=dev \
    --include-workspace-root=false \
    --workspace @wave/contracts \
    --workspace @wave/companion

FROM ${NODE_RUNTIME_IMAGE} AS runtime

ARG WAVE_COMPANION_REVISION=unknown

LABEL org.opencontainers.image.title="Wave Companion" \
      org.opencontainers.image.description="Trusted Wave mobile boundary for Hermes and OpenAI Realtime" \
      org.opencontainers.image.revision="${WAVE_COMPANION_REVISION}" \
      org.opencontainers.image.source="https://github.com/RenanQueiroz/wave-for-hermes"

ENV NODE_ENV=production
WORKDIR /app

# The production service and operator entrypoints need Node, not package
# managers. Removing npm/corepack also removes their unused dependency trees
# from the runtime attack surface.
RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
      /usr/local/bin/pnpm \
      /usr/local/bin/pnpx

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/package.json ./package.json
COPY --from=production-dependencies --chown=node:node /app/companion/package.json companion/package.json
COPY --from=production-dependencies --chown=node:node /app/companion/node_modules companion/node_modules
COPY --from=production-dependencies --chown=node:node /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=production-dependencies --chown=node:node /app/packages/contracts/node_modules packages/contracts/node_modules
COPY --from=build --chown=node:node /app/companion/dist companion/dist
COPY --from=build --chown=node:node /app/packages/contracts/dist packages/contracts/dist

USER node
STOPSIGNAL SIGTERM

CMD ["node", "companion/dist/server.js"]
