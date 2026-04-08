import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";

const API_URL = "http://humr-api.localtest.me:5555/api/trpc";

export const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: API_URL })],
});
