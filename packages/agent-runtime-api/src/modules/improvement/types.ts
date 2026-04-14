export type ImprovementTerminalState = "completed" | "timed-out" | "failed";
export type ImprovementRuntimeState = "idle" | "running" | ImprovementTerminalState;

export interface ImprovementLast {
  state: ImprovementTerminalState;
  schedule: string;
  finishedAt: string;
  detail?: string;
}

export interface ImprovementSkipped {
  schedule: string;
  at: string;
  reason: string;
}

export interface ImprovementStatus {
  /** Is a run currently active? (lock file exists) */
  running: boolean;
  /** Last terminal outcome, if any. Never overwritten by skip events. */
  last: ImprovementLast | null;
  /** Most recent skip event, if any. Transient info — overwriting is fine. */
  lastSkipped: ImprovementSkipped | null;
}

export interface ImprovementService {
  /** Read current improvement state from the workspace. */
  getStatus: () => ImprovementStatus;
}
