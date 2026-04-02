FROM node:22-slim

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY dist/ dist/

RUN mkdir -p working-dir

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/index.js"]
