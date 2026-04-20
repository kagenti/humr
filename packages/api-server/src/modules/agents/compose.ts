import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { TemplatesService, AgentsService, InstancesService, SchedulesService, SessionsApiService } from "api-server-api";
import { createK8sClient } from "./infrastructure/k8s.js";
import { createTemplatesRepository } from "./infrastructure/templates-repository.js";
import { createAgentsRepository } from "./infrastructure/agents-repository.js";
import { createInstancesRepository } from "./infrastructure/instances-repository.js";
import { createSchedulesRepository } from "./infrastructure/schedules-repository.js";
import {
  listChannelsByOwner, listChannelsByInstance,
  upsertChannel, deleteChannelByType,
  deleteChannelsByInstanceIds,
} from "./infrastructure/channels-repository.js";
import {
  listAllowedUsersByOwner, listAllowedUsersByInstance,
  setAllowedUsers, deleteAllowedUsersByInstanceIds,
} from "./infrastructure/allowed-users-repository.js";
import { listSessionsByInstance, listSessionsByScheduleId, findActiveByScheduleId, deactivateByScheduleId, upsertSession, deleteSession } from "./infrastructure/sessions-repository.js";
import { createTemplatesService } from "./services/templates-service.js";
import { createAgentsService } from "./services/agents-service.js";
import { createInstancesService } from "./services/instances-service.js";
import { createSchedulesService } from "./services/schedules-service.js";
import { createSessionsService } from "./services/sessions-service.js";
import { createAgentProvisioner } from "./infrastructure/agent-provisioner.js";
import { createInstanceProvisioner } from "./infrastructure/instance-provisioner.js";
import type { OnecliClient } from "../../onecli.js";

export function composeAgentsModule(
  api: k8s.CoreV1Api,
  namespace: string,
  owner: string,
  db: Db,
  opts?: { onecli?: OnecliClient; userJwt?: string; batchApi?: k8s.BatchV1Api; networkingApi?: k8s.NetworkingV1Api },
): {
  templates: TemplatesService;
  agents: AgentsService;
  instances: InstancesService;
  schedules: SchedulesService;
  sessions: SessionsApiService;
} {
  const k8s = createK8sClient(api, namespace, opts?.batchApi, opts?.networkingApi);
  const templatesRepo = createTemplatesRepository(db);
  const agentsRepo = createAgentsRepository(db);
  const instancesRepo = createInstancesRepository(db);
  const schedulesRepo = createSchedulesRepository(db);

  const agentProvisioner = opts?.onecli && opts?.userJwt
    ? createAgentProvisioner(k8s, opts.onecli, opts.userJwt, owner)
    : undefined;
  const instanceProvisioner = createInstanceProvisioner(k8s, db);

  const agents = createAgentsService({
    repo: agentsRepo,
    owner,
    readTemplateSpec: (id) => templatesRepo.readSpec(id),
    provisioner: agentProvisioner,
  });

  return {
    templates: createTemplatesService({ repo: templatesRepo }),
    agents,
    instances: createInstancesService({
      repo: instancesRepo,
      owner,
      provisioner: instanceProvisioner,
      getAgent: (id) => agents.get(id),
      listChannelsByOwner: listChannelsByOwner(db, owner),
      listChannelsByInstance: listChannelsByInstance(db, owner),
      upsertChannel: upsertChannel(db, owner),
      deleteChannelByType: deleteChannelByType(db, owner),
      deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(db, owner),
      listAllowedUsersByOwner: listAllowedUsersByOwner(db, owner),
      listAllowedUsersByInstance: listAllowedUsersByInstance(db, owner),
      setAllowedUsers: setAllowedUsers(db, owner),
      deleteAllowedUsersByInstanceIds: deleteAllowedUsersByInstanceIds(db, owner),
    }),
    schedules: createSchedulesService({ repo: schedulesRepo, owner }),
    sessions: createSessionsService({
      listByInstance: listSessionsByInstance(db),
      listByScheduleId: listSessionsByScheduleId(db),
      findActiveByScheduleId: findActiveByScheduleId(db),
      upsert: upsertSession(db),
      delete: deleteSession(db),
      isOwnedInstance: (instanceId) => instancesRepo.isOwnedBy(instanceId, owner),
      isOwnedSchedule: async (scheduleId) => (await schedulesRepo.get(scheduleId, owner)) !== null,
      deactivateByScheduleId: deactivateByScheduleId(db),
      namespace,
    }),
  };
}

export function composeSystemInstances(api: k8s.CoreV1Api, namespace: string, db: Db): InstancesService {
  const templatesRepo = createTemplatesRepository(db);
  const agentsRepo = createAgentsRepository(db);
  const instancesRepo = createInstancesRepository(db);

  const agents = createAgentsService({
    repo: agentsRepo,
    owner: "",
    readTemplateSpec: (id) => templatesRepo.readSpec(id),
  });

  return createInstancesService({
    repo: instancesRepo,
    owner: undefined,
    getAgent: (id) => agents.get(id),
    listChannelsByOwner: listChannelsByOwner(db, ""),
    listChannelsByInstance: listChannelsByInstance(db, ""),
    upsertChannel: upsertChannel(db, ""),
    deleteChannelByType: deleteChannelByType(db, ""),
    deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(db, ""),
    listAllowedUsersByOwner: listAllowedUsersByOwner(db, ""),
    listAllowedUsersByInstance: listAllowedUsersByInstance(db, ""),
    setAllowedUsers: setAllowedUsers(db, ""),
    deleteAllowedUsersByInstanceIds: deleteAllowedUsersByInstanceIds(db, ""),
  });
}
