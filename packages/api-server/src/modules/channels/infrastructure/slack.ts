import { App, LogLevel, type SlackEventMiddlewareArgs, type SlackCommandMiddlewareArgs } from "@slack/bolt";
import crypto from "node:crypto";
import { ChannelType, SessionType, type ChannelConfig, type SlackChannel, type InstancesService } from "api-server-api";
import {
  createAcpClient,
  createForkAcpClient,
  ensureRunning,
} from "../../../acp-client.js";
import {
  EventType,
  emit as defaultEmit,
  type DomainEvent,
  type ForkFailed,
  type ForkReady,
} from "../../../events.js";
import type { IdentityLinkService } from "./../services/identity-link-service.js";

type BoltApp = InstanceType<typeof App>;

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err !== null && typeof err === "object") {
    const obj = err as { message?: unknown; code?: unknown };
    if (typeof obj.message === "string") {
      if (typeof obj.code === "number" || typeof obj.code === "string") {
        return `${obj.message} (code ${obj.code})`;
      }
      return obj.message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

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
  postMessage(instanceName: string, text: string): Promise<{ ok: true } | { error: string }>;
  onForkReady(event: ForkReady): Promise<void>;
  onForkFailed(event: ForkFailed): Promise<void>;
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

interface BufferedForeignReply {
  channel: string;
  threadTs: string;
  instanceName: string;
  slackUserId: string;
  prompt: string;
  existingSessionId?: string;
}

export function createSlackWorker(
  namespace: string,
  botToken: string,
  appToken: string,
  instances: () => InstancesService,
  persistSession: (sessionId: string, instanceId: string, type: SessionType, threadTs?: string) => Promise<void>,
  identityLinks: IdentityLinkService,
  oauthConfig: {
    keycloakExternalUrl: string;
    keycloakRealm: string;
    keycloakClientId: string;
    callbackUrl: string;
  },
  pendingOAuthFlows: Map<string, SlackOAuthPending>,
  threadSessions: {
    find: (instanceId: string, threadTs: string) => Promise<{ sessionId: string } | null>;
    findInstance: (threadTs: string) => Promise<string | null>;
    touch: (sessionId: string) => Promise<void>;
  },
  getInstanceOwner: (instanceId: string) => Promise<string | null>,
  emit: (event: DomainEvent) => void = defaultEmit,
): SlackWorker {
  const channelMap = new Map<string, Set<string>>();
  const instanceChannels = new Map<string, Set<string>>();
  const threadRoutes = new Map<string, string>();
  const pendingSelections = new Map<string, PendingSelection>();
  const foreignReplyBuffer = new Map<string, BufferedForeignReply>();

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

  async function hasAccess(instanceName: string, keycloakSub: string): Promise<boolean> {
    const [ownerSub, isAllowed] = await Promise.all([
      getInstanceOwner(instanceName),
      instances().isAllowedUser(instanceName, keycloakSub),
    ]);
    if (ownerSub !== null && ownerSub === keycloakSub) return true;
    return isAllowed;
  }

  async function filterAccessible(
    instanceNames: string[],
    keycloakSub: string,
  ): Promise<string[]> {
    const checks = await Promise.all(
      instanceNames.map(async (n) => ((await hasAccess(n, keycloakSub)) ? n : null)),
    );
    return checks.filter((n): n is string => n !== null);
  }

  async function relayOwnerTurn(ctx: {
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

    try {
      await ensureRunning(instances(), instanceName);
      const acp = createAcpClient({
        namespace,
        instanceName,
        onSessionCreated: (sid) => persistSession(sid, instanceName, SessionType.ChannelSlack, ctx.threadTs),
      });

      let response: string;
      const existing = await threadSessions.find(instanceName, ctx.threadTs);

      if (existing) {
        try {
          response = await acp.sendPrompt(ctx.text, { resumeSessionId: existing.sessionId });
          await threadSessions.touch(existing.sessionId);
        } catch {
          const prompt = await buildThreadPrompt(app, ctx);
          response = await acp.sendPrompt(prompt);
        }
      } else {
        const prompt = await buildThreadPrompt(app, ctx);
        response = await acp.sendPrompt(prompt);
      }

      await postAssistantMessage(ctx.channel, ctx.threadTs, instanceName, response);
      emit({ type: EventType.SlackTurnRelayed, replyId: ctx.eventTs });
    } catch (err) {
      process.stderr.write(`[${instanceName}] ACP error: ${err}\n`);
      await app.client.chat.postMessage({
        channel: ctx.channel,
        thread_ts: ctx.threadTs,
        text: `Error: ${formatError(err)}`,
      });
    }
  }

  async function postAssistantMessage(
    channel: string,
    threadTs: string,
    instanceName: string,
    response: string,
  ) {
    if (!app) return;
    await app.client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: response || "(no response)",
      blocks: [
        { type: "markdown", text: response || "(no response)" },
        { type: "context", elements: [{ type: "mrkdwn", text: `_${instanceName}_` }] },
      ],
    });
  }

  async function beginForeignTurn(args: {
    channel: string;
    threadTs: string;
    eventTs: string;
    slackUserId: string;
    keycloakSub: string;
    instanceName: string;
    text: string;
    hasThread: boolean;
  }) {
    if (!app) return;

    await app.client.reactions.add({
      channel: args.channel,
      timestamp: args.eventTs,
      name: "eyes",
    });

    const prompt = await buildThreadPrompt(app, {
      channel: args.channel,
      threadTs: args.threadTs,
      eventTs: args.eventTs,
      text: args.text,
      hasThread: args.hasThread,
    });
    const existing = await threadSessions.find(args.instanceName, args.threadTs);

    const replyId = args.eventTs;
    foreignReplyBuffer.set(replyId, {
      channel: args.channel,
      threadTs: args.threadTs,
      instanceName: args.instanceName,
      slackUserId: args.slackUserId,
      prompt,
      ...(existing ? { existingSessionId: existing.sessionId } : {}),
    });

    emit({
      type: EventType.ForeignReplyReceived,
      replyId,
      instanceId: args.instanceName,
      foreignSub: args.keycloakSub,
      threadTs: args.threadTs,
      ...(existing ? { sessionId: existing.sessionId } : {}),
      prompt,
      slackContext: {
        channelId: args.channel,
        userSlackId: args.slackUserId,
      },
    });
  }

  async function buildThreadPrompt(boltApp: BoltApp, ctx: {
    channel: string;
    threadTs: string;
    eventTs: string;
    text: string;
    hasThread: boolean;
  }): Promise<string> {
    const contextMessages = await getContextMessages(
      boltApp,
      ctx.channel,
      ctx.eventTs,
      ctx.hasThread ? ctx.threadTs : undefined,
    );
    const parts: string[] = [];
    if (contextMessages.length > 0) {
      parts.push(`<context>\n${contextMessages.join("\n")}\n</context>`);
    }
    parts.push(ctx.text);
    return parts.join("\n\n");
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
    let routedInstance: string | null = null;
    if (event.thread_ts) {
      routedInstance =
        threadRoutes.get(event.thread_ts) ??
        (await threadSessions.findInstance(event.thread_ts));
      if (routedInstance) threadRoutes.set(event.thread_ts, routedInstance);
    }

    if (routedInstance) {
      if (!(await hasAccess(routedInstance, keycloakSub))) {
        await app.client.chat.postEphemeral({
          channel: event.channel,
          user: slackUserId,
          text: "You don't have access to the instance handling this thread.",
        });
        return;
      }
      await routeReply({
        channel: event.channel,
        threadTs,
        eventTs: event.ts,
        text: event.text,
        hasThread: !!event.thread_ts,
        slackUserId,
        keycloakSub,
        instanceName: routedInstance,
      });
      return;
    }

    const channelInstances = [...(channelMap.get(event.channel) ?? [])];
    if (channelInstances.length === 0) {
      await app.client.chat.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        text: "No instance connected to this channel.",
      });
      return;
    }

    const accessibleInstances = await filterAccessible(channelInstances, keycloakSub);
    if (accessibleInstances.length === 0) {
      await app.client.chat.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        text: "You don't have access to any instance in this channel.",
      });
      return;
    }

    if (accessibleInstances.length === 1) {
      await routeReply({
        channel: event.channel,
        threadTs,
        eventTs: event.ts,
        text: event.text,
        hasThread: !!event.thread_ts,
        slackUserId,
        keycloakSub,
        instanceName: accessibleInstances[0],
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
      text: "Multiple instances are available. Pick one:",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Multiple instances are available. Pick one:" },
          accessory: {
            type: "static_select",
            action_id: `instance_select:${selectionId}`,
            placeholder: { type: "plain_text", text: "Choose instance" },
            options: accessibleInstances.map((name) => ({
              text: { type: "plain_text" as const, text: name },
              value: name,
            })),
          },
        },
      ],
    });
  }

  async function routeReply(args: {
    channel: string;
    threadTs: string;
    eventTs: string;
    text: string;
    hasThread: boolean;
    slackUserId: string;
    keycloakSub: string;
    instanceName: string;
  }) {
    if (!app) return;

    const [ownerSub, isAllowed] = await Promise.all([
      getInstanceOwner(args.instanceName),
      instances().isAllowedUser(args.instanceName, args.keycloakSub),
    ]);
    const isOwner = ownerSub !== null && ownerSub === args.keycloakSub;
    if (!isOwner && !isAllowed) {
      await app.client.chat.postEphemeral({
        channel: args.channel,
        user: args.slackUserId,
        text: "You don't have access to this instance. Contact the instance owner to be added to the allowed users list.",
      });
      return;
    }

    threadRoutes.set(args.threadTs, args.instanceName);

    if (!isOwner) {
      await beginForeignTurn(args);
      return;
    }

    await relayOwnerTurn({
      channel: args.channel,
      threadTs: args.threadTs,
      eventTs: args.eventTs,
      text: args.text,
      hasThread: args.hasThread,
    });
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

    await routeReply({
      channel: pending.channel,
      threadTs: pending.threadTs,
      eventTs: pending.eventTs,
      text: pending.text,
      hasThread: pending.threadTs !== pending.eventTs,
      slackUserId: body.user.id,
      keycloakSub: pending.keycloakSub,
      instanceName,
    });
  }

  let appFailed = false;

  async function ensureApp(): Promise<BoltApp | null> {
    if (app) return app;
    if (appFailed) return null;

    const bolt = new App({
      token: botToken,
      appToken,
      socketMode: true,
      logLevel: LogLevel.DEBUG,
    });

    bolt.event("app_mention", handleAppMention);
    bolt.command("/humr", handleCommand);
    bolt.action(/^instance_select:/, handleInstanceSelect as Parameters<BoltApp["action"]>[1]);

    bolt.error(async (error) => {
      process.stderr.write(`[slack] Bolt error: ${error}\n`);
    });

    try {
      await bolt.start();
    } catch (err) {
      appFailed = true;
      process.stderr.write(`[slack] Failed to start Slack bot: ${formatError(err)}\n`);
      return null;
    }

    app = bolt;
    process.stderr.write("Slack bot started (single app)\n");
    return app;
  }

  return {
    type: ChannelType.Slack,

    async start(instanceName: string, channel: ChannelConfig) {
      const { slackChannelId } = channel as SlackChannel;
      registerMapping(slackChannelId, instanceName);
      const started = await ensureApp();
      if (!started) {
        process.stderr.write(`Slack: skipping ${instanceName} — bot not connected\n`);
        return;
      }
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
      foreignReplyBuffer.clear();
      if (app) {
        await app.stop();
        app = null;
      }
    },

    async postMessage(instanceName: string, text: string) {
      const channels = instanceChannels.get(instanceName);
      if (!channels || channels.size === 0) {
        return { error: "no channel connected" };
      }

      if (!app) {
        return { error: "slack bot not running" };
      }

      const slackChannelId = [...channels][0];
      try {
        await app.client.chat.postMessage({
          channel: slackChannelId,
          text,
          blocks: [
            { type: "markdown", text },
            { type: "context", elements: [{ type: "mrkdwn", text: `_${instanceName}_` }] },
          ],
        });
        return { ok: true as const };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async onForkReady(event: ForkReady) {
      const buffered = foreignReplyBuffer.get(event.replyId);
      if (!buffered || !app) return;
      foreignReplyBuffer.delete(event.replyId);

      const { instanceName, channel, threadTs, prompt, existingSessionId } = buffered;
      try {
        const acp = createForkAcpClient({
          podIP: event.podIP,
          onSessionCreated: (sid) =>
            persistSession(sid, instanceName, SessionType.ChannelSlack, threadTs),
        });
        const response = existingSessionId
          ? await acp.sendPrompt(prompt, { resumeSessionId: existingSessionId })
          : await acp.sendPrompt(prompt);
        if (existingSessionId) await threadSessions.touch(existingSessionId);
        await postAssistantMessage(channel, threadTs, instanceName, response);
      } catch (err) {
        process.stderr.write(`[slack/fork ${event.forkId}] ACP error: ${err}\n`);
        await app.client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `Error: ${formatError(err)}`,
        });
      } finally {
        emit({
          type: EventType.SlackTurnRelayed,
          replyId: event.replyId,
          forkId: event.forkId,
        });
      }
    },

    async onForkFailed(event: ForkFailed) {
      const buffered = foreignReplyBuffer.get(event.replyId);
      if (!buffered || !app) return;
      foreignReplyBuffer.delete(event.replyId);

      const detail = event.detail ? ` (${event.detail})` : "";
      await app.client.chat.postEphemeral({
        channel: buffered.channel,
        user: buffered.slackUserId,
        text: `Could not run turn as you: ${event.reason}${detail}.`,
      });
    },
  };
}
