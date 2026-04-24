import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { useRestartInstanceMutation } from "../api/mutations.js";
import { useInstances } from "../api/queries.js";
import { transitionRestartingInstances } from "../store.js";

/**
 * Wraps the raw restart mutation with the UI-side "Restarting" pill lifecycle.
 * The pill goes on the moment the user clicks, ages out on the next poll that
 * sees the pod dip and then return, and gets cleared if the mutation itself
 * fails.
 */
export function useRestartInstance() {
  const setRestarting = useStore((s) => s.setRestartingInstance);
  const clearRestarting = useStore((s) => s.clearRestartingInstance);
  const restartMutation = useRestartInstanceMutation();

  const restart = (id: string) => {
    setRestarting(id, { seenNonRunning: false, clickedAt: Date.now() });
    restartMutation.mutate(
      { id },
      {
        onError: () => clearRestarting(id),
      },
    );
  };

  return { restart, isPending: restartMutation.isPending };
}

/**
 * Advances the restartingInstances map whenever the instances query data
 * changes — mount this alongside useInstances in any view that renders the
 * "Restarting" pill so stuck/resolved entries age out correctly.
 */
export function useSyncRestartingInstances() {
  const { data } = useInstances();
  const setRestartingInstances = useStore((s) => s.setRestartingInstances);

  useEffect(() => {
    if (!data) return;
    const current = useStore.getState().restartingInstances;
    const next = transitionRestartingInstances(current, data.list);
    if (next !== current) setRestartingInstances(next);
  }, [data, setRestartingInstances]);
}
