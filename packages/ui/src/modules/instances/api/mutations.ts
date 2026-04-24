import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { instancesKeys } from "./queries.js";

const invalidatesInstancesList = {
  invalidates: [instancesKeys.listWithChannels()],
};

export function useCreateInstance() {
  return useMutation({
    ...trpc.instances.create.mutationOptions(),
    meta: {
      ...invalidatesInstancesList,
      errorToast: "Failed to create instance",
    },
  });
}

export function useWakeInstance() {
  return useMutation({
    ...trpc.instances.wake.mutationOptions(),
    meta: {
      ...invalidatesInstancesList,
      errorToast: "Failed to start agent",
    },
  });
}

/**
 * Raw restart mutation. The UI-side "Restarting" pill lifecycle is managed
 * by useRestartInstance in use-restarting-instances.ts — consumers should
 * call that hook, not this mutation directly, so the pill lights up the
 * moment the user clicks.
 */
export function useRestartInstanceMutation() {
  return useMutation({
    ...trpc.instances.restart.mutationOptions(),
    meta: {
      ...invalidatesInstancesList,
      errorToast: "Failed to restart agent",
    },
  });
}

export function useUpdateInstance() {
  return useMutation({
    ...trpc.instances.update.mutationOptions(),
    meta: {
      ...invalidatesInstancesList,
      errorToast: "Failed to update instance",
    },
  });
}

export function useConnectSlack() {
  return useMutation({
    ...trpc.instances.connectSlack.mutationOptions(),
    meta: {
      ...invalidatesInstancesList,
      errorToast: "Failed to connect Slack",
    },
  });
}

export function useDisconnectSlack() {
  return useMutation({
    ...trpc.instances.disconnectSlack.mutationOptions(),
    meta: {
      ...invalidatesInstancesList,
      errorToast: "Failed to disconnect Slack",
    },
  });
}

export function useConnectTelegram() {
  return useMutation({
    ...trpc.instances.connectTelegram.mutationOptions(),
    meta: {
      ...invalidatesInstancesList,
      errorToast: "Failed to connect Telegram",
    },
  });
}

export function useDisconnectTelegram() {
  return useMutation({
    ...trpc.instances.disconnectTelegram.mutationOptions(),
    meta: {
      ...invalidatesInstancesList,
      errorToast: "Failed to disconnect Telegram",
    },
  });
}
