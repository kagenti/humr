ARG BASE_IMAGE=humr-base
FROM ${BASE_IMAGE}

RUN npm install -g @zed-industries/codex-acp
ENV AGENT_COMMAND=codex-acp

COPY workspace/ /app/working-dir/
