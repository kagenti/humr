import { t } from "../../trpc.js";

export const channelsRouter = t.router({
  available: t.procedure.query(({ ctx }) => ctx.channels.available),
  linkedUsers: t.procedure.query(({ ctx }) => ctx.channels.linkedUsers()),
});
