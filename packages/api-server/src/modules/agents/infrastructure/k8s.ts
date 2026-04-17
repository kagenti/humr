/**
 * Thin K8s client — generic ConfigMap / Pod / PVC / Job operations.
 */
import * as k8s from "@kubernetes/client-node";

export interface K8sClient {
  listConfigMaps(labelSelector: string): Promise<k8s.V1ConfigMap[]>;
  getConfigMap(name: string): Promise<k8s.V1ConfigMap | null>;
  createConfigMap(body: k8s.V1ConfigMap): Promise<k8s.V1ConfigMap>;
  replaceConfigMap(name: string, body: k8s.V1ConfigMap): Promise<k8s.V1ConfigMap>;
  patchConfigMap(name: string, body: object): Promise<k8s.V1ConfigMap>;
  deleteConfigMap(name: string): Promise<void>;

  listPods(labelSelector: string): Promise<k8s.V1Pod[]>;
  getPod(name: string): Promise<k8s.V1Pod | null>;
  patchPod(name: string, body: object): Promise<void>;

  listPVCs(labelSelector: string): Promise<k8s.V1PersistentVolumeClaim[]>;
  deletePVC(name: string): Promise<void>;

  createJob(body: k8s.V1Job): Promise<k8s.V1Job>;
}

function is404(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: number }).code === 404
  );
}

export function createK8sClient(api: k8s.CoreV1Api, namespace: string, batchApi: k8s.BatchV1Api): K8sClient {
  return {
    async listConfigMaps(labelSelector) {
      const res = await api.listNamespacedConfigMap({ namespace, labelSelector });
      return res.items ?? [];
    },

    async getConfigMap(name) {
      try {
        return await api.readNamespacedConfigMap({ name, namespace });
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },

    async createConfigMap(body) {
      return api.createNamespacedConfigMap({ namespace, body: { ...body, metadata: { ...body.metadata, namespace } } });
    },

    async replaceConfigMap(name, body) {
      return api.replaceNamespacedConfigMap({ name, namespace, body: { ...body, metadata: { ...body.metadata, namespace } } });
    },

    async patchConfigMap(name, body) {
      return api.patchNamespacedConfigMap({
        name,
        namespace,
        body,
        contentType: "application/merge-patch+json",
      } as any);
    },

    async deleteConfigMap(name) {
      await api.deleteNamespacedConfigMap({ name, namespace });
    },

    async listPods(labelSelector) {
      const res = await api.listNamespacedPod({ namespace, labelSelector });
      return res.items ?? [];
    },

    async getPod(name) {
      try {
        return await api.readNamespacedPod({ name, namespace });
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },

    async patchPod(name, body) {
      await api.patchNamespacedPod({ name, namespace, body });
    },

    async listPVCs(labelSelector) {
      const res = await api.listNamespacedPersistentVolumeClaim({ namespace, labelSelector });
      return res.items ?? [];
    },

    async deletePVC(name) {
      await api.deleteNamespacedPersistentVolumeClaim({ name, namespace });
    },

    async createJob(body) {
      return batchApi.createNamespacedJob({ namespace, body: { ...body, metadata: { ...body.metadata, namespace } } });
    },
  };
}

export function createApi(namespace: string) {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  return {
    api: kc.makeApiClient(k8s.CoreV1Api),
    batchApi: kc.makeApiClient(k8s.BatchV1Api),
    namespace,
  };
}
