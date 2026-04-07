FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ui/package.json packages/ui/
COPY packages/api-server-api/package.json packages/api-server-api/
COPY packages/harness-runtime-api/package.json packages/harness-runtime-api/

RUN pnpm install --frozen-lockfile --filter humr-ui...

COPY packages/api-server-api/ packages/api-server-api/
COPY packages/harness-runtime-api/ packages/harness-runtime-api/
COPY packages/ui/ packages/ui/

RUN pnpm --filter humr-ui build

FROM nginx:1-alpine

COPY --from=build /app/packages/ui/dist /usr/share/nginx/html

EXPOSE 8080
