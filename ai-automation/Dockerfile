# Multi-stage: the first FROM builds, the second copies only the result. The
# shipped image has no compilers and no dev dependencies in it, so it is
# smaller and there is less inside it to attack.
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json        apps/api/
COPY apps/editor/package*.json     apps/editor/
COPY packages/engine/package*.json packages/engine/
COPY packages/nodes/package*.json  packages/nodes/
RUN npm ci

COPY . .
RUN npm run build --workspace @ai-automation/editor
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache wget
COPY --from=build /app /app

USER node                         # a container escape lands on an unprivileged account
EXPOSE 5678

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:5678/healthz || exit 1

CMD ["node", "apps/api/server.js"]
