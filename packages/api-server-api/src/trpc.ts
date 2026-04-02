import { initTRPC } from "@trpc/server";
import type { ApiContext } from "./context.js";

export const t = initTRPC.context<ApiContext>().create();
