/**
 * Wire types for pod-files SSE events. The api-server emits these; this module
 * applies them. Producer state lives in the api-server; the runtime is purely
 * the materialization side.
 *
 * See docs/adrs/DRAFT-pod-files-push.md.
 */

export type Fragment = Record<string, unknown>;

export type MergeMode = "yaml-fill-if-missing";

export interface FileSpec {
  path: string;
  mode: MergeMode;
  fragments: Fragment[];
}

export interface PodFilesEvent {
  files: FileSpec[];
}

export type EventKind = "snapshot" | "upsert";
