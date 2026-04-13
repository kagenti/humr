import { initTRPC } from "@trpc/server";
import type { AgentRuntimeContext } from "./context.js";

export const t = initTRPC.context<AgentRuntimeContext>().create();
