import { useQuery } from "@tanstack/react-query";

import { platform } from "../../../platform.js";
import { trpc } from "../../../trpc.js";

export const instancesKeys = {
  root: ["instances"] as const,
  listWithChannels: () => [...instancesKeys.root, "list-with-channels"] as const,
};

/**
 * Single combined query for the instances list + available channels. The two
 * are always consumed together (instance panels render channel pills), and
 * pairing them avoids a render pass where one is loaded but not the other.
 */
export function useInstances() {
  return useQuery({
    queryKey: instancesKeys.listWithChannels(),
    queryFn: async () => {
      const [list, availableChannels] = await Promise.all([
        platform.instances.list.query(),
        platform.channels.available.query(),
      ]);
      return { list, availableChannels };
    },
    refetchInterval: 5000,
    staleTime: 5000,
    meta: { errorToast: "Can't reach the server — instance list may be stale" },
  });
}

// Mutations that mutate instances invalidate both the list and the
// channel-available combined query via this key.
export const instancesListQueryKey = instancesKeys.listWithChannels;

// Re-export the tRPC list key so consumers that cross into the agents flow
// (createAgent mutates both agents.list and instances.list) can invalidate
// the right thing without knowing the internal key shape.
export const instancesTrpcListKey = trpc.instances.list.queryKey;
