import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { events$, ofType, EventType, type ForkFailed } from "../../../events.js";
import type { SlackWorker } from "../infrastructure/slack.js";

export function startOnForkFailedSaga(worker: SlackWorker): Subscription {
  return events$().pipe(
    ofType<ForkFailed>(EventType.ForkFailed),
    mergeMap(async (event) => {
      try {
        await worker.onForkFailed(event);
      } catch (err) {
        process.stderr.write(
          `[channels/on-fork-failed] ${event.forkId}: ${err}\n`,
        );
      }
    }),
  ).subscribe();
}
