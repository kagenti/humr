import { App, LogLevel, type SlackEventMiddlewareArgs } from "@slack/bolt";
import { ChannelType, SessionType, type ChannelConfig, type SlackChannel, type InstancesService } from "api-server-api";
import { createAcpClient, ensureRunning } from "../../../acp-client.js";

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

export function createSlackWorker(
  namespace: string,
  botToken: string,
  appToken: string,
  instances: () => InstancesService,
  persistSession: (sessionId: string, instanceId: string, type: SessionType) => Promise<void>,
): SlackWorker {
  const channelMap = new Map<string, Set<string>>();
  const instanceChannels = new Map<string, Set<string>>();
  const threadRoutes = new Map<string, string>();

  let app: BoltApp | null = null;

  function registerMapping(slackChannelId: string, instanceName: string) {
    let instances = channelMap.get(slackChannelId);
    if (!instances) {
      instances = new Set();
      channelMap.set(slackChannelId, instances);
    }
    instances.add(instanceName);

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
      const instances = channelMap.get(ch);
      if (instances) {
        instances.delete(instanceName);
        if (instances.size === 0) channelMap.delete(ch);
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

    const instances = channelMap.get(channel);
    if (!instances || instances.size === 0) return null;
    if (instances.size === 1) return [...instances][0];
    return null;
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

    app.error(async (error) => {
      process.stderr.write(`[slack] Bolt error: ${error}\n`);
    });

    await app.start();
    process.stderr.write("Slack bot started (single app)\n");
    return app;
  }

  async function handleAppMention({ event }: SlackEventMiddlewareArgs<"app_mention">) {
    if (!app) return;

    const threadTs = event.thread_ts ?? event.ts;
    const instanceName = resolveInstance(event.channel, event.thread_ts);

    if (!instanceName) {
      const user = event.user;
      if (!user) return;

      const instances = channelMap.get(event.channel);
      if (!instances || instances.size === 0) {
        await app.client.chat.postEphemeral({
          channel: event.channel,
          user,
          text: "No instance connected to this channel.",
        });
        return;
      }

      await app.client.chat.postEphemeral({
        channel: event.channel,
        user,
        text: `Multiple instances connected to this channel (${[...instances].join(", ")}). Multi-instance routing coming soon.`,
      });
      return;
    }

    threadRoutes.set(threadTs, instanceName);

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
      await ensureRunning(instances(), instanceName);
      const acp = createAcpClient({
        namespace,
        instanceName,
        onSessionCreated: (sid) => persistSession(sid, instanceName, SessionType.ChannelSlack),
      });
      const response = await acp.sendPrompt(prompt);
      await app.client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: response || "(no response)",
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: response || "(no response)" } },
          { type: "context", elements: [{ type: "mrkdwn", text: `_${instanceName}_` }] },
        ],
      });
    } catch (err) {
      process.stderr.write(`[${instanceName}] ACP error: ${err}\n`);
      await app.client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
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
      if (app) {
        await app.stop();
        app = null;
      }
    },
  };
}
