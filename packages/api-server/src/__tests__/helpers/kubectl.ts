import * as k8s from "@kubernetes/client-node";

const KUBECONFIG = `${process.env.HOME}/.lima/humr-k3s/copied-from-guest/kubeconfig.yaml`;
const TEST_NAMESPACE = "humr-agents-test";

function loadApi() {
  const kc = new k8s.KubeConfig();
  kc.loadFromFile(KUBECONFIG);
  return kc.makeApiClient(k8s.CoreV1Api);
}

const api = loadApi();

export async function getConfigMap(name: string, namespace = TEST_NAMESPACE): Promise<k8s.V1ConfigMap> {
  return api.readNamespacedConfigMap({ name, namespace });
}

export async function configMapExists(name: string, namespace = TEST_NAMESPACE): Promise<boolean> {
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
  namespace = TEST_NAMESPACE,
): Promise<void> {
  const cm = await api.readNamespacedConfigMap({ name, namespace });
  cm.data = { ...cm.data, [key]: value };
  await api.replaceNamespacedConfigMap({ name, namespace, body: cm });
}
