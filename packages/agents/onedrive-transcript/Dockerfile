ARG BASE_IMAGE=humr-base
FROM ${BASE_IMAGE}

# Claude Code harness + uv for running the Python VTT parser
RUN cd /app && npm install @agentclientprotocol/claude-agent-acp @anthropic-ai/claude-agent-sdk \
    && npm install -g @anthropic-ai/claude-code \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && ln -s /root/.local/bin/uv /usr/local/bin/uv

COPY workspace/ /app/working-dir/
