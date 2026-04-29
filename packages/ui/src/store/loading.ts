import type { StateCreator } from "zustand";
import type { HumrStore } from "../store.js";

export interface LoadingState {
  session: boolean;
}

export interface LoadingSlice {
  loading: LoadingState;
  setLoadingSession: (loading: boolean) => void;
}

export const createLoadingSlice: StateCreator<HumrStore, [], [], LoadingSlice> = (set) => ({
  loading: { session: false },
  setLoadingSession: (loading) => set((s) => ({ loading: { ...s.loading, session: loading } })),
});
