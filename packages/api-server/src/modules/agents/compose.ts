import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { TemplatesService, AgentsService, InstancesService, SchedulesService } from "api-server-api";
import {
  listTemplates, getTemplate, readTemplateSpec,
  listAgents, getAgent, createAgent, updateAgentSpec, deleteAgent,
  listInstances, getInstance, createInstance, updateInstanceSpec, deleteInstance, wakeInstance,
  listSchedules, getSchedule, createSchedule, deleteSchedule, toggleSchedule,
  readAgentRef,
} from "./infrastructure/k8s.js";
import {
  listChannelsByOwner, listChannelsByInstance,
  upsertChannel, deleteChannelsByInstance, deleteChannelByType,
  allChannelInstanceIds, deleteChannelsByInstanceIds,
} from "./infrastructure/channels-repository.js";
import { createTemplatesService } from "./services/TemplatesService.js";
import { createAgentsService } from "./services/AgentsService.js";
import { createInstancesService } from "./services/InstancesService.js";
import { createSchedulesService } from "./services/SchedulesService.js";

export function composeAgentsModule(api: k8s.CoreV1Api, namespace: string, owner: string, db: Db): {
  templates: TemplatesService;
  agents: AgentsService;
  instances: InstancesService;
  schedules: SchedulesService;
} {
  return {
    templates: createTemplatesService({
      list: listTemplates(api, namespace),
      get: getTemplate(api, namespace),
    }),
    agents: createAgentsService({
      list: listAgents(api, namespace, owner),
      get: getAgent(api, namespace, owner),
      create: createAgent(api, namespace, owner),
      update: updateAgentSpec(api, namespace, owner),
      delete: deleteAgent(api, namespace, owner),
      readTemplateSpec: readTemplateSpec(api, namespace),
    }),
    instances: createInstancesService({
      list: listInstances(api, namespace, owner),
      get: getInstance(api, namespace, owner),
      create: createInstance(api, namespace, owner),
      update: updateInstanceSpec(api, namespace, owner),
      delete: deleteInstance(api, namespace, owner),
      wake: wakeInstance(api, namespace),
      getAgent: getAgent(api, namespace, owner),
      listChannelsByOwner: listChannelsByOwner(db, owner),
      listChannelsByInstance: listChannelsByInstance(db, owner),
      upsertChannel: upsertChannel(db, owner),
      deleteChannelsByInstance: deleteChannelsByInstance(db),
      deleteChannelByType: deleteChannelByType(db, owner),
      allChannelInstanceIds: allChannelInstanceIds(db),
      deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(db),
    }),
    schedules: createSchedulesService({
      list: listSchedules(api, namespace, owner),
      get: getSchedule(api, namespace, owner),
      create: createSchedule(api, namespace, owner),
      delete: deleteSchedule(api, namespace, owner),
      toggle: toggleSchedule(api, namespace, owner),
      readAgentRef: readAgentRef(api, namespace, owner),
    }),
  };
}

export function composeSystemInstances(api: k8s.CoreV1Api, namespace: string, db: Db): InstancesService {
  return createInstancesService({
    list: listInstances(api, namespace),
    get: getInstance(api, namespace),
    create: createInstance(api, namespace, ""),
    update: updateInstanceSpec(api, namespace, ""),
    delete: deleteInstance(api, namespace, ""),
    wake: wakeInstance(api, namespace),
    getAgent: getAgent(api, namespace, ""),
    listChannelsByOwner: listChannelsByOwner(db, ""),
    listChannelsByInstance: listChannelsByInstance(db, ""),
    upsertChannel: upsertChannel(db, ""),
    deleteChannelsByInstance: deleteChannelsByInstance(db),
    deleteChannelByType: deleteChannelByType(db, ""),
    allChannelInstanceIds: allChannelInstanceIds(db),
    deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(db),
  });
}
