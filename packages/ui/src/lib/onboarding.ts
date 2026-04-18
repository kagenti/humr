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

export const STEP_KEYS = ["provider", "connections", "agent"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const stepLabels: Record<StepKey, string> = {
  provider: "Set up a provider",
  connections: "Set up connections",
  agent: "Add your first agent",
};

export function firstPendingStep(state: OnboardingState): StepKey | undefined {
  return STEP_KEYS.find((k) => state[k] === "pending");
}
