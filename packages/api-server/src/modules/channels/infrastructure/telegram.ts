import { Bot, type Context } from "grammy";
import { ChannelType, SessionType, type InstancesService } from "api-server-api";
import { createAcpClient, ensureRunning } from "../../../acp-client.js";
import type { IdentityLinkService } from "../services/identity-link-service.js";
import type { StoredChannelConfig, StoredTelegramChannel } from "../domain/stored-channel-config.js";
import { createOAuthHelper, type PendingOAuthFlow } from "../../../auth/identity-oauth.js";

export interface TelegramWorker {
  type: ChannelType.Telegram;
  start(instanceName: string, channel: StoredChannelConfig): Promise<void>;
  stop(instanceName: string): Promise<void>;
  stopAll(): Promise<void>;
  postMessage(instanceName: string, text: string): Promise<{ ok: true } | { error: string }>;
}

interface RunningBot {
  bot: Bot;
  chatId: string;
}

export function createTelegramWorker(
  namespace: string,
  instances: () => InstancesService,
  persistSession: (sessionId: string, instanceId: string, type: SessionType) => Promise<void>,
  identityLinks: IdentityLinkService,
  oauthConfig: {
    keycloakExternalUrl: string;
    keycloakRealm: string;
    keycloakClientId: string;
    callbackUrl: string;
  },
  pendingOAuthFlows: Map<string, PendingOAuthFlow>,
): TelegramWorker {
  const bots = new Map<string, RunningBot>();

  const oauth = createOAuthHelper({
    provider: "telegram",
    pending: pendingOAuthFlows,
    identityLinks,
    keycloakExternalUrl: oauthConfig.keycloakExternalUrl,
    keycloakUrl: oauthConfig.keycloakExternalUrl,
    keycloakRealm: oauthConfig.keycloakRealm,
    keycloakClientId: oauthConfig.keycloakClientId,
    callbackUrl: oauthConfig.callbackUrl,
  });

  async function handleMessage(instanceName: string, chatId: string, ctx: Context) {
    if (String(ctx.chat?.id) !== chatId) return;
    const telegramUserId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!telegramUserId) return;
    const text = ctx.message?.text ?? "";

    if (text.trim() === "/login") {
      const existing = await identityLinks.resolve("telegram", telegramUserId);
      if (existing) {
        await ctx.reply("You are already linked. Send /logout to unlink.");
        return;
      }
      const url = oauth.buildLoginUrl(telegramUserId);
      await ctx.reply(`Click to link your account: ${url}`);
      return;
    }

    if (text.trim() === "/logout") {
      const existing = await identityLinks.resolve("telegram", telegramUserId);
      if (!existing) {
        await ctx.reply("You don't have a linked account.");
        return;
      }
      await identityLinks.unlink("telegram", telegramUserId);
      await ctx.reply("Account unlinked.");
      return;
    }

    const keycloakSub = await identityLinks.resolve("telegram", telegramUserId);
    if (!keycloakSub) {
      await ctx.reply("Link your account first: send /login");
      return;
    }

    const instance = await instances().get(instanceName);
    if (instance && instance.allowedUsers.length > 0 && !instance.allowedUsers.includes(keycloakSub)) {
      await ctx.reply("You don't have access to this instance.");
      return;
    }

    try {
      await ensureRunning(instances(), instanceName);
      const acp = createAcpClient({
        namespace,
        instanceName,
        onSessionCreated: (sid) => persistSession(sid, instanceName, SessionType.ChannelTelegram),
      });
      const response = await acp.sendPrompt(text);
      await ctx.reply(response || "(no response)");
    } catch (err) {
      process.stderr.write(`[telegram:${instanceName}] ACP error: ${err}\n`);
      await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    type: ChannelType.Telegram,

    async start(instanceName: string, channel: StoredChannelConfig) {
      if (channel.type !== ChannelType.Telegram) return;
      const tg = channel as StoredTelegramChannel;

      const existing = bots.get(instanceName);
      if (existing) {
        try { await existing.bot.stop(); } catch {}
        bots.delete(instanceName);
      }

      const bot = new Bot(tg.botToken);
      bot.on("message", (ctx) => handleMessage(instanceName, tg.telegramChatId, ctx));
      bot.catch((err) => {
        process.stderr.write(`[telegram:${instanceName}] bot error: ${err}\n`);
      });

      // start() blocks on long-polling; fire-and-forget
      bot.start({ drop_pending_updates: true }).catch((err) => {
        process.stderr.write(`[telegram:${instanceName}] long-poll stopped: ${err}\n`);
      });

      bots.set(instanceName, { bot, chatId: tg.telegramChatId });
      process.stderr.write(`[telegram] registered ${instanceName} → chat ${tg.telegramChatId}\n`);
    },

    async stop(instanceName: string) {
      const running = bots.get(instanceName);
      if (!running) return;
      try { await running.bot.stop(); } catch {}
      bots.delete(instanceName);
      process.stderr.write(`[telegram] unregistered ${instanceName}\n`);
    },

    async stopAll() {
      for (const [, running] of bots) {
        try { await running.bot.stop(); } catch {}
      }
      bots.clear();
    },

    async postMessage(instanceName: string, text: string) {
      const running = bots.get(instanceName);
      if (!running) return { error: "no telegram bot running for instance" };
      try {
        await running.bot.api.sendMessage(running.chatId, text);
        return { ok: true as const };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
