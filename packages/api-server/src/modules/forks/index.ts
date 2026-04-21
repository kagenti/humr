export { composeForksModule } from "./compose.js";
export { isForkReady, isForkFailed, isForkCompleted } from "./domain/event-guards.js";
export type {
  ForkReady,
  ForkFailed,
  ForkCompleted,
  ForkFailureReason,
} from "../../events.js";
