import { describe, it, expect, vi } from "vitest";
import { createAcpRuntime } from "../../modules/acp/services/acp-runtime.js";
import type { AgentProcess } from "../../modules/acp/infrastructure/agent-process.js";
import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";

interface FakeAgent {
  agent: AgentProcess;
  pushLine(line: string): void;
  exit(): void;
  sent: unknown[];
  killed: () => boolean;
}

function makeFakeAgent(): FakeAgent {
  const handlers: ((line: string) => void)[] = [];
  let resolveExited: () => void = () => {};
  const exited = new Promise<void>((r) => { resolveExited = r; });
  const sent: unknown[] = [];
  let killedFlag = false;

  return {
    agent: {
      send(frame) { sent.push(frame); },
      onLine(h) { handlers.push(h); },
      kill() { killedFlag = true; resolveExited(); },
      exited,
    },
    pushLine(line) { for (const h of handlers) h(line); },
    exit() { resolveExited(); },
    sent,
    killed: () => killedFlag,
  };
}

interface FakeChannel {
  channel: ClientChannel;
  pushMessage(data: string): void;
  remoteClose(): void;
  sent: string[];
  closes: { code?: number; reason?: string }[];
  isOpen: () => boolean;
}

function makeFakeChannel(): FakeChannel {
  const msgHandlers: ((data: string) => void)[] = [];
  const closeHandlers: (() => void)[] = [];
  const sent: string[] = [];
  const closes: { code?: number; reason?: string }[] = [];
  let open = true;

  const close = (code?: number, reason?: string) => {
    if (!open) return;
    open = false;
    closes.push({ code, reason });
    for (const h of closeHandlers) h();
  };

  return {
    channel: {
      send(line) { if (open) sent.push(line); },
      close,
      isOpen() { return open; },
      onMessage(h) { msgHandlers.push(h); },
      onClose(h) { closeHandlers.push(h); },
    },
    pushMessage(data) { for (const h of msgHandlers) h(data); },
    remoteClose() { close(1006, "remote close"); },
    sent,
    closes,
    isOpen: () => open,
  };
}

const SID = "s1";
const OTHER_SID = "s2";

const newSessionRequest = (id: number) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "session/new", params: { cwd: "." } });

const newSessionResponse = (outboundId: number, sessionId = SID) =>
  JSON.stringify({ jsonrpc: "2.0", id: outboundId, result: { sessionId, modes: {}, models: {}, configOptions: [] } });

const resumeSessionRequest = (id: number, sessionId = SID) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "session/resume", params: { sessionId, cwd: "." } });

const listSessionsRequest = (id: number) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "session/list", params: {} });

const promptRequest = (id: number, sessionId = SID) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "session/prompt", params: { sessionId, prompt: [] } });

const permissionRequest = (id: number, sessionId = SID) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "session/request_permission",
    params: { sessionId, toolCall: { toolCallId: `tc-${id}` }, options: [] },
  });

const permissionResponse = (id: number) =>
  JSON.stringify({ jsonrpc: "2.0", id, result: { outcome: { outcome: "selected", optionId: "allow" } } });

const sessionUpdate = (sessionId = SID) =>
  JSON.stringify({ method: "session/update", params: { sessionId, update: { type: "message" } } });

const agentPromptResponse = (outboundId: number) =>
  JSON.stringify({ jsonrpc: "2.0", id: outboundId, result: { stopReason: "end_turn" } });

function outboundId(sentFrame: unknown): number {
  return (sentFrame as { id: number }).id;
}

