export type StepStatus = "pending" | "done" | "skipped";

export interface OnboardingState {
  provider: StepStatus;
  connections: StepStatus;
  agent: StepStatus;
}

export interface OnboardingSignals {
  hasProvider: boolean;
  hasConnections: boolean;
  hasAgent: boolean;
  connectionsSkipped: boolean;
}

const SKIPPED_KEY = "humr-onboarding-connections-skipped";

export function isConnectionsSkipped(): boolean {
  try {
    return localStorage.getItem(SKIPPED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setConnectionsSkipped(skipped: boolean): void {
  try {
    if (skipped) localStorage.setItem(SKIPPED_KEY, "true");
    else localStorage.removeItem(SKIPPED_KEY);
  } catch {
    // localStorage unavailable — ignore
  }
}

export function computeOnboardingState(s: OnboardingSignals): OnboardingState {
  return {
    provider: s.hasProvider ? "done" : "pending",
    connections: s.hasConnections
      ? "done"
      : s.connectionsSkipped
        ? "skipped"
        : "pending",
    agent: s.hasAgent ? "done" : "pending",
  };
}
