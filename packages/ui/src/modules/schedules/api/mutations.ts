import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const invalidatesScheduleList = {
  invalidates: [trpc.schedules.list.queryKey()],
};

export function useCreateSchedule() {
  return useMutation({
    ...trpc.schedules.createCron.mutationOptions(),
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
