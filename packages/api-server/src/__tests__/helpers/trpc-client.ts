import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";

const API_URL = "http://localhost:4111/api/trpc";

export const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: API_URL })],
});
