/**
 * Reacts to UserAuthenticated — syncs the user account in OneCLI on first seen.
 *
 * Uses a manual "synced" set instead of `distinct()` so that a failed sync
 * can be retried. Retries with exponential backoff (up to 30 s, max 10 attempts)
 * so a transient OneCLI startup delay does not permanently prevent account creation.
 */
import type { Subscription } from "rxjs";
import { defer, timer } from "rxjs";
import { catchError, filter, mergeMap, retry, tap } from "rxjs/operators";
import { events$, ofType, EventType, type UserAuthenticated } from "../events.js";
import type { OnecliClient } from "../apps/api-server/onecli.js";

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export function startOnecliSyncSaga(onecli: OnecliClient): Subscription {
  const synced = new Set<string>();

  return events$().pipe(
    ofType<UserAuthenticated>(EventType.UserAuthenticated),
    filter((e) => !synced.has(e.userSub)),
    mergeMap((event) =>
      defer(() => onecli.syncUser(event.userJwt, event.userSub)).pipe(
        tap(() => synced.add(event.userSub)),
        retry({
          count: MAX_RETRIES,
          delay: (_, retryCount) =>
            timer(Math.min(BASE_DELAY_MS * 2 ** (retryCount - 1), MAX_DELAY_MS)),
        }),
        catchError((err) => {
          process.stderr.write(
            `[onecli-sync] sync failed permanently for ${event.userSub} after ${MAX_RETRIES} retries: ${err}\n` +
            `[onecli-sync] OneCLI sync is vital — shutting down server.\n`,
          );
          process.exit(1);
        }),
      ),
    ),
  ).subscribe();
}
