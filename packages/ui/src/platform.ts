import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";

export const platform = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/platform/trpc",
    }),
  ],
});
