ARG BASE_IMAGE=humr-base
FROM ${BASE_IMAGE}

RUN npm install -g @zed-industries/claude-code-acp
ENV AGENT_COMMAND=claude-code-acp

COPY workspace/ /app/working-dir/
