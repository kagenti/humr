import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { acpSessionsKeys } from "./queries.js";

export function useDeleteSession() {
  return useMutation({
    ...trpc.sessions.delete.mutationOptions(),
    meta: {
      invalidates: [acpSessionsKeys.all],
      errorToast: "Failed to delete session",
    },
  });
}

/**
 * Register a new ACP session with the platform DB. Called after the agent
 * returns a fresh sessionId — until this resolves, the session exists on the
 * pod but won't survive a refresh.
 */
export function useCreateSession() {
  return useMutation({
    ...trpc.sessions.create.mutationOptions(),
    meta: {
      invalidates: [acpSessionsKeys.all],
    },
  });
}
