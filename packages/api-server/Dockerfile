FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/api-server/package.json packages/api-server/
COPY packages/api-server-api/package.json packages/api-server-api/

RUN pnpm install --frozen-lockfile --filter api-server...

COPY packages/api-server-api/ packages/api-server-api/
COPY packages/api-server/ packages/api-server/

RUN pnpm --filter api-server build

EXPOSE 4000

CMD ["node", "packages/api-server/dist/index.js"]
