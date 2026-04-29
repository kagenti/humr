/**
 * Push declarative file state to agent pods. The platform feature is
 * source-agnostic — any state in humr (connections, secrets, schedules,
 * UI-edited config) can drive file updates in pods. Connector grants are
 * the first instance, not the only kind.
 *
 * See docs/adrs/DRAFT-pod-files-push.md.
 */

/** A producer's contribution to a file. Shape depends on `mode`. */
export type FileFragment = Record<string, unknown>;

export type MergeMode = "yaml-fill-if-missing";

/** One managed file as it travels on the SSE wire. */
export interface FileSpec {
  path: string;
  mode: MergeMode;
  fragments: FileFragment[];
}

/** SSE event payload, identical for snapshot and upsert. */
export interface PodFilesEvent {
  files: FileSpec[];
}

/**
 * Names the *state source* a producer reads. State-mutating services tag
 * their publishes with the source they just changed; the publisher only
 * runs producers tagged with that source. Keep names aligned with what
 * the source actually is (the system, not the action) so producers and
 * publishers can match by string.
 */
export const PRODUCER_SOURCES = ["app-connections"] as const;
export type ProducerSource = (typeof PRODUCER_SOURCES)[number];

/**
 * A producer reads humr's state for an owner and emits the files it wants
 * materialized in that owner's agent pods. Opaque source: the platform
 * doesn't know whether the producer's state is app connections, secrets,
 * or something else — only the `source` tag is used for routing.
 */
export interface FileProducer {
  /** Stable id, used for logging. */
  id: string;
  /**
   * State source this producer reads. `publishForOwner(.., source)` only
   * runs producers whose `source` matches.
   */
  source: ProducerSource;
  /**
   * Compute this producer's `FileSpec`s for `owner`. Empty array means
   * "this producer has nothing to contribute right now". Errors should be
   * caught by the caller — a producer crash must not block the others.
   */
  produce(owner: string): Promise<FileSpec[]>;
}
