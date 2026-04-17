import { Bot } from "grammy";
import type { ChatAdapter, InboundMessage } from "./chat-adapter.js";

export interface TelegramAdapterOpts {
  botToken: string;
  chatId: string;
}

export function createTelegramAdapter(opts: TelegramAdapterOpts): ChatAdapter {
  const bot = new Bot(opts.botToken);

  return {
    provider: "telegram",

    async start(onMessage) {
      bot.on("message", async (ctx) => {
        if (String(ctx.chat?.id) !== opts.chatId) return;
        const externalUserId = ctx.from?.id ? String(ctx.from.id) : null;
        const text = ctx.message?.text ?? "";
        if (!externalUserId || !text) return;
        const msg: InboundMessage = {
          externalUserId,
          text,
          reply: async (reply) => { await ctx.reply(reply); },
        };
        await onMessage(msg);
      });
      bot.catch((err) => {
        process.stderr.write(`[unified-telegram] bot error: ${err}\n`);
      });
      bot.start({ drop_pending_updates: true }).catch((err) => {
        process.stderr.write(`[unified-telegram] long-poll stopped: ${err}\n`);
      });
    },

    async stop() {
      try { await bot.stop(); } catch {}
    },

    async sendMessage(text: string) {
      await bot.api.sendMessage(opts.chatId, text);
    },
  };
}
