import { isRequest, isResponse, parseFrame, type JsonRpcId } from "../domain/frames.js";
import type { AgentProcess } from "../infrastructure/agent-process.js";
import type { ClientChannel } from "../infrastructure/client-channel.js";
import { rewriteAuthError, rewriteCwd } from "../infrastructure/mappers.js";

/** Maximum prompts queued per session before we reject with an error. */
const PROMPT_QUEUE_CAP = 32;

/**
 * How long an agent→client request for a session can sit pending with no
 * channel engaged with that session before we give up and reject it back to
 * the agent. Keeps the buffer bounded on long-lived unattended sessions, and
 * gives the agent a clean error it can surface instead of hanging until
 * something inside its SDK times out.
 */
const DEFAULT_ORPHAN_TTL_MS = 10 * 60 * 1000;

export interface AcpRuntimeStatus {
  activeClientCount: number;
  pendingRequestCount: number;
  queuedPromptCount: number;
  agentAlive: boolean;
}

export interface AcpRuntime {
  /**
   * Attach a channel. Multiple channels may be attached at once. Attachment
   * alone does not subscribe the channel to any session's traffic: a channel
   * only receives updates and agent-initiated requests for sessions it has
   * **engaged** with, where engagement is driven implicitly by ACP frames:
   *
   * - sending a request or notification with `params.sessionId`
   *   (prompt, load, resume, cancel, set_mode, ...) engages that session;
   * - receiving a response whose `result.sessionId` creates or identifies a
   *   session (new, fork, load, resume) engages it too.
   *
   * A cross-session call like `listSessions` carries no sessionId and never
   * engages — such channels can do their RPC round-trip without ever seeing
   * another session's permission prompts or updates.
   */
  attach(channel: ClientChannel): void;
  status(): AcpRuntimeStatus;
  shutdown(): void;
}

export interface AcpRuntimeDeps {
  spawnAgent: () => AgentProcess;
  workingDir: string;
  log?: (msg: string) => void;
  /** Override the orphan TTL — exposed for tests; production defaults to 10 min. */
  orphanTtlMs?: number;
}

interface ActivePrompt {
  sessionId: string;
  outboundId: number;
  /** Null if the owning channel disconnected while the prompt was active. */
  channel: ClientChannel | null;
  originalId: JsonRpcId;
}

interface QueuedPrompt {
  channel: ClientChannel;
  outboundId: number;
  originalId: JsonRpcId;
  /** Rewritten frame ready to forward to the agent. */
  frame: unknown;
}

interface OutboundMapping {
  channel: ClientChannel;
  originalId: JsonRpcId;
  /** The method that originated this outbound id, so we can engage the channel
   * with a session returned in the response (e.g. `session/new` result). */
  method: string;
  /** Non-null when this outbound id was allocated for a session/prompt so the
   * queue advances when the response comes back. */
  promptSessionId: string | null;
}

interface PendingAgentRequest {
  /** The session this request is scoped to (from params.sessionId). Null
   * means the request has no session scope — rare but possible. */
  sessionId: string | null;
  frame: string;
}

