import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import { isCustomSecret } from "../types.js";
import {
  computeOnboardingState,
  firstPendingStep,
  isConnectionsSkipped,
  STEP_KEYS,
  stepLabels,
  type StepKey,
  type StepStatus,
} from "../lib/onboarding.js";
import { Check, ArrowRight } from "lucide-react";

type View = "list" | "providers" | "connections";

const STEP_TARGET: Record<StepKey, View> = {
  provider: "providers",
  connections: "connections",
  agent: "list",
};

export function SetupProgressBar() {
  const view = useStore((s) => s.view);
  const agents = useStore((s) => s.agents);
  const secrets = useStore((s) => s.secrets);
  const appConnections = useStore((s) => s.appConnections);
  const mcpConnections = useStore((s) => s.mcpConnections);
  const loadedOnce = useStore((s) => s.loadedOnce);
  const setView = useStore((s) => s.setView);
  const fetchAppConnections = useStore((s) => s.fetchAppConnections);
  const fetchMcpConnections = useStore((s) => s.fetchMcpConnections);
  const fetchSecrets = useStore((s) => s.fetchSecrets);

  const [skipped, setSkipped] = useState(() => isConnectionsSkipped());

  // Re-read the skip flag when we switch into a view that renders the bar,
  // so toggling "Skip"/"Unskip" on the empty-state list view is reflected here.
  useEffect(() => {
    setSkipped(isConnectionsSkipped());
  }, [view]);

  // Gate on both agents + secrets being loaded so `hasProvider` is accurate on
  // first render — otherwise the bar briefly flashes step 1 as pending even
  // when the user already has an Anthropic key.
  const shouldRender =
    (view === "providers" || view === "connections") &&
    loadedOnce.agents &&
    loadedOnce.secrets &&
    agents.length === 0;

  useEffect(() => {
    if (!shouldRender) return;
    fetchSecrets();
    fetchAppConnections();
    fetchMcpConnections();
  }, [shouldRender, fetchSecrets, fetchAppConnections, fetchMcpConnections]);

  if (!shouldRender) return null;

  const hasProvider = secrets.some((s) => s.type === "anthropic");
  const hasConnections =
    appConnections.some((c) => c.status === "connected") ||
    mcpConnections.some((c) => !c.expired) ||
    secrets.some(isCustomSecret);

  const state = computeOnboardingState({
    hasProvider,
    hasConnections,
    hasAgent: false,
    connectionsSkipped: skipped,
  });
  const current = firstPendingStep(state) ?? "agent";
  const currentIndex = STEP_KEYS.indexOf(current);

  return (
    <div
      className="sticky top-0 z-20 border-b-2 border-border-light bg-bg/95 backdrop-blur-xl"
      role="navigation"
      aria-label="Onboarding progress"
    >
      <div className="mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-2.5 md:py-3 flex items-center gap-3">
        {/* Desktop: all three steps as pills — clickable to jump to that step */}
        <div className="hidden md:flex items-center gap-2 flex-1 min-w-0">
          {STEP_KEYS.map((key, i) => (
            <StepPill
              key={key}
              index={i}
              label={stepLabels[key]}
              status={state[key]}
              isCurrent={key === current}
              isActiveView={STEP_TARGET[key] === view}
              onClick={() => setView(STEP_TARGET[key])}
            />
          ))}
        </div>

        {/* Mobile: compact "Step N of 3: [Name]" */}
        <div className="md:hidden flex-1 min-w-0">
          <div className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
            Step {currentIndex + 1} of {STEP_KEYS.length}
          </div>
          <div className="text-[13px] font-semibold text-text truncate">
            {stepLabels[current]}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setView("list")}
          className="btn-brutal shrink-0 h-8 md:h-9 rounded-lg border-2 border-accent-hover bg-accent px-3 md:px-4 text-[12px] md:text-[13px] font-semibold text-white flex items-center gap-1.5"
          style={{ boxShadow: "var(--shadow-brutal-accent)" }}
        >
          Continue <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}

function StepPill({
  index,
  label,
  status,
  isCurrent,
  isActiveView,
  onClick,
}: {
  index: number;
  label: string;
  status: StepStatus;
  isCurrent: boolean;
  isActiveView: boolean;
  onClick: () => void;
}) {
  const done = status === "done" || status === "skipped";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActiveView ? "page" : undefined}
      className={`btn-brutal flex items-center gap-2 rounded-lg border-2 px-2.5 py-1 min-w-0 transition-colors hover:border-accent ${
        isCurrent
          ? "border-warning bg-warning-light"
          : done
            ? "border-border-light bg-surface-raised"
            : "border-border-light bg-surface"
      }`}
    >
      <span
        className={`w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-[11px] font-bold ${
          done
            ? "bg-surface-raised text-success"
            : isCurrent
              ? "bg-warning text-white"
              : "bg-border-light text-text-secondary"
        }`}
      >
        {done ? <Check size={12} strokeWidth={3} /> : index + 1}
      </span>
      <span
        className={`text-[12px] font-semibold truncate ${
          isCurrent ? "text-text" : done ? "text-text-muted" : "text-text-secondary"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
