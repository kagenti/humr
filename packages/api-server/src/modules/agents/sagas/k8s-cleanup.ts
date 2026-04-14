/**
 * Reacts to InstanceDeleted — cleans up K8s PVCs for the deleted instance.
 */
import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { events$, ofType, type InstanceDeleted } from "../../../events.js";
import type { K8sClient } from "../infrastructure/k8s.js";
import { LABEL_INSTANCE_REF } from "../infrastructure/labels.js";

export function startK8sCleanupSaga(k8s: K8sClient): Subscription {
  return events$().pipe(
    ofType<InstanceDeleted>("InstanceDeleted"),
    mergeMap(async (event) => {
      try {
        const pvcs = await k8s.listPVCs(`${LABEL_INSTANCE_REF}=${event.instanceId}`);
        await Promise.all(pvcs.map((pvc) => k8s.deletePVC(pvc.metadata!.name!)));
      } catch (err) {
        process.stderr.write(`[k8s-cleanup] PVC cleanup failed for ${event.instanceId}: ${err}\n`);
      }
    }),
  ).subscribe();
}
