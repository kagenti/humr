/**
 * Reacts to UserAuthenticated — syncs the user account in OneCLI on first seen.
 */
import type { Subscription } from "rxjs";
import { distinct, mergeMap } from "rxjs/operators";
import { events$, ofType, EventType, type UserAuthenticated } from "../events.js";
import type { OnecliClient } from "../onecli.js";

export function startOnecliSyncSaga(onecli: OnecliClient): Subscription {
  return events$().pipe(
    ofType<UserAuthenticated>(EventType.UserAuthenticated),
    distinct((e) => e.userSub),
    mergeMap(async (event) => {
      try {
        await onecli.syncUser(event.userJwt, event.userSub);
      } catch (err) {
        process.stderr.write(`[onecli-sync] sync failed for ${event.userSub}: ${err}\n`);
      }
    }),
  ).subscribe();
}
