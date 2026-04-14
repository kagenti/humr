import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { TemplatesService, AgentsService, InstancesService, SchedulesService } from "api-server-api";
import { createK8sClient, type K8sClient } from "./infrastructure/k8s.js";
import {
  listChannelsByOwner, listChannelsByInstance,
  upsertChannel, deleteChannelByType,
  deleteChannelsByInstanceIds,
} from "./infrastructure/channels-repository.js";
import { createTemplatesService, readTemplateSpec } from "./services/TemplatesService.js";
import { createAgentsService } from "./services/AgentsService.js";
import { createInstancesService } from "./services/InstancesService.js";
import { createSchedulesService } from "./services/SchedulesService.js";

function composeWithClient(k8s: K8sClient, owner: string, db: Db): {
  templates: TemplatesService;
  agents: AgentsService;
  instances: InstancesService;
  schedules: SchedulesService;
} {
  const agents = createAgentsService({
    k8s,
    owner,
    readTemplateSpec: readTemplateSpec({ k8s }),
  });

  return {
    templates: createTemplatesService({ k8s }),
    agents,
    instances: createInstancesService({
      k8s,
      owner,
      getAgent: (id) => agents.get(id),
      listChannelsByOwner: listChannelsByOwner(db, owner),
      listChannelsByInstance: listChannelsByInstance(db, owner),
      upsertChannel: upsertChannel(db, owner),
      deleteChannelByType: deleteChannelByType(db, owner),
      deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(db),
    }),
    schedules: createSchedulesService({ k8s, owner }),
  };
}

export function composeAgentsModule(api: k8s.CoreV1Api, namespace: string, owner: string, db: Db): {
  templates: TemplatesService;
  agents: AgentsService;
  instances: InstancesService;
  schedules: SchedulesService;
} {
  return composeWithClient(createK8sClient(api, namespace), owner, db);
}

export function composeSystemInstances(api: k8s.CoreV1Api, namespace: string, db: Db): InstancesService {
  const k8s = createK8sClient(api, namespace);

  const agents = createAgentsService({
    k8s,
    owner: "",
    readTemplateSpec: readTemplateSpec({ k8s }),
  });

  return createInstancesService({
    k8s,
    owner: undefined,
    getAgent: (id) => agents.get(id),
    listChannelsByOwner: listChannelsByOwner(db, ""),
    listChannelsByInstance: listChannelsByInstance(db, ""),
    upsertChannel: upsertChannel(db, ""),
    deleteChannelByType: deleteChannelByType(db, ""),
    deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(db),
  });
}
