FROM node:22-slim

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY dist/ dist/

RUN mkdir -p working-dir

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
