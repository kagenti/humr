import type { StateCreator } from "zustand";
import { platform } from "../../platform.js";
import type { Schedule } from "../../types.js";
import type { HumrStore } from "../../store.js";
import { runAction, runQuery, ACTION_FAILED } from "../../store/query-helpers.js";

export interface CreateScheduleInput {
  name: string;
  cron: string;
  task: string;
  sessionMode?: "continuous" | "fresh";
}

export interface SchedulesSlice {
  schedules: Schedule[];
  setSchedules: (schedules: Schedule[]) => void;
  fetchSchedules: () => Promise<void>;
  createSchedule: (input: CreateScheduleInput) => Promise<boolean>;
  toggleSchedule: (id: string) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  resetScheduleSession: (scheduleId: string) => Promise<void>;
}

export const createSchedulesSlice: StateCreator<HumrStore, [], [], SchedulesSlice> = (set, get) => ({
  schedules: [],
  setSchedules: (schedules) => set({ schedules }),

  fetchSchedules: async () => {
    const { selectedInstance } = get();
    if (!selectedInstance) return;
    const list = await runQuery(
      `schedules:${selectedInstance}`,
      () => platform.schedules.list.query({ instanceId: selectedInstance }),
      { fallback: "Couldn't refresh schedules" },
    );
    if (list) set({ schedules: list });
  },

  createSchedule: async (input) => {
    const { selectedInstance } = get();
    if (!selectedInstance) return false;
    const ok = await runAction(
      () => platform.schedules.createCron.mutate({
        name: input.name,
        instanceId: selectedInstance,
        cron: input.cron,
        task: input.task,
        sessionMode: input.sessionMode !== "fresh" ? input.sessionMode : undefined,
      }),
      "Failed to create schedule",
    );
    if (ok === ACTION_FAILED) return false;
    await get().fetchSchedules();
    return true;
  },

  toggleSchedule: async (id) => {
    const ok = await runAction(
      () => platform.schedules.toggle.mutate({ id }),
      "Failed to toggle schedule",
    );
    if (ok !== ACTION_FAILED) await get().fetchSchedules();
  },

  deleteSchedule: async (id) => {
    const ok = await runAction(
      () => platform.schedules.delete.mutate({ id }),
      "Failed to delete schedule",
    );
    if (ok !== ACTION_FAILED) await get().fetchSchedules();
  },

  resetScheduleSession: async (scheduleId) => {
    const ok = await runAction(
      () => platform.sessions.resetByScheduleId.mutate({ scheduleId }),
      "Failed to reset schedule session",
    );
    if (ok !== ACTION_FAILED) await get().fetchSchedules();
  },
});
