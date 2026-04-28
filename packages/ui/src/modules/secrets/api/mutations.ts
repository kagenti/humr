import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

const invalidatesSecretsList = {
  invalidates: [trpc.secrets.list.queryKey()],
};

export function useCreateSecret() {
  return useMutation({
    ...trpc.secrets.create.mutationOptions(),
    meta: {
      ...invalidatesSecretsList,
      errorToast: "Failed to create secret",
    },
  });
}

export function useUpdateSecret() {
  return useMutation({
    ...trpc.secrets.update.mutationOptions(),
    meta: {
      ...invalidatesSecretsList,
      errorToast: "Failed to update secret",
    },
  });
}

export function useDeleteSecret() {
  return useMutation({
    ...trpc.secrets.delete.mutationOptions(),
    meta: {
      ...invalidatesSecretsList,
      errorToast: "Failed to delete secret",
    },
  });
}

/**
 * Verifies an Anthropic credential before save. Returns
 * `{ ok: true } | { ok: false; message }` rather than throwing — callers
 * render the result inline, so no errorToast / invalidation here.
 */
export function useTestAnthropic() {
  return useMutation({
    ...trpc.secrets.testAnthropic.mutationOptions(),
  });
}
