import * as k8s from "@kubernetes/client-node";

const LIMA_INSTANCE = "humr-k3s-test";
const KUBECONFIG = `${process.env.HOME}/.lima/${LIMA_INSTANCE}/copied-from-guest/kubeconfig.yaml`;
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
  while (Date.now() - start < timeoutMs) {
    try {
      const pod = await api.readNamespacedPod({ name, namespace });
      const ready = pod.status?.conditions?.find((c) => c.type === "Ready");
      if (ready?.status === "True") return;
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Pod ${name} not ready after ${timeoutMs}ms`);
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
