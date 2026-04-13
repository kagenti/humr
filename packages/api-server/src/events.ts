type Handler = (event: { type: string }) => void;

const handlers = new Map<string, Set<Handler>>();

export function emit(event: { type: string }): void {
  const set = handlers.get(event.type);
  if (set) for (const fn of set) fn(event);
}

export function on(type: string, handler: Handler): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler);
  return () => { set.delete(handler); };
}
