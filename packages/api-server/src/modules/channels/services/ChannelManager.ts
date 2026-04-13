import { ChannelType, type Instance } from "api-server-api";
import { on } from "../../../events.js";
import { isSlackConnected, type SlackConnected } from "../../agents/index.js";
import { isSlackDisconnected, type SlackDisconnected } from "../../agents/index.js";
import type { SlackWorker } from "../infrastructure/slack.js";

export interface ChannelManager {
  availableChannels(): Partial<Record<ChannelType, boolean>>;
  bootstrap(instances: Instance[]): void;
  stopAll(): Promise<void>;
}

export function createChannelManager(deps: {
  slackWorker?: SlackWorker;
}): ChannelManager {
  const workers = [deps.slackWorker].filter(Boolean) as SlackWorker[];

  on("SlackConnected", (event) => {
    if (!isSlackConnected(event)) return;
    const worker = deps.slackWorker;
    if (worker) worker.start(event.instanceId, { type: ChannelType.Slack, botToken: event.botToken });
  });

  on("SlackDisconnected", (event) => {
    if (!isSlackDisconnected(event)) return;
    for (const w of workers) w.stop(event.instanceId);
  });

  return {
    availableChannels() {
      return Object.fromEntries(workers.map(w => [w.type, true]));
    },

    bootstrap(instances: Instance[]) {
      for (const inst of instances) {
        for (const channel of inst.spec.channels ?? []) {
          const worker = workers.find(w => w.type === channel.type);
          if (worker) worker.start(inst.id, channel);
        }
      }
    },

    async stopAll() {
      await Promise.all(workers.map(w => w.stopAll()));
    },
  };
}
