ARG BASE_IMAGE=humr-base
FROM ${BASE_IMAGE}

# Pi harness
RUN npm install -g @mariozechner/pi-coding-agent pi-acp @zhafron/pi-memory

ENV AGENT_COMMAND=pi-acp

COPY workspace/ /app/working-dir/
