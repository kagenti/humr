import type { Db } from "db";
import type { TemplatesService, AgentsService, InstancesService, SchedulesService, SessionsApiService } from "api-server-api";
import type { K8sClient } from "./infrastructure/k8s.js";
import { createTemplatesRepository } from "./infrastructure/TemplatesRepository.js";
import { createAgentsRepository } from "./infrastructure/AgentsRepository.js";
import { createInstancesRepository } from "./infrastructure/InstancesRepository.js";
import { createSchedulesRepository } from "./infrastructure/SchedulesRepository.js";
import {
  listChannelsByOwner, listChannelsByInstance,
  upsertChannel, deleteChannelByType,
  deleteChannelsByInstanceIds,
} from "./infrastructure/channels-repository.js";
import {
  listAllowedUsersByOwner, listAllowedUsersByInstance,
  setAllowedUsers, deleteAllowedUsersByInstanceIds,
} from "./infrastructure/allowed-users-repository.js";
import { listSessionsByInstance, listSessionsByScheduleId, findActiveByScheduleId, deactivateByScheduleId, upsertSession } from "./infrastructure/sessions-repository.js";
import { createTemplatesService } from "./services/TemplatesService.js";
import { createAgentsService } from "./services/AgentsService.js";
import { createInstancesService } from "./services/InstancesService.js";
import { createSchedulesService } from "./services/SchedulesService.js";
import { createSessionsService } from "./services/SessionsService.js";
import { createAgentProvisioner } from "./infrastructure/agent-provisioner.js";
import { createInstanceProvisioner } from "./infrastructure/instance-provisioner.js";
import type { OnecliClient } from "../../onecli.js";

export function composeAgentsModule(
  k8s: K8sClient,
  namespace: string,
  owner: string,
  db: Db,
  opts?: { onecli?: OnecliClient; userJwt?: string },
): {
  templates: TemplatesService;
  agents: AgentsService;
  instances: InstancesService;
  schedules: SchedulesService;
  sessions: SessionsApiService;
} {
  const templatesRepo = createTemplatesRepository(db);
  const agentsRepo = createAgentsRepository(db);
  const instancesRepo = createInstancesRepository(db);
  const schedulesRepo = createSchedulesRepository(db);

  const agentProvisioner = opts?.onecli && opts?.userJwt
    ? createAgentProvisioner(k8s, opts.onecli, opts.userJwt, owner)
    : undefined;

  const agents = createAgentsService({
    repo: agentsRepo,
    owner,
    readTemplateSpec: (id) => templatesRepo.readSpec(id),
    provisioner: agentProvisioner,
  });

  const instanceProvisioner = createInstanceProvisioner(k8s, db);

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
      deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(db),
      listAllowedUsersByOwner: listAllowedUsersByOwner(db, owner),
      listAllowedUsersByInstance: listAllowedUsersByInstance(db, owner),
      setAllowedUsers: setAllowedUsers(db, owner),
      deleteAllowedUsersByInstanceIds: deleteAllowedUsersByInstanceIds(db),
    }),
    schedules: createSchedulesService({ repo: schedulesRepo, owner }),
    sessions: createSessionsService({
      listByInstance: listSessionsByInstance(db),
      listByScheduleId: listSessionsByScheduleId(db),
      findActiveByScheduleId: findActiveByScheduleId(db),
      upsert: upsertSession(db),
      deactivateByScheduleId: deactivateByScheduleId(db),
      namespace,
    }),
  };
}

export function composeSystemInstances(k8s: K8sClient, namespace: string, db: Db): InstancesService {
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
    deleteChannelsByInstanceIds: deleteChannelsByInstanceIds(db),
    listAllowedUsersByOwner: listAllowedUsersByOwner(db, ""),
    listAllowedUsersByInstance: listAllowedUsersByInstance(db, ""),
    setAllowedUsers: setAllowedUsers(db, ""),
    deleteAllowedUsersByInstanceIds: deleteAllowedUsersByInstanceIds(db),
  });
}
