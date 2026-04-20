import type { Message, MessagePart, ToolChip } from "../types.js";

export type MessageThread = ReturnType<typeof createMessageThread>;

/** Accumulates session messages, grouping same-role chunks into one turn. */
export function createMessageThread() {
  const byId = new Map<string, Message>();
  const order: string[] = [];

  const upsertTurn = (role: Message["role"]): Message => {
    const other = role === "user" ? "assistant" : "user";
    let boundary = -1;
    for (let i = order.length - 1; i >= 0; i--) {
      if (byId.get(order[i])?.role === other) { boundary = i; break; }
    }
    for (let i = boundary + 1; i < order.length; i++) {
      const m = byId.get(order[i]);
      if (m?.role === role) return m;
    }
    const id = crypto.randomUUID();
    const m: Message = { id, role, parts: [], streaming: false };
    byId.set(id, m);
    order.push(id);
    return m;
  };

  const currentTurn = (role: Message["role"]): Message | undefined => {
    const last = byId.get(order[order.length - 1]);
    return last?.role === role ? last : undefined;
  };

  /** Append a text chunk to the current turn, coalescing with the last text part. */
  const appendText = (role: Message["role"], text: string): void => {
    const turn = upsertTurn(role);
    const last = turn.parts[turn.parts.length - 1];
    if (last?.kind === "text") last.text += text;
    else turn.parts.push({ kind: "text", text });
  };

  /** Append a non-text part to the current turn. */
  const appendPart = (role: Message["role"], part: MessagePart): void => {
    upsertTurn(role).parts.push(part);
  };

  /** Whether the current turn of `role` already contains a file with the given name. */
  const hasFilePart = (role: Message["role"], name: string): boolean => {
    const turn = currentTurn(role);
    return !!turn?.parts.some(p => p.kind === "file" && p.name === name);
  };

  /** Patch a tool part identified by toolCallId. Falsy fields in `patch` are ignored. */
  const updateTool = (toolCallId: string, patch: Partial<Pick<ToolChip, "status" | "title" | "content">>): void => {
    for (const m of byId.values()) {
      const chip = m.parts.find((p): p is ToolChip => p.kind === "tool" && p.toolCallId === toolCallId);
      if (!chip) continue;
      if (patch.status) chip.status = patch.status;
      if (patch.title) chip.title = patch.title;
      if (patch.content) chip.content = patch.content;
      return;
    }
  };

  const toArray = (): Message[] => order.map(id => byId.get(id)!);

  return { appendText, appendPart, hasFilePart, updateTool, toArray };
}