describe("createAcpRuntime", () => {
  it("spawns the agent lazily on first attach", () => {
    let spawnCount = 0;
    const runtime = createAcpRuntime({
      spawnAgent: () => { spawnCount++; return makeFakeAgent().agent; },
      workingDir: "/tmp",
    });

    expect(spawnCount).toBe(0);
    expect(runtime.status().agentAlive).toBe(false);

    runtime.attach(makeFakeChannel().channel);
    expect(spawnCount).toBe(1);
    expect(runtime.status().agentAlive).toBe(true);
    expect(runtime.status().activeClientCount).toBe(1);
  });

  it("keeps the agent alive when a client disconnects", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.remoteClose();

    expect(fa.killed()).toBe(false);
    expect(runtime.status().agentAlive).toBe(true);
    expect(runtime.status().activeClientCount).toBe(0);
  });

  it("accepts multiple channels without evicting existing ones", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    expect(c1.isOpen()).toBe(true);
    expect(c2.isOpen()).toBe(true);
    expect(runtime.status().activeClientCount).toBe(2);
  });

  it("does not broadcast session traffic to a channel that hasn't engaged with that session", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const viewer = makeFakeChannel();
    const ops = makeFakeChannel();
    runtime.attach(viewer.channel);
    runtime.attach(ops.channel);

    // Only `viewer` engages with SID via a resume call.
    viewer.pushMessage(resumeSessionRequest(1));
    // `ops` calls `session/list` — no sessionId, no engagement.
    ops.pushMessage(listSessionsRequest(1));

    // Agent emits a permission request scoped to SID.
    fa.pushLine(permissionRequest(9));

    expect(viewer.sent.some((f) => JSON.parse(f).method === "session/request_permission")).toBe(true);
    expect(ops.sent.some((f) => JSON.parse(f).method === "session/request_permission")).toBe(false);
  });

  it("does not broadcast sessionUpdate notifications to a channel not engaged with the session", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const viewer = makeFakeChannel();
    const other = makeFakeChannel();
    runtime.attach(viewer.channel);
    runtime.attach(other.channel);

    viewer.pushMessage(resumeSessionRequest(1, SID));
    other.pushMessage(resumeSessionRequest(1, OTHER_SID));

    fa.pushLine(sessionUpdate(SID));

    expect(viewer.sent.some((f) => JSON.parse(f).params?.sessionId === SID)).toBe(true);
    expect(other.sent.some((f) => JSON.parse(f).params?.sessionId === SID)).toBe(false);
  });

  it("engages a channel with the sessionId returned by session/new's response", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(1));

    const sent = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sent));

    // Now the agent emits something scoped to the new session — channel
    // should receive it because the response engaged it.
    fa.pushLine(sessionUpdate(SID));
    expect(c.sent.some((f) => JSON.parse(f).method === "session/update")).toBe(true);
  });

  it("replays pending agent requests to a channel only at engagement time", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    // Attach first so the agent process is spawned and its onLine handler is
    // wired. The channel isn't engaged with any session yet.
    const c = makeFakeChannel();
    runtime.attach(c.channel);

    // Agent emits a permission request while no channel is engaged with SID.
    fa.pushLine(permissionRequest(7));

    // Attach alone must NOT replay — the channel hasn't opted into this session.
    expect(c.sent.some((f) => f === permissionRequest(7))).toBe(false);

    // Engage via resume.
    c.pushMessage(resumeSessionRequest(1));
    expect(c.sent.some((f) => f === permissionRequest(7))).toBe(true);
  });

  it("replays pending agent requests to every viewer that engages with the session", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    runtime.attach(c1.channel);
    c1.pushMessage(resumeSessionRequest(1));
    fa.pushLine(permissionRequest(9));
    expect(c1.sent).toContain(permissionRequest(9));

    const c2 = makeFakeChannel();
    runtime.attach(c2.channel);
    c2.pushMessage(resumeSessionRequest(1));
    expect(c2.sent).toContain(permissionRequest(9));
  });

  it("accepts the first response to a permission request and drops later duplicates", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);
    c1.pushMessage(resumeSessionRequest(1));
    c2.pushMessage(resumeSessionRequest(1));

    fa.pushLine(permissionRequest(7));

    const countBefore = fa.sent.length;
    c1.pushMessage(permissionResponse(7));
    expect(fa.sent.length).toBe(countBefore + 1);

    // A late response from c2 must not reach the agent again.
    c2.pushMessage(permissionResponse(7));
    expect(fa.sent.length).toBe(countBefore + 1);
  });

  it("rewrites client request ids so concurrent clients cannot collide at the agent", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(newSessionRequest(1));
    c2.pushMessage(newSessionRequest(1));

    expect(fa.sent).toHaveLength(2);
    const id1 = outboundId(fa.sent[0]);
    const id2 = outboundId(fa.sent[1]);
    expect(id1).not.toBe(id2);
  });

  it("translates agent responses back to the originating client's id", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(7));

    const sent = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sent));

    const forwarded = JSON.parse(c.sent.at(-1)!) as { id: number; result: { sessionId: string } };
    expect(forwarded.id).toBe(7);
    expect(forwarded.result.sessionId).toBe(SID);
  });

  it("forwards only the first prompt for a session and queues subsequent ones", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    c2.pushMessage(promptRequest(1));

    expect(fa.sent).toHaveLength(1);
    expect(runtime.status().queuedPromptCount).toBe(1);
  });

  it("advances the queue when the active prompt's response arrives", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    c2.pushMessage(promptRequest(1));

    const first = outboundId(fa.sent[0]);
    fa.pushLine(agentPromptResponse(first));

    expect(fa.sent).toHaveLength(2);
    expect(runtime.status().queuedPromptCount).toBe(0);
  });

  it("lets prompts for different sessions run in parallel", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    c.pushMessage(promptRequest(1, SID));
    c.pushMessage(promptRequest(2, OTHER_SID));

    expect(fa.sent).toHaveLength(2);
    expect(runtime.status().queuedPromptCount).toBe(0);
  });

  it("drops queued prompts owned by a disconnecting client", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    c2.pushMessage(promptRequest(1));
    expect(runtime.status().queuedPromptCount).toBe(1);

    c2.remoteClose();
    expect(runtime.status().queuedPromptCount).toBe(0);
  });

  it("still advances the queue if the client owning the active prompt disconnects mid-prompt", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    c2.pushMessage(promptRequest(1));

    c1.remoteClose();

    const first = outboundId(fa.sent[0]);
    fa.pushLine(agentPromptResponse(first));

    expect(fa.sent).toHaveLength(2);
    expect(runtime.status().queuedPromptCount).toBe(0);
  });

  it("rejects prompts beyond the per-session queue cap with a JSON-RPC error", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    // 1 active + 32 queued = 33 accepted.
    for (let i = 1; i <= 33; i++) c.pushMessage(promptRequest(i));
    expect(fa.sent).toHaveLength(1);
    expect(runtime.status().queuedPromptCount).toBe(32);

    c.pushMessage(promptRequest(34));
    const last = JSON.parse(c.sent.at(-1)!) as { id: number; error: { message: string } };
    expect(last.id).toBe(34);
    expect(last.error.message).toMatch(/queue full/);
    expect(fa.sent).toHaveLength(1);
  });

  it("drops client responses for ids that are not pending agent requests", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    c.pushMessage(JSON.stringify({ id: 999, result: { anything: true } }));
    expect(fa.sent).toHaveLength(0);
  });

  it("rewrites params.cwd on client frames before forwarding to the agent", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/pod/work" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(1));

    const sent = fa.sent[0] as { id: number; method: string; params: { cwd: string } };
    expect(sent.method).toBe("session/new");
    expect(sent.params.cwd).toBe("/pod/work");
  });

  it("drops non-JSON client messages and logs", () => {
    const fa = makeFakeAgent();
    const logs: string[] = [];
    const runtime = createAcpRuntime({
      spawnAgent: () => fa.agent,
      workingDir: "/tmp",
      log: (msg) => logs.push(msg),
    });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage("not-json");

    expect(fa.sent).toHaveLength(0);
    expect(logs.some((m) => m.includes("non-JSON"))).toBe(true);
  });

  it("does not auto-restart after the agent exits; subsequent attach closes the channel", async () => {
    const fa = makeFakeAgent();
    let spawnCount = 0;
    const runtime = createAcpRuntime({
      spawnAgent: () => { spawnCount++; return fa.agent; },
      workingDir: "/tmp",
    });

    const c1 = makeFakeChannel();
    runtime.attach(c1.channel);
    expect(spawnCount).toBe(1);

    fa.exit();
    await new Promise<void>((r) => setImmediate(r));
    expect(runtime.status().agentAlive).toBe(false);
    expect(c1.isOpen()).toBe(false);

    const c2 = makeFakeChannel();
    runtime.attach(c2.channel);
    expect(spawnCount).toBe(1);
    expect(c2.isOpen()).toBe(false);
    expect(c2.closes[0]).toMatchObject({ code: 1011 });
  });

  it("rewrites authentication_error text before forwarding to the client", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(resumeSessionRequest(1));

    fa.pushLine(JSON.stringify({
      method: "session/update",
      params: { sessionId: SID, update: { content: { type: "text", text: "authentication_error: missing" } } },
    }));

    const forwarded = JSON.parse(c.sent.at(-1)!);
    expect(forwarded.params.update.content.text).toMatch(/Authentication Error:/);
  });

  it("expires a session's pending agent requests after the orphan TTL with no engaged channel", () => {
    vi.useFakeTimers();
    try {
      const fa = makeFakeAgent();
      const runtime = createAcpRuntime({
        spawnAgent: () => fa.agent,
        workingDir: "/tmp",
        orphanTtlMs: 100,
      });

      const c = makeFakeChannel();
      runtime.attach(c.channel);
      c.pushMessage(resumeSessionRequest(1));

      fa.pushLine(permissionRequest(5));
      expect(runtime.status().pendingRequestCount).toBe(1);

      c.remoteClose();

      vi.advanceTimersByTime(99);
      expect(fa.sent.some((f) => (f as { error?: unknown }).error)).toBe(false);

      vi.advanceTimersByTime(2);
      const errorSent = fa.sent.find((f) => (f as { error?: unknown }).error);
      expect(errorSent).toBeDefined();
      expect((errorSent as { id: number }).id).toBe(5);
      expect(runtime.status().pendingRequestCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the orphan timer when a viewer engages with the session within the TTL window", () => {
    vi.useFakeTimers();
    try {
      const fa = makeFakeAgent();
      const runtime = createAcpRuntime({
        spawnAgent: () => fa.agent,
        workingDir: "/tmp",
        orphanTtlMs: 100,
      });

      const c1 = makeFakeChannel();
      runtime.attach(c1.channel);
      c1.pushMessage(resumeSessionRequest(1));
      fa.pushLine(permissionRequest(7));
      c1.remoteClose();

      vi.advanceTimersByTime(50);
      const c2 = makeFakeChannel();
      runtime.attach(c2.channel);
      c2.pushMessage(resumeSessionRequest(1));

      vi.advanceTimersByTime(200);
      expect(fa.sent.some((f) => (f as { error?: unknown }).error)).toBe(false);
      expect(runtime.status().pendingRequestCount).toBe(1);
      expect(c2.sent).toContain(permissionRequest(7));
    } finally {
      vi.useRealTimers();
    }
  });

  it("a channel that only calls listSessions never engages and cannot consume a pending request", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const viewer = makeFakeChannel();
    runtime.attach(viewer.channel);
    viewer.pushMessage(resumeSessionRequest(1));
    fa.pushLine(permissionRequest(3));
    expect(viewer.sent).toContain(permissionRequest(3));
    expect(runtime.status().pendingRequestCount).toBe(1);

    // An operational call arrives on a separate channel — list sessions and go.
    const ops = makeFakeChannel();
    runtime.attach(ops.channel);
    ops.pushMessage(listSessionsRequest(1));

    // listSessions client did not receive the permission prompt.
    expect(ops.sent.some((f) => f === permissionRequest(3))).toBe(false);

    // Even if it naively responded with a bogus outcome using the pending id,
    // we'd still keep the pending (it didn't engage, so nothing was replayed);
    // the "answer" would be a response from a channel that never asked. Verify
    // the pending is still there and the agent hasn't been notified.
    const before = fa.sent.length;
    ops.remoteClose();
    expect(runtime.status().pendingRequestCount).toBe(1);
    expect(fa.sent).toHaveLength(before);
  });

  it("broadcasts a humr/turnEnded notification to engaged channels when a prompt completes", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    // c2 is engaged with SID (not via prompt, but would be via resume in a
    // real viewer). Engage explicitly.
    c2.pushMessage(resumeSessionRequest(2));

    const outbound = outboundId(fa.sent[0]);
    fa.pushLine(agentPromptResponse(outbound));

    // Both engaged channels see the turn-ended notification.
    const turnEnded = (sent: string[]) => sent.find((f) => {
      try { return JSON.parse(f).method === "humr/turnEnded"; } catch { return false; }
    });
    expect(turnEnded(c1.sent)).toBeDefined();
    expect(turnEnded(c2.sent)).toBeDefined();
  });

  it("does not broadcast humr/turnEnded to channels not engaged with the session", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(promptRequest(1));
    // c2 only runs listSessions and never engages with a session.
    c2.pushMessage(listSessionsRequest(2));

    const outbound = outboundId(fa.sent[0]);
    fa.pushLine(agentPromptResponse(outbound));

    const turnEnded = c2.sent.find((f) => {
      try { return JSON.parse(f).method === "humr/turnEnded"; } catch { return false; }
    });
    expect(turnEnded).toBeUndefined();
  });

  it("shutdown closes every attached channel and kills the agent", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    runtime.shutdown();
    expect(c1.isOpen()).toBe(false);
    expect(c2.isOpen()).toBe(false);
    expect(fa.killed()).toBe(true);
  });

  it("closes the SDK session after a turn ends with no engaged channels", () => {
    // Scheduled trigger scenario: a prompt fires and completes with nobody
    // watching the session. The claude subprocess the SDK spawned should be
    // reaped via `session/close` to avoid unbounded memory growth.
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);

    // Open a session and send a prompt.
    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sessOut));
    c.pushMessage(promptRequest(2));
    const promptOut = outboundId(fa.sent[1]);

    // Viewer disconnects before the response arrives.
    c.remoteClose();
    expect(fa.sent.filter((f: any) => f.method === "session/close")).toHaveLength(0);

    // Turn ends — nobody's watching, nothing pending → close.
    fa.pushLine(agentPromptResponse(promptOut));
    const closeFrames = fa.sent.filter((f: any) => f.method === "session/close");
    expect(closeFrames).toHaveLength(1);
    expect((closeFrames[0] as any).params).toEqual({ sessionId: SID });
  });

  it("does not close the session while a viewer is still engaged", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sessOut));
    c.pushMessage(promptRequest(2));
    const promptOut = outboundId(fa.sent[1]);
    fa.pushLine(agentPromptResponse(promptOut));

    expect(fa.sent.filter((f: any) => f.method === "session/close")).toHaveLength(0);
  });

  it("closes the SDK session when the last engaged channel detaches", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sessOut));
    // Session is idle (no prompt in flight). Viewer leaves → reap.
    c.remoteClose();

    const closeFrames = fa.sent.filter((f: any) => f.method === "session/close");
    expect(closeFrames).toHaveLength(1);
    expect((closeFrames[0] as any).params).toEqual({ sessionId: SID });
  });

  it("does not close a session with pending permission requests", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    const c = makeFakeChannel();
    runtime.attach(c.channel);
    c.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sessOut));

    // Agent asks for permission. Viewer closes before answering.
    fa.pushLine(permissionRequest(7));
    c.remoteClose();

    // Session has a pending request — must stay open for whoever answers
    // next (reconnect, another viewer). The 10-min orphan TTL will reject
    // the request if nobody comes back.
    expect(fa.sent.filter((f: any) => f.method === "session/close")).toHaveLength(0);
  });

  it("does not close a session while a queued prompt is waiting", () => {
    const fa = makeFakeAgent();
    const runtime = createAcpRuntime({ spawnAgent: () => fa.agent, workingDir: "/tmp" });

    // Two engaged channels: c1 sends the active prompt, c2 queues one.
    // When c1 detaches its active prompt stays (we null its channel) but
    // c2's queued prompt is still waiting, so when the active prompt's
    // response comes back, advanceQueue promotes c2's. Session stays busy
    // and must not be closed.
    const c1 = makeFakeChannel();
    const c2 = makeFakeChannel();
    runtime.attach(c1.channel);
    runtime.attach(c2.channel);

    c1.pushMessage(newSessionRequest(1));
    const sessOut = outboundId(fa.sent[0]);
    fa.pushLine(newSessionResponse(sessOut));
    // Engage c2 with the same session via a prompt (forward engages it).
    c2.pushMessage(promptRequest(10));  // c2 is first — its prompt is active
    const firstOut = outboundId(fa.sent[1]);
    c1.pushMessage(promptRequest(11));  // c1's prompt gets queued

    // c2 leaves. Its active prompt's channel is nulled (still active slot).
    c2.remoteClose();
    fa.pushLine(agentPromptResponse(firstOut));

    // c1's queued prompt was promoted; session is busy, not idle.
    expect(fa.sent.filter((f: any) => f.method === "session/close")).toHaveLength(0);
  });
});
