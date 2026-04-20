import { useState } from "react";
import { useStore } from "../store.js";
import type { EnvMapping, SecretView } from "../types.js";
import {
  EnvMappingsEditor,
  allEnvMappingsValid,
  sanitizeEnvMappings,
} from "../components/env-mappings-editor.js";
import { Modal } from "../components/modal.js";

export function EditSecretDialog({
  secret,
  onClose,
}: {
  secret: SecretView;
  onClose: () => void;
}) {
  const updateSecret = useStore((s) => s.updateSecret);
  const [name, setName] = useState(secret.name);
  const [pathPattern, setPathPattern] = useState(secret.pathPattern ?? "");
  const [envMappings, setEnvMappings] = useState<EnvMapping[]>(
    secret.envMappings ?? [],
  );
  const [saving, setSaving] = useState(false);

  const canEditPathPattern = secret.type !== "anthropic";
  const trimmed = name.trim();
  const trimmedPath = pathPattern.trim();
  const sanitized = sanitizeEnvMappings(envMappings);
  const nameChanged = trimmed !== secret.name;
  const pathChanged =
    canEditPathPattern && trimmedPath !== (secret.pathPattern ?? "");
  const mappingsChanged =
    JSON.stringify(sanitized) !== JSON.stringify(secret.envMappings ?? []);
  const canSave =
    !saving &&
    trimmed.length > 0 &&
    allEnvMappingsValid(envMappings) &&
    (nameChanged || pathChanged || mappingsChanged);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await updateSecret(secret.id, {
        ...(nameChanged && { name: trimmed }),
        ...(pathChanged && { pathPattern: trimmedPath === "" ? null : trimmedPath }),
        ...(mappingsChanged && { envMappings: sanitized }),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} widthClass="w-[540px]">
      <div className="px-7 pt-7 pb-4 border-b-2 border-border-light">
        <h2 className="text-[20px] font-bold text-text">Edit Connector</h2>
        <p className="text-[12px] text-text-muted mt-1 font-mono">
          {secret.hostPattern}
          {secret.pathPattern && (
            <span className="text-text-secondary">{secret.pathPattern}</span>
          )}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
            Name
          </span>
          <input
            className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        {canEditPathPattern && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
              Path Pattern
            </span>
            <input
              className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] font-mono text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]"
              placeholder="e.g. /v1/*"
              value={pathPattern}
              onChange={(e) => setPathPattern(e.target.value)}
              disabled={saving}
            />
            <span className="text-[11px] text-text-muted">
              Restrict injection to URL paths matching this pattern. Leave blank
              to match every path on the host.
            </span>
          </label>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
            Pod Env Vars
          </span>
          <p className="text-[11px] text-text-muted">
            Applied to every instance granted this connector on next pod
            restart.
          </p>
          <EnvMappingsEditor
            value={envMappings}
            onChange={setEnvMappings}
            disabled={saving}
          />
        </div>
      </div>

      <div className="px-7 py-4 border-t-2 border-border-light flex justify-end gap-3">
        <button
          className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text"
          style={{ boxShadow: "var(--shadow-brutal-sm)" }}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40"
          style={{ boxShadow: "var(--shadow-brutal-accent)" }}
          onClick={save}
          disabled={!canSave}
        >
          {saving ? "..." : "Save"}
        </button>
      </div>
    </Modal>
  );
}
