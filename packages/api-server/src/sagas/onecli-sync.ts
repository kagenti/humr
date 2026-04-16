/**
 * Reacts to UserAuthenticated — syncs the user account in OneCLI on first seen.
 *
 * Uses a manual "synced" set instead of `distinct()` so that a failed sync
 * is retried on the next authentication event for that user.
 */
import type { Subscription } from "rxjs";
import { filter, mergeMap } from "rxjs/operators";
import { events$, ofType, EventType, type UserAuthenticated } from "../events.js";
import type { OnecliClient } from "../onecli.js";

export function startOnecliSyncSaga(onecli: OnecliClient): Subscription {
  const synced = new Set<string>();

  return events$().pipe(
    ofType<UserAuthenticated>(EventType.UserAuthenticated),
    filter((e) => !synced.has(e.userSub)),
    mergeMap(async (event) => {
      try {
        await onecli.syncUser(event.userJwt, event.userSub);
        synced.add(event.userSub);
      } catch (err) {
        process.stderr.write(`[onecli-sync] sync failed for ${event.userSub}: ${err}\n`);
      }
    }),
  ).subscribe();
}
