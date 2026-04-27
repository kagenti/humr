/**
 * Generic shape for "connector-declared file state in agent pods" — the
 * filesystem analogue of ADR-024's connector-declared envs. See
 * docs/adrs/DRAFT-connector-files-push.md.
 *
 * The on-the-wire payload (snapshot/upsert events to the sidecar) is a list
 * of `FileSpec`s; each spec collects the fragments contributed by every
 * granted connection of one provider, grouped by destination path.
 */

/** A single connection's contribution to a file. Shape depends on `mode`. */
export type FileFragment = Record<string, unknown>;

export type MergeMode = "yaml-fill-if-missing";

/** Wire shape: one entry per managed file. */
export interface FileSpec {
  path: string;
  mode: MergeMode;
  fragments: FileFragment[];
}

/** SSE event payload, identical for snapshot and upsert. */
export interface ConnectorFilesEvent {
  files: FileSpec[];
}

/** Subset of OneCLI's connection row that the registry needs to render. */
export interface RawConnection {
  id?: string;
  provider: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Per-provider declaration of one file the agent pod should have. Multiple
 * entries can target the same `path` (rare, but supported — fragments are
 * concatenated). Multiple entries can target different paths for the same
 * provider too (also supported, for providers that maintain several files).
 */
export interface ConnectorFile {
  /** OneCLI provider id (matches `provider` on `/api/connections` rows). */
  provider: string;
  /** Absolute path inside the agent pod. */
  path: string;
  /** Merge strategy the sidecar applies for this path. */
  mode: MergeMode;
  /**
   * Render this connection's fragment for the file, or null to skip
   * (e.g. metadata is missing required fields). The renderer is also where
   * to log a warning explaining why a row was skipped.
   */
  render(connection: RawConnection): FileFragment | null;
}
