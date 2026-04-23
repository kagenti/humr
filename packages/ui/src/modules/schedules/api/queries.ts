import { skipToken, useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useSchedules(instanceId: string | null) {
  return useQuery({
    ...trpc.schedules.list.queryOptions(
      instanceId ? { instanceId } : skipToken,
    ),
    refetchInterval: 5000,
    staleTime: 5000,
    meta: { errorToast: "Couldn't refresh schedules" },
  });
}

export function useScheduleSessions(scheduleId: string | null) {
  return useQuery({
    ...trpc.sessions.listByScheduleId.queryOptions(
      scheduleId ? { scheduleId } : skipToken,
    ),
    // Single-shot on expand; the list-level poll is authoritative for status.
    retry: 0,
    staleTime: 30_000,
    meta: { errorToast: "Couldn't load past runs for this schedule" },
  });
}
