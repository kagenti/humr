# Add Credentials

Your agent needs API keys to talk to model providers (Anthropic, OpenAI, etc.) and external services. Humr never gives the agent real keys — a credential proxy called **OneCLI** injects them automatically when the agent makes a request.

## How it works

1. You add your API key or OAuth token through the Humr UI.
2. When the agent makes an outbound request, the proxy swaps in the real credential — but only for allowed destinations.
3. The agent itself never sees the actual key. If the agent is compromised, there's nothing to steal.

## Add a provider key

1. Go to the **Providers** page in the Humr UI.
2. Pick your provider (e.g. **Anthropic**) and paste your API key or OAuth token.
3. Connect the credential to your agent under **Configure → Connections**.

For Anthropic, you can use either an **API key** (`sk-ant-api-…`) or an **OAuth token** (`sk-ant-oat-…`). To generate an OAuth token, run `claude setup-token` on your own machine with Claude Code installed.

## Connect credentials to an agent

Each agent has a **Connections** panel (open the agent → **Configure** → **Connections**). This is where you control which providers, secrets, and OAuth apps are available to that agent.

## OAuth connections

For services like GitHub or Google Workspace, use the **Connections** page in the Humr UI or the **Apps** section in the OneCLI dashboard. These use OAuth flows — you authorize once and the connection persists.

## Generic secrets

For providers not yet listed in the UI (like custom OpenAI-compatible endpoints), you can add credentials through the **OneCLI dashboard** as a generic secret. Set the host pattern, injection header, and grant it to your agent.

## Important

- **Never paste API keys into the chat window.** A compromised agent could exfiltrate them. Always use the Providers page or OneCLI.
- **Never bake keys into files in the agent's home directory.** The proxy can only protect keys it manages.
