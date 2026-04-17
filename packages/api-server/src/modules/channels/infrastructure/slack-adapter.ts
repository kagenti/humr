import { App, LogLevel } from "@slack/bolt";
import type { ChatAdapter, InboundMessage } from "./chat-adapter.js";

type BoltApp = InstanceType<typeof App>;

export interface SlackAdapterOpts {
  botToken: string;
  appToken: string;
  channelId: string;
}

export function createSlackAdapter(opts: SlackAdapterOpts): ChatAdapter {
  let app: BoltApp | null = null;

  return {
    provider: "slack",

    async start(onMessage) {
      const bolt = new App({
        token: opts.botToken,
        appToken: opts.appToken,
        socketMode: true,
        logLevel: LogLevel.WARN,
      });

      bolt.event("app_mention", async ({ event, client }) => {
        if (event.channel !== opts.channelId) return;
        const externalUserId = event.user;
        if (!externalUserId) return;
        const text = event.text ?? "";
        const threadTs = event.thread_ts ?? event.ts;

        const msg: InboundMessage = {
          externalUserId,
          text,
          reply: async (reply) => {
            await client.chat.postMessage({
              channel: event.channel,
              thread_ts: threadTs,
              text: reply,
            });
          },
        };
        await onMessage(msg);
      });

      bolt.error(async (err) => {
        process.stderr.write(`[unified-slack] bolt error: ${err}\n`);
      });

      await bolt.start();
      app = bolt;
    },

    async stop() {
      if (app) {
        try { await app.stop(); } catch {}
        app = null;
      }
    },

    async sendMessage(text: string) {
      if (!app) throw new Error("slack adapter not started");
      await app.client.chat.postMessage({ channel: opts.channelId, text });
    },
  };
}
