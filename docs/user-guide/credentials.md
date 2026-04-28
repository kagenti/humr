# Add Credentials

Your agent needs API keys to talk to model providers (Anthropic, OpenAI, etc.) and external services. Humr never gives the agent real keys — a credential proxy called **OneCLI** injects them automatically when the agent makes a request.

## How it works

Agents never hold your real API keys. Instead, all outbound traffic from the agent is routed through a credential proxy (OneCLI) that sits between the agent and the internet. When the agent makes an HTTPS request, the proxy intercepts it, checks whether the destination matches a credential you've configured, and if so, injects the real key into the request on the wire. The agent only ever holds a scoped access token that's useless outside the proxy — if the agent is compromised, there are no real keys to steal.

In practice:

1. You add your API key or OAuth token through the Humr UI.
2. When the agent makes an outbound request, the proxy swaps in the real credential — but only for destinations that match your configured host pattern.
3. Requests to destinations without a matching credential are rejected by the proxy.

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

For providers not yet listed in the UI (like custom OpenAI-compatible endpoints), you can add generic secrets through the **Connections** page in the Humr UI. Set the host pattern (and optionally a path pattern), the injection header, and grant it to your agent. The credential is only injected into requests that match the host and path pattern — requests to other destinations are unaffected.

## Limitations

The proxy protects your **keys** — it does not inspect the **content** of requests. If an agent is tricked by a malicious document into sending your data to a host you've granted access to, the proxy will forward it. This is an industry-wide unsolved problem. The best mitigation is to grant access to only the specific hosts your agent needs.

## Important

- **Never paste API keys into the chat window.** A compromised agent could exfiltrate them. Always use the Providers page.
- **Never bake keys into files in the agent's home directory.** The proxy can only protect keys it manages.
- **Credential changes take effect on restart.** Adding or removing a connection updates the agent's environment variables. The agent pod restarts automatically to pick up the change.
- **Grant the minimum hosts necessary.** The fewer outbound destinations your agent can reach, the smaller the surface for data exfiltration.
