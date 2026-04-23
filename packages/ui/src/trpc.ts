import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "api-server-api";
import { platform } from "./platform.js";
import { queryClient } from "./query-client.js";

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: platform,
  queryClient,
});
