FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/agent-runtime-api/package.json packages/agent-runtime-api/

RUN pnpm install --frozen-lockfile --filter agent-runtime...

COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/agent-runtime/ packages/agent-runtime/

RUN pnpm --filter agent-runtime build

FROM node:22-slim

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY packages/humr-base/package.json ./
RUN npm install --production

COPY --from=builder /app/packages/agent-runtime/dist/ dist/

RUN mkdir -p working-dir

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
