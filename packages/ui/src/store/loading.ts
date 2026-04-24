import type { StateCreator } from "zustand";
import type { HumrStore } from "../store.js";

export interface LoadingState {
  sessions: boolean;
  session: boolean;
}

export interface LoadingSlice {
  loading: LoadingState;
  setLoadingSessions: (loading: boolean) => void;
  setLoadingSession: (loading: boolean) => void;
}

export const createLoadingSlice: StateCreator<HumrStore, [], [], LoadingSlice> = (set) => ({
  loading: { sessions: false, session: false },
  setLoadingSessions: (loading) => set((s) => ({ loading: { ...s.loading, sessions: loading } })),
  setLoadingSession: (loading) => set((s) => ({ loading: { ...s.loading, session: loading } })),
});
