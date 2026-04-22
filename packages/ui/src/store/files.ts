import type { StateCreator } from "zustand";
import type { TreeEntry } from "../types.js";
import type { HumrStore } from "../store.js";

export type RightTab = "files" | "log" | "configuration";

export interface FilesSlice {
  fileTree: TreeEntry[];
  openFile: { path: string; content: string; binary?: boolean; mimeType?: string } | null;
  rightTab: RightTab;
  setFileTree: (entries: TreeEntry[]) => void;
  setOpenFile: (file: FilesSlice["openFile"]) => void;
  setRightTab: (tab: RightTab) => void;
}

export const createFilesSlice: StateCreator<HumrStore, [], [], FilesSlice> = (set) => ({
  fileTree: [],
  openFile: null,
  rightTab: "files",
  setFileTree: (entries) => set({ fileTree: entries }),
  setOpenFile: (file) => set({ openFile: file }),
  setRightTab: (tab) => set({ rightTab: tab }),
});
