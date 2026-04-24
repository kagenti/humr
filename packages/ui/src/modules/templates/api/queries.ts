import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useTemplates() {
  return useQuery({
    ...trpc.templates.list.queryOptions(),
    meta: { errorToast: "Couldn't load templates" },
  });
}
