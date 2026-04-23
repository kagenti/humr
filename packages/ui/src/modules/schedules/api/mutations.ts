import { useMutation } from "@tanstack/react-query";

import { platform } from "../../../platform.js";
import { trpc } from "../../../trpc.js";

const invalidatesScheduleList = {
  invalidates: [trpc.schedules.list.queryKey()],
};

export interface CreateScheduleInput {
  instanceId: string;
  name: string;
  cron: string;
  task: string;
  sessionMode: "fresh" | "continuous";
}

export function useCreateSchedule() {
  return useMutation({
    mutationFn: (input: CreateScheduleInput) =>
      platform.schedules.createCron.mutate({
        ...input,
        // "fresh" is the absence of a persisted session on the wire.
        sessionMode: input.sessionMode === "fresh" ? undefined : input.sessionMode,
      }),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to create schedule",
    },
  });
}

export function useToggleSchedule() {
  return useMutation({
    ...trpc.schedules.toggle.mutationOptions(),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to toggle schedule",
    },
  });
}

export function useDeleteSchedule() {
  return useMutation({
    ...trpc.schedules.delete.mutationOptions(),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to delete schedule",
    },
  });
}

export function useResetScheduleSession() {
  return useMutation({
    ...trpc.sessions.resetByScheduleId.mutationOptions(),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to reset schedule session",
    },
  });
}
