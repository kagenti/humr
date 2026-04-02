import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "harness-runtime-api";

export function createInstanceTrpc(instanceId: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `/api/instances/${instanceId}/trpc`,
      }),
    ],
  });
}
