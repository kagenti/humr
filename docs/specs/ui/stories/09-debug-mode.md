# Debug Mode

**As a** user, **I want to** see token usage, latency, tool calls, and model info on agent responses **so that** I can diagnose performance issues and understand agent behavior.

## Screen(s)

- S-03b: Chat Tab (debug footer)

## Layout

Toggle: bug icon in chat toolbar (top right). When active, each agent response message shows a collapsible debug footer below the message content.

### Debug footer content

- Token usage (input/output)
- Latency (total + time-to-first-token)
- Tool calls (name, duration, status)
- Model identifier

### Styling

- `$bg-secondary` background
- Monospace font (12px)
- Muted text color
- Separated from message content by a thin border
- Per-message, independently expandable

## Interactions

- Click bug icon in chat toolbar to toggle debug mode on/off
- Click on individual debug footers to expand/collapse

## States

- **Debug off (default):** No debug footers visible. Bug icon is inactive.
- **Debug on:** Every agent response shows a collapsible debug footer. Bug icon is active (highlighted).
- **Footer expanded:** Shows all debug metrics.
- **Footer collapsed:** Shows nothing (just the thin border separator).

## Scenario: Use Debug Mode

1. Testing agent behavior. Click bug icon in chat toolbar to enable debug mode.
2. Send a message: "What's the latest security report?"
3. Agent responds. Below the response, a collapsible debug footer appears.
4. Expand debug footer: "Tokens: 1,247 in / 523 out | Latency: 2.3s (TTFT: 340ms) | Tools: workspace_read (0.2s), memory_search (1.1s) | Model: claude-sonnet-4-20250514"
5. Diagnose: memory_search is the bottleneck. Adjust memory structure.

## Acceptance Criteria

- [ ] Bug icon in chat toolbar toggles debug mode
- [ ] Debug mode is off by default
- [ ] When enabled, every agent response shows a collapsible debug footer
- [ ] Debug footer displays token usage (in/out)
- [ ] Debug footer displays latency (total + TTFT)
- [ ] Debug footer displays tool calls with name, duration, and status
- [ ] Debug footer displays model identifier
- [ ] Each debug footer is independently expandable/collapsible
- [ ] Debug footer uses monospace font, muted text, secondary background
- [ ] Toggling debug mode off hides all debug footers
