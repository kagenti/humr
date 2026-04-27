/**
 * Push declarative file state to agent pods. The platform feature is
 * source-agnostic — any state in humr (connections, secrets, schedules,
 * UI-edited config) can drive file updates in pods. Connector grants are
 * the first instance, not the only kind.
 *
 * See docs/adrs/DRAFT-connector-files-push.md.
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
 * A producer reads humr's state for an owner and emits the files it wants
 * materialized in that owner's agent pods. Opaque source: the platform
 * doesn't know whether the producer's state is connections, secrets, or
 * something else — only that it can produce `FileSpec`s on demand.
 */
export interface FileProducer {
  /** Stable id, used for logging and selective re-publish. */
  id: string;
  /**
   * Compute this producer's `FileSpec`s for `owner`. Empty array means
   * "this producer has nothing to contribute right now". Errors should be
   * caught by the caller — a producer crash must not block the others.
   */
  produce(owner: string): Promise<FileSpec[]>;
}
