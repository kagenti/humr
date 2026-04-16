import { beforeAll, inject } from "vitest";
import { setToken } from "./trpc-client.js";

beforeAll(() => {
  setToken(inject("authToken"));
});
