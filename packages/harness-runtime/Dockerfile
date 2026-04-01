FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/harness-runtime/package.json packages/harness-runtime/

RUN npm install -g @anthropic-ai/claude-code

RUN pnpm install --frozen-lockfile --filter harness-runtime

COPY packages/harness-runtime/ packages/harness-runtime/

RUN mkdir -p packages/harness-runtime/working-dir

EXPOSE 3000

CMD ["pnpm", "--filter", "harness-runtime", "start"]
