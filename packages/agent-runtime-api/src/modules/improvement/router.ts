import { t } from "../../trpc.js";

export const improvementRouter = t.router({
  status: t.procedure.query(({ ctx }) => ctx.improvement.getStatus()),
});
