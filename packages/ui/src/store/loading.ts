import type { StateCreator } from "zustand";
import type { HumrStore } from "../store.js";

export interface LoadingState {
  templates: boolean;
  agents: boolean;
  instances: boolean;
  sessions: boolean;
  session: boolean;
}

export interface LoadingSlice {
  loading: LoadingState;
  /** Persist-across-mount "we've fetched at least once" flags. Prevents the
   * list-view skeleton from reappearing when the user navigates away and back. */
  loadedOnce: {
    agents: boolean;
    instances: boolean;
    appConnections: boolean;
    mcpConnections: boolean;
  };
  setLoadingSessions: (loading: boolean) => void;
  setLoadingSession: (loading: boolean) => void;
}

export const createLoadingSlice: StateCreator<HumrStore, [], [], LoadingSlice> = (set) => ({
  loading: { templates: false, agents: false, instances: false, sessions: false, session: false },
  loadedOnce: {
    agents: false,
    instances: false,
    appConnections: false,
    mcpConnections: false,
  },
  setLoadingSessions: (loading) => set((s) => ({ loading: { ...s.loading, sessions: loading } })),
  setLoadingSession: (loading) => set((s) => ({ loading: { ...s.loading, session: loading } })),
});
