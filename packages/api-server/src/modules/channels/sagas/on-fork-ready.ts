import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { events$, ofType, EventType, type ForkReady } from "../../../events.js";
import type { SlackWorker } from "../infrastructure/slack.js";

export function startOnForkReadySaga(worker: SlackWorker): Subscription {
  return events$().pipe(
    ofType<ForkReady>(EventType.ForkReady),
    mergeMap(async (event) => {
      try {
        await worker.onForkReady(event);
      } catch (err) {
        process.stderr.write(
          `[channels/on-fork-ready] ${event.forkId}: ${err}\n`,
        );
      }
    }),
  ).subscribe();
}
