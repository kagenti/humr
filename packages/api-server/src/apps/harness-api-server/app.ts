import { serve } from "@hono/node-server";
import type { CoreV1Api } from "@kubernetes/client-node";
import type { Db } from "db";
import { createK8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { composeAgentsModule } from "../../modules/agents/index.js";
import { createAcpClient } from "../../acp-client.js";
import { createHarnessRouter } from "./harness-router.js";
import type { Config } from "../../config.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";

export interface HarnessApiServerAppDeps {
  config: Config;
  api: CoreV1Api;
  db: Db;
  channelManager: ChannelManager;
}

export function startHarnessApiServerApp(deps: HarnessApiServerAppDeps) {
  const { config, api, db, channelManager } = deps;

  const k8sClient = createK8sClient(api, config.namespace);

  const app = createHarnessRouter({
    channelManager,
    k8s: k8sClient,
    schedulesServiceFor: (owner: string) => composeAgentsModule(api, config.namespace, owner, db).schedules,
    handleTrigger: async (body) => {
      const mode = body.sessionMode ?? "fresh";
      const sessionType = "schedule_cron";
      const { sessions } = composeAgentsModule(api, config.namespace, "_system", db);

      let resumeSessionId: string | undefined;
      if (mode === "continuous") {
        const found = await sessions.findByScheduleId(body.schedule);
        resumeSessionId = found?.sessionId;
      }

      const acp = createAcpClient({
        namespace: config.namespace,
        instanceName: body.instanceId,
        onSessionCreated: (sid: string) => sessions.create(sid, body.instanceId, sessionType as any, body.schedule),
      });

      return acp.triggerSession({
        prompt: body.task,
        resumeSessionId,
        mcpServers: body.mcpServers,
      });
    },
  });

  const server = serve({ fetch: app.fetch, port: config.harnessServerPort }, () => {
    process.stderr.write(`harness-api listening on http://localhost:${config.harnessServerPort}\n`);
  });

  return { server };
}
