import { App, LogLevel, type SlackEventMiddlewareArgs, type SlackCommandMiddlewareArgs } from "@slack/bolt";
import crypto from "node:crypto";
import { ChannelType, SessionType, type ChannelConfig, type SlackChannel, type InstancesService } from "api-server-api";
import { createAcpClient, ensureRunning } from "../../../acp-client.js";
import type { IdentityLinkService } from "../services/IdentityLinkService.js";

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

export interface SlackWorker {
  type: ChannelType.Slack;
  start(instanceName: string, channel: ChannelConfig): Promise<void>;
  stop(instanceName: string): Promise<void>;
  stopAll(): Promise<void>;
}

export interface SlackOAuthPending {
  slackUserId: string;
  channelId: string;
  codeVerifier: string;
  createdAt: number;
}

interface PendingSelection {
  text: string;
  channel: string;
  slackUserId: string;
  keycloakSub: string;
  threadTs: string;
  eventTs: string;
}

export function createSlackWorker(
  namespace: string,
  botToken: string,
  appToken: string,
  instances: () => InstancesService,
  persistSession: (sessionId: string, instanceId: string, type: SessionType) => Promise<void>,
  identityLinks: IdentityLinkService,
  oauthConfig: {
    keycloakExternalUrl: string;
    keycloakRealm: string;
    keycloakClientId: string;
    callbackUrl: string;
  },
  pendingOAuthFlows: Map<string, SlackOAuthPending>,
): SlackWorker {
  const channelMap = new Map<string, Set<string>>();
  const instanceChannels = new Map<string, Set<string>>();
  const threadRoutes = new Map<string, string>();
  const pendingSelections = new Map<string, PendingSelection>();

  let app: BoltApp | null = null;

  function registerMapping(slackChannelId: string, instanceName: string) {
    let ins = channelMap.get(slackChannelId);
    if (!ins) {
      ins = new Set();
      channelMap.set(slackChannelId, ins);
    }
    ins.add(instanceName);

    let channels = instanceChannels.get(instanceName);
    if (!channels) {
      channels = new Set();
      instanceChannels.set(instanceName, channels);
    }
    channels.add(slackChannelId);
  }

  function unregisterInstance(instanceName: string) {
    const channels = instanceChannels.get(instanceName);
    if (!channels) return;
    for (const ch of channels) {
      const ins = channelMap.get(ch);
      if (ins) {
        ins.delete(instanceName);
        if (ins.size === 0) channelMap.delete(ch);
      }
    }
    instanceChannels.delete(instanceName);

    for (const [ts, name] of threadRoutes) {
      if (name === instanceName) threadRoutes.delete(ts);
    }
  }

  function resolveInstance(channel: string, threadTs?: string): string | null {
    if (threadTs) {
      const routed = threadRoutes.get(threadTs);
      if (routed) return routed;
    }

    const ins = channelMap.get(channel);
    if (!ins || ins.size === 0) return null;
    if (ins.size === 1) return [...ins][0];
    return null;
  }

  async function relayToInstance(ctx: {
    channel: string;
    threadTs: string;
    eventTs: string;
    text: string;
    hasThread: boolean;
  }) {
    if (!app) return;
    const instanceName = threadRoutes.get(ctx.threadTs);
    if (!instanceName) return;

    await app.client.reactions.add({
      channel: ctx.channel,
      timestamp: ctx.eventTs,
      name: "eyes",
    });

    const contextMessages = await getContextMessages(
      app,
      ctx.channel,
      ctx.eventTs,
      ctx.hasThread ? ctx.threadTs : undefined,
    );

    const parts: string[] = [];
    if (contextMessages.length > 0) {
      parts.push(`<context>\n${contextMessages.join("\n")}\n</context>`);
    }
    parts.push(ctx.text);
    const prompt = parts.join("\n\n");

    try {
      await ensureRunning(instances(), instanceName);
      const acp = createAcpClient({
        namespace,
        instanceName,
        onSessionCreated: (sid) => persistSession(sid, instanceName, SessionType.ChannelSlack),
      });
      const response = await acp.sendPrompt(prompt);
      await app.client.chat.postMessage({
        channel: ctx.channel,
        thread_ts: ctx.threadTs,
        text: response || "(no response)",
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: response || "(no response)" } },
          { type: "context", elements: [{ type: "mrkdwn", text: `_${instanceName}_` }] },
        ],
      });
    } catch (err) {
      process.stderr.write(`[${instanceName}] ACP error: ${err}\n`);
      await app.client.chat.postMessage({
        channel: ctx.channel,
        thread_ts: ctx.threadTs,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  function buildLoginUrl(state: string, codeChallenge: string): string {
    const authEndpoint = `${oauthConfig.keycloakExternalUrl}/realms/${oauthConfig.keycloakRealm}/protocol/openid-connect/auth`;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: oauthConfig.keycloakClientId,
      redirect_uri: oauthConfig.callbackUrl,
      state,
      scope: "openid",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `${authEndpoint}?${params}`;
  }

  async function handleCommand({ command, ack }: SlackCommandMiddlewareArgs) {
    const subcommand = command.text.trim().toLowerCase();

    if (subcommand === "login") {
      const existing = await identityLinks.resolve(command.user_id);
      if (existing) {
        await ack({ response_type: "ephemeral", text: "You are already linked. Use `/humr logout` to unlink first." });
        return;
      }

      const state = crypto.randomUUID();
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
      pendingOAuthFlows.set(state, {
        slackUserId: command.user_id,
        channelId: command.channel_id,
        codeVerifier,
        createdAt: Date.now(),
      });

      const loginUrl = buildLoginUrl(state, codeChallenge);
      await ack({
        response_type: "ephemeral",
        text: `<${loginUrl}|Click here to link your Keycloak account>`,
      });
      return;
    }

    if (subcommand === "logout") {
      const existing = await identityLinks.resolve(command.user_id);
      if (!existing) {
        await ack({ response_type: "ephemeral", text: "You don't have a linked account." });
        return;
      }

      await identityLinks.unlink(command.user_id);
      await ack({ response_type: "ephemeral", text: "Account unlinked." });
      return;
    }

    await ack({
      response_type: "ephemeral",
      text: "Usage: `/humr login` or `/humr logout`",
    });
  }

  async function handleAppMention({ event }: SlackEventMiddlewareArgs<"app_mention">) {
    if (!app) return;

    const slackUserId = event.user;
    if (!slackUserId) return;

    const keycloakSub = await identityLinks.resolve(slackUserId);
    if (!keycloakSub) {
      await app.client.chat.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        text: "You need to link your account first. Use `/humr login` to get started.",
      });
      return;
    }

    const threadTs = event.thread_ts ?? event.ts;
    const instanceName = resolveInstance(event.channel, event.thread_ts);

    if (!instanceName) {
      const ins = channelMap.get(event.channel);
      if (!ins || ins.size === 0) {
        await app.client.chat.postEphemeral({
          channel: event.channel,
          user: slackUserId,
          text: "No instance connected to this channel.",
        });
        return;
      }

      const selectionId = crypto.randomUUID();
      pendingSelections.set(selectionId, {
        text: event.text,
        channel: event.channel,
        slackUserId,
        keycloakSub,
        threadTs,
        eventTs: event.ts,
      });

      await app.client.chat.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        text: "Multiple instances are connected to this channel. Pick one:",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "Multiple instances are connected to this channel. Pick one:" },
            accessory: {
              type: "static_select",
              action_id: `instance_select:${selectionId}`,
              placeholder: { type: "plain_text", text: "Choose instance" },
              options: [...ins].map((name) => ({
                text: { type: "plain_text" as const, text: name },
                value: name,
              })),
            },
          },
        ],
      });
      return;
    }

    const instance = await instances().get(instanceName);
    if (instance && instance.allowedUsers.length > 0 && !instance.allowedUsers.includes(keycloakSub)) {
      await app.client.chat.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        text: "You don't have access to this instance. Contact the instance owner to be added to the allowed users list.",
      });
      return;
    }

    threadRoutes.set(threadTs, instanceName);
    await relayToInstance({ channel: event.channel, threadTs, eventTs: event.ts, text: event.text, hasThread: !!event.thread_ts });
  }

  async function handleInstanceSelect({ action, ack, body }: {
    action: { action_id: string; selected_option?: { value: string } };
    ack: () => Promise<void>;
    body: { user: { id: string } };
  }) {
    await ack();
    if (!app) return;

    const selectionId = action.action_id.replace("instance_select:", "");
    const pending = pendingSelections.get(selectionId);
    pendingSelections.delete(selectionId);

    if (!pending || !action.selected_option) return;

    const instanceName = action.selected_option.value;
    const instance = await instances().get(instanceName);
    if (instance && instance.allowedUsers.length > 0 && !instance.allowedUsers.includes(pending.keycloakSub)) {
      await app.client.chat.postEphemeral({
        channel: pending.channel,
        user: body.user.id,
        text: "You don't have access to this instance. Contact the instance owner to be added to the allowed users list.",
      });
      return;
    }

    threadRoutes.set(pending.threadTs, instanceName);
    await relayToInstance({
      channel: pending.channel,
      threadTs: pending.threadTs,
      eventTs: pending.eventTs,
      text: pending.text,
      hasThread: pending.threadTs !== pending.eventTs,
    });
  }

  async function ensureApp(): Promise<BoltApp> {
    if (app) return app;

    app = new App({
      token: botToken,
      appToken,
      socketMode: true,
      logLevel: LogLevel.DEBUG,
    });

    app.event("app_mention", handleAppMention);
    app.command("/humr", handleCommand);
    app.action(/^instance_select:/, handleInstanceSelect as Parameters<BoltApp["action"]>[1]);

    app.error(async (error) => {
      process.stderr.write(`[slack] Bolt error: ${error}\n`);
    });

    await app.start();
    process.stderr.write("Slack bot started (single app)\n");
    return app;
  }

  return {
    type: ChannelType.Slack,

    async start(instanceName: string, channel: ChannelConfig) {
      const { slackChannelId } = channel as SlackChannel;
      registerMapping(slackChannelId, instanceName);
      await ensureApp();
      process.stderr.write(`Slack: registered ${instanceName} → channel ${slackChannelId}\n`);
    },

    async stop(instanceName: string) {
      unregisterInstance(instanceName);
      process.stderr.write(`Slack: unregistered ${instanceName}\n`);
    },

    async stopAll() {
      channelMap.clear();
      instanceChannels.clear();
      threadRoutes.clear();
      pendingSelections.clear();
      if (app) {
        await app.stop();
        app = null;
      }
    },
  };
}
