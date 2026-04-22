ARG BASE_IMAGE=humr-base
FROM ${BASE_IMAGE}

# Pi harness
RUN npm install -g @mariozechner/pi-coding-agent pi-acp @zhafron/pi-memory

ENV AGENT_COMMAND=pi-acp

# pi-acp runs a pre-flight `hasAnyPiAuthConfigured()` check before spawning `pi`; if
# it fails, extensions never load. The check passes when any of a hardcoded list of
# provider env vars is present (OPENAI_API_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN,
# OPENCODE_API_KEY, etc. — see pi-acp/dist/index.js). We set a dummy OPENCODE_API_KEY
# because pi-coding-agent has no OpenCode provider built in, so the value is a pure
# gate-opener with no side-effects. The real RITS credential is injected by OneCLI on
# the wire, not resolved from env.
# Upstream: https://github.com/svkozak/pi-acp/issues/15
ENV OPENCODE_API_KEY=pi-acp-auth-gate-bypass

COPY workspace/ /app/working-dir/
