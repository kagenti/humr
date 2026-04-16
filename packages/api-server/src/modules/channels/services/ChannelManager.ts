import { ChannelType, type Instance } from "api-server-api";
import type { Subscription } from "rxjs";
import { events$, ofType, EventType, type SlackConnected, type SlackDisconnected, type InstanceDeleted } from "../../../events.js";
import type { SlackWorker } from "../infrastructure/slack.js";

export interface ChannelManager {
  availableChannels(): Partial<Record<ChannelType, boolean>>;
  bootstrap(instances: Instance[]): void;
  stopAll(): Promise<void>;
  postMessage(instanceName: string, text: string): Promise<{ ok: true } | { error: string }>;
}

export function createChannelManager(deps: {
  slackWorker?: SlackWorker;
}): ChannelManager {
  const { slackWorker } = deps;
  const workers = [slackWorker].filter(Boolean) as SlackWorker[];
  const subscriptions: Subscription[] = [];

  subscriptions.push(
    events$().pipe(ofType<SlackConnected>(EventType.SlackConnected)).subscribe((event) => {
      if (deps.slackWorker) {
        deps.slackWorker.start(event.instanceId, { type: ChannelType.Slack, slackChannelId: event.slackChannelId });
      }
    }),
  );

  subscriptions.push(
    events$().pipe(ofType<SlackDisconnected>(EventType.SlackDisconnected)).subscribe((event) => {
      for (const w of workers) w.stop(event.instanceId);
    }),
  );

  // Also disconnect Slack bots when an instance is deleted
  subscriptions.push(
    events$().pipe(ofType<InstanceDeleted>(EventType.InstanceDeleted)).subscribe((event) => {
      for (const w of workers) w.stop(event.instanceId);
    }),
  );

  return {
    availableChannels() {
      return Object.fromEntries(workers.map(w => [w.type, true]));
    },

    bootstrap(instances: Instance[]) {
      for (const inst of instances) {
        for (const channel of inst.channels) {
          const worker = workers.find(w => w.type === channel.type);
          if (worker) worker.start(inst.id, channel);
        }
      }
    },

    async stopAll() {
      for (const sub of subscriptions) sub.unsubscribe();
      await Promise.all(workers.map(w => w.stopAll()));
    },

    async postMessage(instanceName: string, text: string) {
      if (!slackWorker) {
        return { error: "no channel workers configured" };
      }
      return slackWorker.postMessage(instanceName, text);
    },
  };
}
