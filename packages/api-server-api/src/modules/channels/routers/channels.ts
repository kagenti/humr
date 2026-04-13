import { t } from "../../../trpc.js";

export const channelsRouter = t.router({
  available: t.procedure.query(({ ctx }) => ctx.channels.available),
});
