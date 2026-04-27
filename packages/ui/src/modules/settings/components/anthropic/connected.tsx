import { Pencil, X } from "lucide-react";
import { useState } from "react";

import type { SecretView } from "../../../../types.js";
import { CardIcon } from "./card-icon.js";
import { AnthropicForm } from "./form.js";
import { IconButton } from "./icon-button.js";
import { detectMode, type Mode,MODES } from "./modes.js";

export function AnthropicConnected({
  secret,
  onRemove,
  onSave,
}: {
  secret: SecretView;
  onRemove: () => Promise<void>;
  onSave: (input: { mode: Mode; value: string }) => Promise<void>;
}) {
  const currentMode = detectMode(secret.envMappings?.[0]?.envName);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <AnthropicForm
        variant="edit"
        initialMode={currentMode}
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          await onSave(input);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      className="rounded-xl border-2 border-accent bg-accent-light p-5 anim-in"
      style={{ boxShadow: "var(--shadow-brutal-accent)" }}
    >
      <div className="flex items-center gap-4">
        <CardIcon variant="accent" />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text mb-0.5">Anthropic</div>
          <div className="text-[12px] text-text-muted">
            Set up with {MODES[currentMode].label}
          </div>
        </div>
        <IconButton onClick={() => setEditing(true)} title="Edit" hoverTone="accent">
          <Pencil size={13} />
        </IconButton>
        <IconButton onClick={onRemove} title="Remove" hoverTone="danger">
          <X size={13} />
        </IconButton>
      </div>
    </div>
  );
}
