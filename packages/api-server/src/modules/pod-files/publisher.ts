import type { PodFilesBus } from "./bus.js";
import type { FileProducer, FileSpec } from "./types.js";
import { mergeFileSpecsByPath } from "./merge-specs.js";

/**
 * Run all registered producers for an owner and publish/return the merged
 * `FileSpec[]`. The seam every state-mutating service uses to push pod-file
 * updates without knowing what providers exist.
 */
export interface PodFilesPublisher {
  /**
   * Run all producers for an owner and return the merged result. Used at
   * SSE-connect time to produce a snapshot.
   */
  compute(owner: string): Promise<FileSpec[]>;
  /**
   * Run all producers and publish the result as an `upsert` event for the
   * given agent. No-op when the merged result is empty.
   */
  publishForOwner(owner: string, agentName: string): Promise<void>;
}

export function createPodFilesPublisher(deps: {
  bus: PodFilesBus;
  registry: readonly FileProducer[];
}): PodFilesPublisher {
  async function compute(owner: string): Promise<FileSpec[]> {
    const all = await Promise.all(
      deps.registry.map(async (p) => {
        try {
          return await p.produce(owner);
        } catch (err) {
          // One bad producer must not poison the snapshot. Log and continue.
          console.warn(`pod-files producer "${p.id}" failed for ${owner}:`, err);
          return [];
        }
      }),
    );
    return mergeFileSpecsByPath(all.flat());
  }

  return {
    compute,
    async publishForOwner(owner, agentName) {
      const files = await compute(owner);
      if (files.length > 0) {
        deps.bus.publish(agentName, { kind: "upsert", files });
      }
    },
  };
}
