import { ChannelType, type Instance } from "api-server-api";
import type { Subscription } from "rxjs";
import {
  events$, ofType, EventType,
  type SlackConnected, type SlackDisconnected,
  type TelegramConnected, type TelegramDisconnected,
  type UnifiedConnected, type UnifiedDisconnected,
  type InstanceDeleted,
} from "../../../events.js";
import type { SlackWorker } from "../infrastructure/slack.js";
import type { TelegramWorker } from "../infrastructure/telegram.js";
import type { UnifiedWorker } from "../infrastructure/unified-worker.js";
import type { StoredChannelConfig } from "../domain/stored-channel-config.js";

export type ChannelWorker = SlackWorker | TelegramWorker | UnifiedWorker;

export interface ChannelManager {
  availableChannels(): Partial<Record<ChannelType, boolean>>;
  bootstrap(instances: Instance[]): Promise<void>;
  stopAll(): Promise<void>;
  postMessage(instanceName: string, text: string): Promise<{ ok: true } | { error: string }>;
}

export function createChannelManager(deps: {
  slackWorker?: SlackWorker;
  telegramWorker?: TelegramWorker;
  unifiedWorker?: UnifiedWorker;
  fetchChannels: (instanceId: string) => Promise<StoredChannelConfig[]>;
}): ChannelManager {
  const { slackWorker, telegramWorker, unifiedWorker, fetchChannels } = deps;
  const workers = [slackWorker, telegramWorker, unifiedWorker].filter(Boolean) as ChannelWorker[];
  const subscriptions: Subscription[] = [];

  async function startFor(instanceId: string, type: ChannelType) {
    const worker = workers.find(w => w.type === type);
    if (!worker) return;
    const stored = await fetchChannels(instanceId);
    const match = stored.find(s => s.type === type);
    if (!match) return;
    await worker.start(instanceId, match);
  }

  subscriptions.push(
    events$().pipe(ofType<SlackConnected>(EventType.SlackConnected)).subscribe((event) => {
      startFor(event.instanceId, ChannelType.Slack).catch(() => {});
    }),
  );
  subscriptions.push(
    events$().pipe(ofType<SlackDisconnected>(EventType.SlackDisconnected)).subscribe((event) => {
      slackWorker?.stop(event.instanceId);
    }),
  );

  subscriptions.push(
    events$().pipe(ofType<TelegramConnected>(EventType.TelegramConnected)).subscribe((event) => {
      startFor(event.instanceId, ChannelType.Telegram).catch(() => {});
    }),
  );
  subscriptions.push(
    events$().pipe(ofType<TelegramDisconnected>(EventType.TelegramDisconnected)).subscribe((event) => {
      telegramWorker?.stop(event.instanceId);
    }),
  );

  subscriptions.push(
    events$().pipe(ofType<UnifiedConnected>(EventType.UnifiedConnected)).subscribe((event) => {
      startFor(event.instanceId, ChannelType.Unified).catch(() => {});
    }),
  );
  subscriptions.push(
    events$().pipe(ofType<UnifiedDisconnected>(EventType.UnifiedDisconnected)).subscribe((event) => {
      unifiedWorker?.stop(event.instanceId);
    }),
  );

  subscriptions.push(
    events$().pipe(ofType<InstanceDeleted>(EventType.InstanceDeleted)).subscribe((event) => {
      for (const w of workers) w.stop(event.instanceId).catch(() => {});
    }),
  );

  return {
    availableChannels() {
      const out: Partial<Record<ChannelType, boolean>> = {};
      for (const w of workers) out[w.type] = true;
      return out;
    },

    async bootstrap(instances: Instance[]) {
      for (const inst of instances) {
        if (inst.channels.length === 0) continue;
        const stored = await fetchChannels(inst.id);
        for (const sc of stored) {
          const worker = workers.find(w => w.type === sc.type);
          if (worker) worker.start(inst.id, sc).catch(() => {});
        }
      }
    },

    async stopAll() {
      for (const sub of subscriptions) sub.unsubscribe();
      await Promise.all(workers.map(w => w.stopAll()));
    },

    async postMessage(instanceName: string, text: string) {
      const stored = await fetchChannels(instanceName);
      if (stored.length === 0) return { error: "no channel connected" };
      for (const sc of stored) {
        const worker = workers.find(w => w.type === sc.type);
        if (worker) return worker.postMessage(instanceName, text);
      }
      return { error: "no worker available for connected channel type" };
    },
  };
}