export function createAcpRuntime(deps: AcpRuntimeDeps): AcpRuntime {
  const orphanTtlMs = deps.orphanTtlMs ?? DEFAULT_ORPHAN_TTL_MS;
  let agent: AgentProcess | null = null;
  let agentExited = false;
  /**
   * Every attached channel → set of sessions it is engaged with. Used both
   * as the source of truth for "who's attached" (Map.size) and to decide
   * which channels receive scoped broadcasts.
   */
  const engagedSessions = new Map<ClientChannel, Set<string>>();
  const pendingFromAgent = new Map<JsonRpcId, PendingAgentRequest>();
  const outboundIdToClient = new Map<number, OutboundMapping>();
  const activePromptBySession = new Map<string, ActivePrompt>();
  const promptQueueBySession = new Map<string, QueuedPrompt[]>();
  let nextOutboundId = 1;
  /** Per-session orphan timers. A session is orphaned when it has pending
   * agent-initiated requests but no channel engaged with it. */
  const orphanTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ── Engagement ──

  function engage(channel: ClientChannel, sessionId: string): void {
    const sessions = engagedSessions.get(channel);
    if (!sessions) return; // channel detached
    if (sessions.has(sessionId)) return; // idempotent
    sessions.add(sessionId);

    // Replay any pending agent→client requests for this session to the
    // newly-engaged channel. A fresh viewer joining an in-progress prompt
    // picks up the permission dialog right away.
    for (const req of pendingFromAgent.values()) {
      if (req.sessionId === sessionId && channel.isOpen()) {
        channel.send(rewriteAuthError(req.frame));
      }
    }

    updateOrphanTimerForSession(sessionId);
  }

  function hasEngagedChannel(sessionId: string): boolean {
    for (const [channel, sessions] of engagedSessions) {
      if (sessions.has(sessionId) && channel.isOpen()) return true;
    }
    return false;
  }

  // ── Broadcast ──

  function broadcastToSession(sessionId: string, line: string): void {
    const out = rewriteAuthError(line);
    for (const [channel, sessions] of engagedSessions) {
      if (sessions.has(sessionId) && channel.isOpen()) channel.send(out);
    }
  }

  function broadcastToAll(line: string): void {
    const out = rewriteAuthError(line);
    for (const channel of engagedSessions.keys()) {
      if (channel.isOpen()) channel.send(out);
    }
  }

  function sendToChannel(c: ClientChannel, line: string): void {
    if (c.isOpen()) c.send(line);
  }

  // ── Per-session orphan TTL ──

  function updateOrphanTimerForSession(sessionId: string): void {
    const engaged = hasEngagedChannel(sessionId);
    let hasPending = false;
    for (const req of pendingFromAgent.values()) {
      if (req.sessionId === sessionId) { hasPending = true; break; }
    }
    const existing = orphanTimers.get(sessionId);
    const shouldRun = hasPending && !engaged && !agentExited;
    if (shouldRun && !existing) {
      orphanTimers.set(sessionId, setTimeout(() => expireSession(sessionId), orphanTtlMs));
    } else if (!shouldRun && existing) {
      clearTimeout(existing);
      orphanTimers.delete(sessionId);
    }
  }

  function expireSession(sessionId: string): void {
    orphanTimers.delete(sessionId);
    if (!agent || agentExited) return;
    const toExpire: JsonRpcId[] = [];
    for (const [id, req] of pendingFromAgent) {
      if (req.sessionId === sessionId) toExpire.push(id);
    }
    for (const id of toExpire) {
      // Respond to the agent-side pending JSON-RPC call so it gets a clean
      // error instead of waiting until the Claude Code SDK times out.
      agent.send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: "Permission request expired: no client connected",
        },
      });
      pendingFromAgent.delete(id);
    }
  }

  // ── Agent lifecycle ──

  function ensureAgent(): AgentProcess | null {
    if (agent && !agentExited) return agent;
    if (agentExited) return null;

    const a = deps.spawnAgent();
    agent = a;
    a.onLine(handleAgentLine);
    a.exited.then(() => {
      agentExited = true;
      for (const channel of engagedSessions.keys()) {
        channel.close(1011, "agent exited");
      }
      engagedSessions.clear();
      for (const t of orphanTimers.values()) clearTimeout(t);
      orphanTimers.clear();
      pendingFromAgent.clear();
    });
    return a;
  }

  // ── Channel lifecycle ──

  function detach(channel: ClientChannel): void {
    const sessions = engagedSessions.get(channel);
    engagedSessions.delete(channel);

    // Drop any prompts this channel had queued but not yet sent to the agent.
    for (const [sid, queue] of promptQueueBySession) {
      const kept = queue.filter((q) => q.channel !== channel);
      if (kept.length) promptQueueBySession.set(sid, kept);
      else promptQueueBySession.delete(sid);
    }

    // If this channel owns the currently active prompt, leave the slot occupied
    // but null the channel — the agent is still working on it and we need its
    // response to advance the queue. We just won't forward the response anywhere.
    for (const active of activePromptBySession.values()) {
      if (active.channel === channel) active.channel = null;
    }

    // Drop outbound mappings for non-prompt requests this channel initiated;
    // their responses will be silently discarded if they arrive.
    for (const [outId, m] of outboundIdToClient) {
      if (m.channel === channel && m.promptSessionId === null) {
        outboundIdToClient.delete(outId);
      }
    }

    // Any session this channel was engaged with might now be orphaned.
    // Update the pending-request TTL timer and, if the session has nothing
    // keeping it alive, reap its SDK session so the claude CLI subprocess
    // is freed.
    if (sessions) {
      for (const sid of sessions) {
        updateOrphanTimerForSession(sid);
        maybeCloseIdleSession(sid);
      }
    }
  }

  /**
   * Close an SDK session when nothing is keeping it alive. Each open session
   * pins a `claude` CLI subprocess (~300MB RSS) inside the agent pod; leaving
   * them open after viewers leave accumulates until the pod OOMs.
   *
   * "Idle" means: no channel engaged with the session, no active or queued
   * prompts, no agent→client requests still pending (permission prompts).
   * The SDK respawns the subprocess on the next resume/load, so closing is
   * safe — we just trade memory for a brief cold-start when a viewer returns.
   *
   * Fire-and-forget: we don't register the outbound id, so the agent's
   * response is silently dropped by `handleAgentLine`.
   */
  function maybeCloseIdleSession(sessionId: string): void {
    if (!agent || agentExited) return;
    if (hasEngagedChannel(sessionId)) return;
    if (activePromptBySession.has(sessionId)) return;
    if (promptQueueBySession.has(sessionId)) return;
    for (const req of pendingFromAgent.values()) {
      if (req.sessionId === sessionId) return;
    }

    const id = nextOutboundId++;
    agent.send({
      jsonrpc: "2.0",
      id,
      method: "session/close",
      params: { sessionId },
    });
    deps.log?.(`closing idle session ${sessionId}`);
  }

  function sendErrorResponse(channel: ClientChannel, id: JsonRpcId, message: string): void {
    sendToChannel(channel, JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }));
  }

  // ── Prompt queue ──

  function forwardPromptToAgent(
    a: AgentProcess,
    sessionId: string,
    entry: { channel: ClientChannel; outboundId: number; originalId: JsonRpcId; frame: unknown },
  ): void {
    activePromptBySession.set(sessionId, {
      sessionId,
      outboundId: entry.outboundId,
      channel: entry.channel,
      originalId: entry.originalId,
    });
    a.send(entry.frame);
  }

  function advanceQueue(a: AgentProcess, sessionId: string): void {
    const queue = promptQueueBySession.get(sessionId);
    if (!queue || queue.length === 0) {
      promptQueueBySession.delete(sessionId);
      return;
    }
    const next = queue.shift()!;
    if (queue.length === 0) promptQueueBySession.delete(sessionId);
    forwardPromptToAgent(a, sessionId, next);
  }

  // ── Agent → client traffic ──

  function handleAgentLine(line: string): void {
    const frame = parseFrame(line);

    if (frame && isRequest(frame)) {
      const sessionId = extractParamsSessionId(frame);
      pendingFromAgent.set(frame.id, { sessionId, frame: line });
      if (sessionId) {
        broadcastToSession(sessionId, line);
        updateOrphanTimerForSession(sessionId);
      } else {
        broadcastToAll(line);
      }
      return;
    }

    if (frame && isResponse(frame)) {
      const outboundId = frame.id as number;
      const mapping = outboundIdToClient.get(outboundId);
      if (mapping) {
        outboundIdToClient.delete(outboundId);

        // Engage the originating channel with a session returned in the
        // result. Covers session/new (new sid), session/fork (new sid), and
        // is a harmless no-op for session/load and session/resume (client
        // already engaged on forward).
        const resultSid = extractResultSessionId(frame);
        if (resultSid) engage(mapping.channel, resultSid);

        // Rewrite the response id back to what the originating client used.
        const out = JSON.stringify({ ...(frame as object), id: mapping.originalId });
        if (mapping.channel.isOpen()) mapping.channel.send(rewriteAuthError(out));

        // If this response completes a queued prompt, advance the session's
        // queue and signal the turn boundary to every engaged channel so
        // viewers that didn't originate the prompt can close their current
        // assistant bubble. ACP has no on-the-wire "turn ended" notification,
        // so we send a custom JSON-RPC notification — the originating client
        // doesn't need it (its sendPrompt finally fires from the response),
        // but other viewers do. Clients that don't implement extNotification
        // silently swallow it.
        if (mapping.promptSessionId !== null) {
          const sid = mapping.promptSessionId;
          const active = activePromptBySession.get(sid);
          if (active && active.outboundId === outboundId) {
            activePromptBySession.delete(sid);
            if (agent && !agentExited) advanceQueue(agent, sid);
          }
          broadcastToSession(sid, JSON.stringify({
            jsonrpc: "2.0",
            method: "humr/turnEnded",
            params: { sessionId: sid },
          }));
          // Reap the SDK session if the turn finished with nothing left to
          // watch it — e.g. a scheduled trigger fired a prompt with no UI
          // attached. If a queued prompt was just promoted by advanceQueue,
          // activePromptBySession now has it and maybeCloseIdleSession is a
          // no-op.
          maybeCloseIdleSession(sid);
        }
      }
      return;
    }

    // Notification — scope by sessionId when present; otherwise broadcast.
    const sessionId = extractParamsSessionId(frame);
    if (sessionId) broadcastToSession(sessionId, line);
    else broadcastToAll(line);
  }

  // ── Client → agent traffic ──

  function handleClientMessage(a: AgentProcess, channel: ClientChannel, data: string): void {
    const frame = parseFrame(data);
    if (!frame) {
      deps.log?.(`dropping non-JSON client message: ${data}`);
      return;
    }

    if (isResponse(frame)) {
      // Client responding to an agent-initiated request. Only forward if the
      // request is still pending — late/duplicate responses (other client
      // already answered) are silently dropped so the agent isn't confused.
      const pending = pendingFromAgent.get(frame.id);
      if (!pending) return;
      pendingFromAgent.delete(frame.id);
      if (pending.sessionId) updateOrphanTimerForSession(pending.sessionId);
      a.send(frame);
      return;
    }

    if (isRequest(frame)) {
      const outboundId = nextOutboundId++;
      const method = typeof (frame as { method?: unknown }).method === "string"
        ? (frame as { method: string }).method
        : "";
      const paramsSid = extractParamsSessionId(frame);

      // Engage forward so subsequent updates for this session reach this channel.
      if (paramsSid) engage(channel, paramsSid);

      const promptSessionId = method === "session/prompt" ? paramsSid : null;
      const rewritten = rewriteCwd({ ...frame, id: outboundId }, deps.workingDir);
      outboundIdToClient.set(outboundId, {
        channel,
        originalId: frame.id,
        method,
        promptSessionId,
      });

      if (promptSessionId !== null) {
        if (activePromptBySession.has(promptSessionId)) {
          const queue = promptQueueBySession.get(promptSessionId) ?? [];
          if (queue.length >= PROMPT_QUEUE_CAP) {
            outboundIdToClient.delete(outboundId);
            sendErrorResponse(channel, frame.id, `prompt queue full for session ${promptSessionId}`);
            return;
          }
          queue.push({ channel, outboundId, originalId: frame.id, frame: rewritten });
          promptQueueBySession.set(promptSessionId, queue);
          return;
        }
        forwardPromptToAgent(a, promptSessionId, { channel, outboundId, originalId: frame.id, frame: rewritten });
        return;
      }

      a.send(rewritten);
      return;
    }

    // Client notification (has method, no id). Forward; engage if scoped.
    const notifSid = extractParamsSessionId(frame);
    if (notifSid) engage(channel, notifSid);
    a.send(rewriteCwd(frame, deps.workingDir));
  }

  return {
    attach(channel) {
      const a = ensureAgent();
      if (!a) {
        channel.close(1011, "agent process is not running");
        return;
      }

      engagedSessions.set(channel, new Set());

      channel.onMessage((data) => handleClientMessage(a, channel, data));
      channel.onClose(() => detach(channel));
    },

    status() {
      let queued = 0;
      for (const q of promptQueueBySession.values()) queued += q.length;
      return {
        activeClientCount: engagedSessions.size,
        pendingRequestCount: pendingFromAgent.size,
        queuedPromptCount: queued,
        agentAlive: agent !== null && !agentExited,
      };
    },

    shutdown() {
      for (const channel of engagedSessions.keys()) channel.close(1000, "shutdown");
      engagedSessions.clear();
      for (const t of orphanTimers.values()) clearTimeout(t);
      orphanTimers.clear();
      if (agent && !agentExited) agent.kill();
    },
  };
}

function extractParamsSessionId(frame: unknown): string | null {
  if (typeof frame !== "object" || frame === null) return null;
  const f = frame as { params?: unknown };
  if (typeof f.params !== "object" || f.params === null) return null;
  const sid = (f.params as { sessionId?: unknown }).sessionId;
  return typeof sid === "string" ? sid : null;
}

function extractResultSessionId(frame: unknown): string | null {
  if (typeof frame !== "object" || frame === null) return null;
  const f = frame as { result?: unknown };
  if (typeof f.result !== "object" || f.result === null) return null;
  const sid = (f.result as { sessionId?: unknown }).sessionId;
  return typeof sid === "string" ? sid : null;
}
