import type { PodFilesEvent } from "./types.js";

/**
 * In-memory pub/sub for pod-files updates, keyed by agent name. OneCLI
 * grants are agent-scoped, so every running instance of the same agent
 * shares one topic. Single api-server replica is the deployment baseline —
 * see DRAFT-connector-files-push for the multi-replica path.
 */
export interface PodFilesBus {
  subscribe(
    agentName: string,
    cb: (e: { kind: "snapshot" | "upsert" } & PodFilesEvent) => void,
  ): () => void;
  publish(
    agentName: string,
    e: { kind: "snapshot" | "upsert" } & PodFilesEvent,
  ): void;
}

export function createPodFilesBus(): PodFilesBus {
  type Cb = Parameters<PodFilesBus["subscribe"]>[1];
  const subs = new Map<string, Set<Cb>>();
  return {
    subscribe(agentName, cb) {
      let set = subs.get(agentName);
      if (!set) {
        set = new Set();
        subs.set(agentName, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
        if (set && set.size === 0) subs.delete(agentName);
      };
    },
    publish(agentName, e) {
      const set = subs.get(agentName);
      if (!set) return;
      for (const cb of set) {
        try {
          cb(e);
        } catch {
          // Subscriber errors are isolated.
        }
      }
    },
  };
}
