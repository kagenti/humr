import { App, LogLevel, type SlackEventMiddlewareArgs } from "@slack/bolt";
import { ChannelType, type ChannelConfig, type SlackChannel } from "api-server-api";
import type { ChannelManager } from "./channel-manager.js";
import { sendPrompt } from "../acp-client.js";

type BoltApp = InstanceType<typeof App>;

async function getContextMessages(
  app: BoltApp,
  channel: string,
  ts: string,
  threadTs?: string,
): Promise<string[]> {
  if (threadTs) {
    const replies = await app.client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 50,
    });
    return (replies.messages ?? [])
      .filter((m) => m.ts !== ts)
      .map((m) => `${m.user ?? "unknown"}: ${m.text}`);
  }

  const history = await app.client.conversations.history({
    channel,
    limit: 10,
  });
  return (history.messages ?? [])
    .filter((m) => m.ts !== ts)
    .reverse()
    .map((m) => `${m.user ?? "unknown"}: ${m.text}`);
}

export function createSlackChannelManager(namespace: string, appToken: string): ChannelManager {
  const bots = new Map<string, BoltApp>();

  return {
    type: ChannelType.Slack,

    async start(instanceName: string, channel: ChannelConfig) {
      if (bots.has(instanceName)) await this.stop(instanceName);
      const { botToken } = channel as SlackChannel;

      const app = new App({
        token: botToken,
        appToken,
        socketMode: true,
        logLevel: LogLevel.DEBUG,
      });

      async function handleAppMention({ event }: SlackEventMiddlewareArgs<"app_mention">) {
        console.log("app_mention received", { user: event.user, channel: event.channel, ts: event.ts, thread_ts: event.thread_ts });

        await app.client.reactions.add({
          channel: event.channel,
          timestamp: event.ts,
          name: "eyes",
        });

        const contextMessages = await getContextMessages(
          app,
          event.channel,
          event.ts,
          event.thread_ts,
        );

        const parts: string[] = [];
        if (contextMessages.length > 0) {
          parts.push(`<context>\n${contextMessages.join("\n")}\n</context>`);
        }
        parts.push(event.text);
        const prompt = parts.join("\n\n");

        try {
          const response = await sendPrompt(namespace, instanceName, prompt);
          await app.client.chat.postMessage({
            channel: event.channel,
            thread_ts: event.ts,
            text: response || "(no response)",
          });
        } catch (err) {
          process.stderr.write(`[${instanceName}] ACP error: ${err}\n`);
          await app.client.chat.postMessage({
            channel: event.channel,
            thread_ts: event.ts,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      app.event("app_mention", handleAppMention);

      app.error(async (error) => {
        process.stderr.write(`[${instanceName}] Bolt error: ${error}\n`);
      });

      await app.start();
      bots.set(instanceName, app);
      process.stderr.write(
        `Slack bot started for instance "${instanceName}"\n`,
      );
    },

    async stop(instanceName: string) {
      const app = bots.get(instanceName);
      if (!app) return;
      await app.stop();
      bots.delete(instanceName);
      process.stderr.write(
        `Slack bot stopped for instance "${instanceName}"\n`,
      );
    },

    async stopAll() {
      await Promise.all([...bots.keys()].map((name) => this.stop(name)));
    },
  };
}
