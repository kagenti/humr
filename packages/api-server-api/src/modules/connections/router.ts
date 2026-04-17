import { t } from "../../trpc.js";

export const connectionsRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.connections.list()),
});
