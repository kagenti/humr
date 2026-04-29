import type { PodFilesBus } from "./bus.js";
import type { FileProducer, FileSpec, ProducerSource } from "./types.js";
import { mergeFileSpecsByPath } from "./merge-specs.js";

/**
 * Run registered producers for an `(owner, agentId)` pair and publish/
 * return the merged `FileSpec[]`. The seam every state-mutating service
 * uses to push pod-file updates without knowing what producers exist.
 *
 * Producers are agent-scoped: the merged result reflects only state
 * explicitly attached to `agentId` (e.g. connections granted to it),
 * not the owner's broader state.
 */
export interface PodFilesPublisher {
  /**
   * Run *all* producers for an `(owner, agentId)` pair and return the
   * merged result. Used at SSE-connect time to produce a snapshot — at
   * that point we don't know which sources have changed since the agent
   * last connected.
   */
  compute(owner: string, agentId: string): Promise<FileSpec[]>;
  /**
   * Run only the producers tagged with `source` and publish the result as
   * an `upsert` event for the given agent. No-op when no producer matches
   * or when the merged result is empty.
   */
  publishForOwner(
    owner: string,
    agentId: string,
    source: ProducerSource,
  ): Promise<void>;
}

async function runProducers(
  producers: readonly FileProducer[],
  owner: string,
  agentId: string,
): Promise<FileSpec[]> {
  const all = await Promise.all(
    producers.map(async (p) => {
      try {
        return await p.produce(owner, agentId);
      } catch (err) {
        // One bad producer must not poison the result. Log and continue.
        console.warn(
          `pod-files producer "${p.id}" failed for owner=${owner} agent=${agentId}:`,
          err,
        );
        return [];
      }
    }),
  );
  return mergeFileSpecsByPath(all.flat());
}

export function createPodFilesPublisher(deps: {
  bus: PodFilesBus;
  registry: readonly FileProducer[];
}): PodFilesPublisher {
  return {
    compute(owner, agentId) {
      return runProducers(deps.registry, owner, agentId);
    },
    async publishForOwner(owner, agentId, source) {
      const matching = deps.registry.filter((p) => p.source === source);
      if (matching.length === 0) return;
      const files = await runProducers(matching, owner, agentId);
      if (files.length > 0) {
        deps.bus.publish(agentId, { kind: "upsert", files });
      }
    },
  };
}
