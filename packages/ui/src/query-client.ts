import { QueryCache, QueryClient, type QueryKey } from "@tanstack/react-query";
import { emitToast } from "./store/toast-sink.js";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      invalidates?: QueryKey[];
      errorToast?: string;
    };
    queryMeta: {
      errorToast?: string;
    };
  }
}

const queryCache = new QueryCache({
  onError: (_error, query) => {
    const toast = query.meta?.errorToast;
    if (toast) emitToast({ kind: "warning", message: toast });
  },
});

export const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: { retry: 3 },
    mutations: {
      onSuccess: (_data, _vars, _ctx, mutation) => {
        mutation.meta?.invalidates?.forEach((key) =>
          queryClient.invalidateQueries({ queryKey: key }),
        );
      },
      onError: (error, _vars, _ctx, mutation) => {
        const msg =
          error instanceof Error && error.message
            ? error.message
            : mutation.meta?.errorToast ?? "Action failed";
        emitToast({ kind: "error", message: msg });
      },
    },
  },
});
