import type { StateCreator } from "zustand";

import { platform } from "../../platform.js";
import type { HumrStore } from "../../store.js";
import { runQuery } from "../../store/query-helpers.js";
import type { TemplateView } from "../../types.js";

export interface TemplatesSlice {
  templates: TemplateView[];
  fetchTemplates: () => Promise<void>;
}

export const createTemplatesSlice: StateCreator<HumrStore, [], [], TemplatesSlice> = (set) => ({
  templates: [],
  fetchTemplates: async () => {
    set((s) => ({ loading: { ...s.loading, templates: true } }));
    const list = await runQuery("templates", () => platform.templates.list.query(), {
      fallback: "Couldn't load templates",
    });
    if (list) set({ templates: list });
    set((s) => ({ loading: { ...s.loading, templates: false } }));
  },
});
