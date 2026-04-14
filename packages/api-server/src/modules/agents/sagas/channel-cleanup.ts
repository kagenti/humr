/**
 * Reacts to InstanceDeleted — removes channel rows from PostgreSQL.
 */
import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { events$, ofType, EventType, type InstanceDeleted } from "../../../events.js";

export function startChannelCleanupSaga(
  deleteChannelsByInstance: (instanceId: string) => Promise<void>,
): Subscription {
  return events$().pipe(
    ofType<InstanceDeleted>(EventType.InstanceDeleted),
    mergeMap(async (event) => {
      try {
        await deleteChannelsByInstance(event.instanceId);
      } catch (err) {
        process.stderr.write(`[channel-cleanup] Failed for ${event.instanceId}: ${err}\n`);
      }
    }),
  ).subscribe();
}
