import * as k8s from "@kubernetes/client-node";

const KUBECONFIG = process.env.IS_SANDBOX
  ? "/etc/rancher/k3s/k3s.yaml"
  : `${process.env.HOME}/.lima/humr-k3s-test/copied-from-guest/kubeconfig.yaml`;
const NAMESPACE = "humr-agents";

function loadApi() {
  const kc = new k8s.KubeConfig();
  kc.loadFromFile(KUBECONFIG);
  return kc.makeApiClient(k8s.CoreV1Api);
}

const api = loadApi();

export async function getConfigMap(
  name: string,
  namespace = NAMESPACE,
): Promise<k8s.V1ConfigMap> {
  return api.readNamespacedConfigMap({ name, namespace });
}

export async function configMapExists(
  name: string,
  namespace = NAMESPACE,
): Promise<boolean> {
  try {
    await api.readNamespacedConfigMap({ name, namespace });
    return true;
  } catch {
    return false;
  }
}

export async function patchConfigMapData(
  name: string,
  key: string,
  value: string,
  namespace = NAMESPACE,
): Promise<void> {
  const cm = await api.readNamespacedConfigMap({ name, namespace });
  cm.data = { ...cm.data, [key]: value };
  await api.replaceNamespacedConfigMap({ name, namespace, body: cm });
}

export async function waitForPodReady(
  name: string,
  timeoutMs = 120_000,
  namespace = NAMESPACE,
): Promise<void> {
  const start = Date.now();
  let lastError: string | undefined;

  while (Date.now() - start < timeoutMs) {
    try {
      const pod = await api.readNamespacedPod({ name, namespace });
      const ready = pod.status?.conditions?.find((c) => c.type === "Ready");
      if (ready?.status === "True") return;
      lastError = `phase=${pod.status?.phase ?? "Unknown"}, ready=${ready?.status ?? "no condition"}`;
    } catch (e) {
      lastError =
        e instanceof Error ? e.message : "unknown error reading pod";
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  const diag: string[] = [
    `Pod ${name} not ready after ${timeoutMs}ms (last poll: ${lastError})`,
    "",
    "=== Pod Describe ===",
    await describePod(name, namespace),
    "",
    "=== Pod Events ===",
    await getEvents(name, namespace),
    "",
    "=== Controller Logs ===",
    await dumpPodLogs("app.kubernetes.io/component=controller"),
  ];

  throw new Error(diag.join("\n"));
}

export async function waitForConfigMapKey(
  name: string,
  key: string,
  timeoutMs = 90_000,
  namespace = NAMESPACE,
): Promise<k8s.V1ConfigMap> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const cm = await api.readNamespacedConfigMap({ name, namespace });
      if (cm.data?.[key]) return cm;
    } catch {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(
    `ConfigMap ${name} key "${key}" not found after ${timeoutMs}ms`,
  );
}

export async function describePod(
  name: string,
  namespace = NAMESPACE,
): Promise<string> {
  try {
    const pod = await api.readNamespacedPod({ name, namespace });
    const lines: string[] = [`Pod: ${name} (namespace: ${namespace})`];

    lines.push(`Phase: ${pod.status?.phase ?? "Unknown"}`);

    for (const cond of pod.status?.conditions ?? []) {
      lines.push(
        `  ${cond.type}: ${cond.status}${cond.reason ? ` (${cond.reason})` : ""}${cond.message ? ` — ${cond.message}` : ""}`,
      );
    }

    const formatStatus = (cs: k8s.V1ContainerStatus) => {
      const state = cs.state?.waiting
        ? `Waiting: ${cs.state.waiting.reason ?? "unknown"}${cs.state.waiting.message ? ` — ${cs.state.waiting.message}` : ""}`
        : cs.state?.running
          ? `Running since ${cs.state.running.startedAt}`
          : cs.state?.terminated
            ? `Terminated: ${cs.state.terminated.reason ?? "unknown"} (exit ${cs.state.terminated.exitCode})`
            : "Unknown";
      return `  Container ${cs.name}: ${state} (restarts: ${cs.restartCount})`;
    };

    for (const cs of pod.status?.initContainerStatuses ?? []) {
      lines.push(formatStatus(cs));
    }
    for (const cs of pod.status?.containerStatuses ?? []) {
      lines.push(formatStatus(cs));
    }

    return lines.join("\n");
  } catch (e) {
    return `describePod(${name}): ${e instanceof Error ? e.message : e}`;
  }
}

export async function getEvents(
  name: string,
  namespace = NAMESPACE,
): Promise<string> {
  try {
    const events = await api.listNamespacedEvent({ namespace });
    const relevant = events.items
      .filter((e) => e.involvedObject?.name === name)
      .sort(
        (a, b) =>
          (a.lastTimestamp?.getTime() ?? 0) -
          (b.lastTimestamp?.getTime() ?? 0),
      )
      .slice(-20);

    if (relevant.length === 0) return `No events for ${name} in ${namespace}`;

    return relevant
      .map(
        (e) =>
          `[${e.type}] ${e.reason}: ${e.message} (${e.count ?? 1}x, last: ${e.lastTimestamp?.toISOString() ?? "?"})`,
      )
      .join("\n");
  } catch (e) {
    return `getEvents(${name}): ${e instanceof Error ? e.message : e}`;
  }
}

export async function describeConfigMap(
  name: string,
  namespace = NAMESPACE,
): Promise<string> {
  try {
    const cm = await api.readNamespacedConfigMap({ name, namespace });
    const lines: string[] = [`ConfigMap: ${name} (namespace: ${namespace})`];
    lines.push(`Labels: ${JSON.stringify(cm.metadata?.labels ?? {})}`);
    for (const [key, value] of Object.entries(cm.data ?? {})) {
      lines.push(`--- ${key} ---`, value);
    }
    return lines.join("\n");
  } catch (e) {
    return `describeConfigMap(${name}): ${e instanceof Error ? e.message : e}`;
  }
}

export async function dumpPodLogs(
  labelSelector: string,
  namespace = "default",
  tailLines = 200,
): Promise<string> {
  try {
    const pods = await api.listNamespacedPod({ namespace, labelSelector });
    const lines: string[] = [];
    for (const pod of pods.items) {
      const name = pod.metadata!.name!;
      const allContainers = [
        ...(pod.spec?.initContainers ?? []),
        ...(pod.spec?.containers ?? []),
      ];
      for (const container of allContainers) {
        try {
          const log = await api.readNamespacedPodLog({
            name,
            namespace,
            container: container.name,
            tailLines,
          });
          lines.push(`--- ${name}/${container.name} ---`, log);
        } catch (e) {
          lines.push(`--- ${name}/${container.name} --- ERROR: ${e}`);
        }
      }
    }
    return lines.join("\n");
  } catch (e) {
    return `dumpPodLogs failed: ${e}`;
  }
}
