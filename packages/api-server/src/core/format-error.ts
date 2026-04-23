export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err !== null && typeof err === "object") {
    const obj = err as { message?: unknown; code?: unknown };
    if (typeof obj.message === "string") {
      if (typeof obj.code === "number" || typeof obj.code === "string") {
        return `${obj.message} (code ${obj.code})`;
      }
      return obj.message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
