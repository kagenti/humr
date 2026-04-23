import type { StateCreator } from "zustand";

import type { HumrStore } from "../../store.js";

export type RightTab = "files" | "log" | "configuration";

export interface FilesSlice {
  /** Path of the file currently open in the viewer. The content itself lives
   *  in the TanStack Query cache (see modules/files/api/queries.ts); this
   *  field is the UI-state side of the pair. */
  openFilePath: string | null;
  rightTab: RightTab;
  setOpenFilePath: (path: string | null) => void;
  setRightTab: (tab: RightTab) => void;
}

export const createFilesSlice: StateCreator<HumrStore, [], [], FilesSlice> = (set) => ({
  openFilePath: null,
  rightTab: "files",
  setOpenFilePath: (path) => set({ openFilePath: path }),
  setRightTab: (tab) => set({ rightTab: tab }),
});
