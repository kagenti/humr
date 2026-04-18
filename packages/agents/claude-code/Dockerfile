ARG BASE_IMAGE=humr-base
FROM ${BASE_IMAGE}

# Claude Code harness
RUN cd /app && npm install @agentclientprotocol/claude-agent-acp @anthropic-ai/claude-agent-sdk \
    && npm install -g @anthropic-ai/claude-code

ENV CLAUDE_CODE_OAUTH_TOKEN=placeholder

COPY workspace/ /app/working-dir/
