import { ChannelType, type Instance } from "api-server-api";
import type { Subscription } from "rxjs";
import { events$, ofType, type SlackConnected, type SlackDisconnected } from "../../../events.js";
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
  const subscriptions: Subscription[] = [];

  subscriptions.push(
    events$().pipe(ofType<SlackConnected>("SlackConnected")).subscribe((event) => {
      if (deps.slackWorker) {
        deps.slackWorker.start(event.instanceId, { type: ChannelType.Slack, botToken: event.botToken });
      }
    }),
  );

  subscriptions.push(
    events$().pipe(ofType<SlackDisconnected>("SlackDisconnected")).subscribe((event) => {
      for (const w of workers) w.stop(event.instanceId);
    }),
  );

  // Also disconnect Slack bots when an instance is deleted
  subscriptions.push(
    events$().pipe(ofType("InstanceDeleted")).subscribe((event) => {
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
  };
}
