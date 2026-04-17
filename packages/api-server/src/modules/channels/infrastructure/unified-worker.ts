import { ChannelType, SessionType, type InstancesService } from "api-server-api";
import { createAcpClient, ensureRunning } from "../../../acp-client.js";
import type { IdentityLinkService } from "../services/identity-link-service.js";
import type { StoredChannelConfig, StoredUnifiedChannel } from "../domain/stored-channel-config.js";
import type { ChatAdapter } from "./chat-adapter.js";
import { createSlackAdapter } from "./slack-adapter.js";
import { createTelegramAdapter } from "./telegram-adapter.js";
import { createOAuthHelper, type PendingOAuthFlow } from "../../../auth/identity-oauth.js";

export interface UnifiedWorker {
  type: ChannelType.Unified;
  start(instanceName: string, channel: StoredChannelConfig): Promise<void>;
  stop(instanceName: string): Promise<void>;
  stopAll(): Promise<void>;
  postMessage(instanceName: string, text: string): Promise<{ ok: true } | { error: string }>;
}

interface RunningAdapter {
  adapter: ChatAdapter;
  backend: "slack" | "telegram";
}

function buildAdapter(channel: StoredUnifiedChannel): ChatAdapter | null {
  if (channel.backend === "slack") {
    if (!channel.slackBotToken || !channel.slackAppToken || !channel.slackChannelId) return null;
    return createSlackAdapter({
      botToken: channel.slackBotToken,
      appToken: channel.slackAppToken,
      channelId: channel.slackChannelId,
    });
  }
  if (!channel.telegramBotToken || !channel.telegramChatId) return null;
  return createTelegramAdapter({
    botToken: channel.telegramBotToken,
    chatId: channel.telegramChatId,
  });
}

export function createUnifiedWorker(
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
): UnifiedWorker {
  const running = new Map<string, RunningAdapter>();

  function makeOAuth(provider: "slack" | "telegram") {
    return createOAuthHelper({
      provider,
      pending: pendingOAuthFlows,
      identityLinks,
      keycloakExternalUrl: oauthConfig.keycloakExternalUrl,
      keycloakUrl: oauthConfig.keycloakExternalUrl,
      keycloakRealm: oauthConfig.keycloakRealm,
      keycloakClientId: oauthConfig.keycloakClientId,
      callbackUrl: oauthConfig.callbackUrl,
    });
  }

  return {
    type: ChannelType.Unified,

    async start(instanceName: string, channel: StoredChannelConfig) {
      if (channel.type !== ChannelType.Unified) return;
      const existing = running.get(instanceName);
      if (existing) {
        try { await existing.adapter.stop(); } catch {}
        running.delete(instanceName);
      }

      const adapter = buildAdapter(channel);
      if (!adapter) {
        process.stderr.write(`[unified:${instanceName}] incomplete config for backend=${channel.backend}\n`);
        return;
      }

      const oauth = makeOAuth(channel.backend);

      await adapter.start(async (msg) => {
        const text = msg.text.trim();

        if (text === "/login") {
          const existing = await identityLinks.resolve(channel.backend, msg.externalUserId);
          if (existing) {
            await msg.reply("You are already linked. Send /logout to unlink.");
            return;
          }
          const url = oauth.buildLoginUrl(msg.externalUserId);
          await msg.reply(`Click to link your account: ${url}`);
          return;
        }

        if (text === "/logout") {
          const existing = await identityLinks.resolve(channel.backend, msg.externalUserId);
          if (!existing) {
            await msg.reply("You don't have a linked account.");
            return;
          }
          await identityLinks.unlink(channel.backend, msg.externalUserId);
          await msg.reply("Account unlinked.");
          return;
        }

        const keycloakSub = await identityLinks.resolve(channel.backend, msg.externalUserId);
        if (!keycloakSub) {
          await msg.reply("Link your account first: send /login");
          return;
        }

        const instance = await instances().get(instanceName);
        if (instance && instance.allowedUsers.length > 0 && !instance.allowedUsers.includes(keycloakSub)) {
          await msg.reply("You don't have access to this instance.");
          return;
        }

        try {
          await ensureRunning(instances(), instanceName);
          const acp = createAcpClient({
            namespace,
            instanceName,
            onSessionCreated: (sid) => persistSession(sid, instanceName, SessionType.ChannelUnified),
          });
          const response = await acp.sendPrompt(msg.text);
          await msg.reply(response || "(no response)");
        } catch (err) {
          process.stderr.write(`[unified:${instanceName}] ACP error: ${err}\n`);
          await msg.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      running.set(instanceName, { adapter, backend: channel.backend });
      process.stderr.write(`[unified] registered ${instanceName} via ${channel.backend}\n`);
    },

    async stop(instanceName: string) {
      const r = running.get(instanceName);
      if (!r) return;
      try { await r.adapter.stop(); } catch {}
      running.delete(instanceName);
      process.stderr.write(`[unified] unregistered ${instanceName}\n`);
    },

    async stopAll() {
      for (const [, r] of running) {
        try { await r.adapter.stop(); } catch {}
      }
      running.clear();
    },

    async postMessage(instanceName: string, text: string) {
      const r = running.get(instanceName);
      if (!r) return { error: "no unified channel running for instance" };
      try {
        await r.adapter.sendMessage(text);
        return { ok: true as const };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
