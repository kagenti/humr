import type { StateCreator } from "zustand";
import type { HumrStore } from "../store.js";

export type View = "list" | "chat" | "providers" | "connections" | "settings";

export interface NavigationSlice {
  view: View;
  setView: (v: View) => void;
  mobileScreen: "sessions" | "chat";
  setMobileScreen: (screen: "sessions" | "chat") => void;
  showMobilePanel: boolean;
  setShowMobilePanel: (show: boolean) => void;
}

export function viewToPath(view: View, instance?: string | null): string {
  if (view === "chat" && instance) return `/chat/${encodeURIComponent(instance)}`;
  if (view === "providers") return "/providers";
  if (view === "connections") return "/connections";
  if (view === "settings") return "/settings";
  return "/";
}

export function pathToState(path: string): { view: View; instance?: string } {
  if (path.startsWith("/chat/")) return { view: "chat", instance: decodeURIComponent(path.slice(6)) };
  if (path === "/providers") return { view: "providers" };
  if (path === "/connections") return { view: "connections" };
  if (path === "/settings") return { view: "settings" };
  return { view: "list" };
}

export const createNavigationSlice: StateCreator<HumrStore, [], [], NavigationSlice> = (set) => ({
  view: (() => {
    const saved = sessionStorage.getItem("humr-return-view");
    if (saved) {
      sessionStorage.removeItem("humr-return-view");
      return saved as View;
    }
    return pathToState(window.location.pathname).view;
  })(),
  setView: (v) => {
    history.pushState(null, "", viewToPath(v));
    set({ view: v });
  },
  mobileScreen: "sessions",
  setMobileScreen: (screen) => set({ mobileScreen: screen }),
  showMobilePanel: false,
  setShowMobilePanel: (show) => set({ showMobilePanel: show }),
});
