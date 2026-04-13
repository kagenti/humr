export type ImprovementTerminalState = "completed" | "timed-out" | "skipped" | "failed";
export type ImprovementRuntimeState = "idle" | "running" | ImprovementTerminalState;

export interface ImprovementLast {
  state: ImprovementTerminalState;
  schedule: string;
  finishedAt: string;
  detail?: string;
}

export interface ImprovementStatus {
  /** Is a run currently active? (lock file exists) */
  running: boolean;
  /** Last terminal outcome, if any. */
  last: ImprovementLast | null;
}

export interface ImprovementService {
  /** Read current improvement state from the workspace. */
  getStatus: () => ImprovementStatus;
}
