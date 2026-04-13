FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/agent-runtime-api/package.json packages/agent-runtime-api/

RUN npm install -g @anthropic-ai/claude-code

RUN pnpm install --frozen-lockfile --filter agent-runtime

COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/agent-runtime/ packages/agent-runtime/

EXPOSE 8080

CMD ["pnpm", "--filter", "agent-runtime", "start"]
