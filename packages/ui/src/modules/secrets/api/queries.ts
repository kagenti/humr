import { useQuery } from "@tanstack/react-query";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

export function prefetchSecrets() {
  return queryClient.prefetchQuery(trpc.secrets.list.queryOptions());
}

export function useSecrets(options?: { enabled?: boolean }) {
  return useQuery({
    ...trpc.secrets.list.queryOptions(),
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load secrets" },
  });
}
