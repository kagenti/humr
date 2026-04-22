import { describe, it, expect, beforeEach } from "vitest";
import { ChannelType } from "api-server-api";
import { EventType, emit, type ForkFailed, type ForkReady } from "../../events.js";
import { startOnForkReadySaga } from "../../modules/channels/sagas/on-fork-ready.js";
import { startOnForkFailedSaga } from "../../modules/channels/sagas/on-fork-failed.js";
import type { SlackWorker } from "../../modules/channels/infrastructure/slack.js";

function makeWorker(): {
  worker: SlackWorker;
  readyCalls: ForkReady[];
  failedCalls: ForkFailed[];
} {
  const readyCalls: ForkReady[] = [];
  const failedCalls: ForkFailed[] = [];
  const worker: SlackWorker = {
    type: ChannelType.Slack,
    async start() {},
    async stop() {},
    async stopAll() {},
    async postMessage() {
      return { ok: true as const };
    },
    async onForkReady(event) {
      readyCalls.push(event);
    },
    async onForkFailed(event) {
      failedCalls.push(event);
    },
  };
  return { worker, readyCalls, failedCalls };
}

async function drain(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("channels/on-fork-ready saga", () => {
  let harness: ReturnType<typeof makeWorker>;
  let sub: { unsubscribe: () => void };

  beforeEach(() => {
    harness = makeWorker();
    sub = startOnForkReadySaga(harness.worker);
  });

  it("delegates ForkReady events to the worker", async () => {
    emit({
      type: EventType.ForkReady,
      forkId: "fork-1",
      replyId: "reply-1",
      podIP: "10.42.0.5",
    });
    await drain();

    expect(harness.readyCalls).toEqual([
      { type: EventType.ForkReady, forkId: "fork-1", replyId: "reply-1", podIP: "10.42.0.5" },
    ]);
    sub.unsubscribe();
  });

  it("ignores unrelated events", async () => {
    emit({ type: EventType.ForkFailed, forkId: "fork-2", replyId: "r", reason: "Timeout" });
    emit({ type: EventType.InstanceDeleted, instanceId: "inst-1" });
    await drain();

    expect(harness.readyCalls).toEqual([]);
    sub.unsubscribe();
  });

  it("does not rethrow when worker throws", async () => {
    const failing: SlackWorker = {
      ...harness.worker,
      async onForkReady() {
        throw new Error("boom");
      },
    };
    const s = startOnForkReadySaga(failing);

    expect(() =>
      emit({
        type: EventType.ForkReady,
        forkId: "fork-3",
        replyId: "reply-3",
        podIP: "10.42.0.9",
      }),
    ).not.toThrow();
    await drain();
    s.unsubscribe();
    sub.unsubscribe();
  });
});

describe("channels/on-fork-failed saga", () => {
  let harness: ReturnType<typeof makeWorker>;
  let sub: { unsubscribe: () => void };

  beforeEach(() => {
    harness = makeWorker();
    sub = startOnForkFailedSaga(harness.worker);
  });

  it("delegates ForkFailed events to the worker", async () => {
    emit({
      type: EventType.ForkFailed,
      forkId: "fork-9",
      replyId: "reply-9",
      reason: "CredentialMintFailed",
      detail: "keycloak 401",
    });
    await drain();

    expect(harness.failedCalls).toEqual([
      {
        type: EventType.ForkFailed,
        forkId: "fork-9",
        replyId: "reply-9",
        reason: "CredentialMintFailed",
        detail: "keycloak 401",
      },
    ]);
    sub.unsubscribe();
  });

  it("ignores unrelated events", async () => {
    emit({ type: EventType.ForkReady, forkId: "f", replyId: "r", podIP: "1.2.3.4" });
    await drain();

    expect(harness.failedCalls).toEqual([]);
    sub.unsubscribe();
  });
});
