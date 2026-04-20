ARG BASE_IMAGE=humr-base
FROM ${BASE_IMAGE}

# Pi harness
RUN npm install -g @mariozechner/pi-coding-agent pi-acp @zhafron/pi-memory

# Local pi extensions (RITS provider registration from env)
COPY extension/ /opt/pi-rits/
RUN npm install -g /opt/pi-rits

ENV AGENT_COMMAND=pi-acp

COPY workspace/ /app/working-dir/
