import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "harness-runtime-api";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
    }),
  ],
});
