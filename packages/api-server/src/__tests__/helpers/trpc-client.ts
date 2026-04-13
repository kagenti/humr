import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";

const API_URL = "http://humr-api.localtest.me:5555/api/trpc";

/** Create a tRPC client with an optional auth token. */
export function createClient(token?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: API_URL,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    ],
  });
}

/** Default authenticated client — set token via setToken() before use. */
let _token: string | undefined;

export function setToken(token: string) {
  _token = token;
}

export const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: API_URL,
      headers: () => (_token ? { Authorization: `Bearer ${_token}` } : {}),
    }),
  ],
});
