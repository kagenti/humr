# Debug Mode

**As a** user, **I want to** see ACP traffic and token usage on agent responses **so that** I can diagnose issues and understand agent behavior.

## Screen(s)

- S-03b: Chat Tab (debug footer + ACP panel)

## Layout

Toggle: bug icon in chat toolbar (top right). When active, two debug features are enabled:

### Per-message token usage

Each agent response message shows a compact debug line below the message content:

- Token usage (input/output)

### ACP message log (expandable panel)

A collapsible panel at the bottom of the chat area showing raw ACP WebSocket traffic:

| Element | Description |
|---------|-------------|
| Header | "ACP Messages" label + collapse/expand toggle |
| Message list | Scrollable, newest at bottom. Each entry: timestamp, direction arrow (-> outbound, <- inbound), message type, truncated payload |
| Click entry | Expands to show full JSON payload |

### Styling

- `$bg-secondary` background
- Monospace font (12px)
- Muted text color
- Token line separated from message content by a thin border

## Interactions

- Click bug icon in chat toolbar to toggle debug mode on/off
- When debug is on: token usage appears below each agent message
- When debug is on: ACP panel is visible at the bottom of the chat area
- Click ACP message entry to expand/collapse full payload

## States

- **Debug off (default):** No debug info visible. Bug icon is inactive.
- **Debug on:** Token usage shown per message, ACP panel visible. Bug icon is active (highlighted).
- **ACP panel expanded:** Shows scrolling message log.
- **ACP panel collapsed:** Thin bar with "ACP Messages" label.

## Scenario: Debug Agent Behavior

1. Agent responding slowly. Click bug icon in chat toolbar to enable debug mode.
2. Send a message: "What's the latest security report?"
3. Agent responds. Below the response, token usage: "Tokens: 1,247 in / 523 out"
4. Check ACP panel at bottom: see the raw WebSocket messages exchanged between UI and agent.
5. Spot an unexpected large payload in the ACP log. Expand to view full JSON.

## Acceptance Criteria

- [ ] Bug icon in chat toolbar toggles debug mode
- [ ] Debug mode is off by default
- [ ] When enabled, every agent response shows token usage (in/out)
- [ ] ACP message log panel appears at the bottom of chat area
- [ ] ACP messages show timestamp, direction, type, and truncated payload
- [ ] Clicking an ACP message expands to show full JSON payload
- [ ] Token usage uses monospace font, muted text, secondary background
- [ ] Toggling debug mode off hides all debug info and ACP panel
