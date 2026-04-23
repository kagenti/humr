import { useState } from "react";

import {
  allEnvMappingsValid,
  EnvMappingsEditor,
  sanitizeEnvMappings,
} from "../../../components/env-mappings-editor.js";
import { Modal } from "../../../components/modal.js";
import {
  DEFAULT_INJECTION_CONFIG,
  type EnvMapping,
  type SecretView,
} from "../../../types.js";
import { useUpdateSecret } from "../api/mutations.js";

export function EditSecretDialog({
  secret,
  onClose,
}: {
  secret: SecretView;
  onClose: () => void;
}) {
  const updateSecret = useUpdateSecret();
  const [name, setName] = useState(secret.name);
  const [hostPattern, setHostPattern] = useState(secret.hostPattern);
  const [pathPattern, setPathPattern] = useState(secret.pathPattern ?? "");
  const [headerName, setHeaderName] = useState(
    secret.injectionConfig?.headerName ?? "",
  );
  const [valueFormat, setValueFormat] = useState(
    secret.injectionConfig?.valueFormat ?? "",
  );
  const [envMappings, setEnvMappings] = useState<EnvMapping[]>(
    secret.envMappings ?? [],
  );
  const saving = updateSecret.isPending;

  const isGeneric = secret.type !== "anthropic";
  const trimmed = name.trim();
  const trimmedHost = hostPattern.trim();
  const trimmedPath = pathPattern.trim();
  const trimmedHeader = headerName.trim();
  const trimmedValueFormat = valueFormat.trim();
  const sanitized = sanitizeEnvMappings(envMappings);
  const nameChanged = trimmed !== secret.name;
  const hostChanged = isGeneric && trimmedHost !== secret.hostPattern;
  const pathChanged = isGeneric && trimmedPath !== (secret.pathPattern ?? "");
  const injectionChanged =
    isGeneric &&
    (trimmedHeader !== (secret.injectionConfig?.headerName ?? "") ||
      trimmedValueFormat !== (secret.injectionConfig?.valueFormat ?? ""));
  const mappingsChanged =
    JSON.stringify(sanitized) !== JSON.stringify(secret.envMappings ?? []);
  const hostValid = !isGeneric || trimmedHost.length > 0;
  const injectionValid = !isGeneric || trimmedHeader.length > 0;
  const canSave =
    !saving &&
    trimmed.length > 0 &&
    hostValid &&
    injectionValid &&
    allEnvMappingsValid(envMappings) &&
    (nameChanged || hostChanged || pathChanged || injectionChanged || mappingsChanged);

  const save = () => {
    if (!canSave) return;
    updateSecret.mutate(
      {
        id: secret.id,
        ...(nameChanged && { name: trimmed }),
        ...(hostChanged && { hostPattern: trimmedHost }),
        ...(pathChanged && { pathPattern: trimmedPath === "" ? null : trimmedPath }),
        ...(injectionChanged && {
          injectionConfig: {
            headerName: trimmedHeader,
            ...(trimmedValueFormat.length > 0 && { valueFormat: trimmedValueFormat }),
          },
        }),
        ...(mappingsChanged && { envMappings: sanitized }),
      },
      { onSuccess: onClose },
    );
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

        {isGeneric && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
              Host Pattern
            </span>
            <input
              className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] font-mono text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]"
              placeholder="e.g. api.example.com"
              value={hostPattern}
              onChange={(e) => setHostPattern(e.target.value)}
              disabled={saving}
            />
            <span className="text-[11px] text-text-muted">
              Hostname OneCLI matches against outbound requests. Required.
            </span>
          </label>
        )}

        {isGeneric && (
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

        {isGeneric && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
              Header Name
            </span>
            <input
              className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] font-mono text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]"
              placeholder={DEFAULT_INJECTION_CONFIG.headerName}
              value={headerName}
              onChange={(e) => setHeaderName(e.target.value)}
              disabled={saving}
            />
            <span className="text-[11px] text-text-muted">
              HTTP header OneCLI writes the secret into.
            </span>
          </label>
        )}

        {isGeneric && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
              Value Format
            </span>
            <input
              className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] font-mono text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]"
              placeholder={DEFAULT_INJECTION_CONFIG.valueFormat}
              value={valueFormat}
              onChange={(e) => setValueFormat(e.target.value)}
              disabled={saving}
            />
            <span className="text-[11px] text-text-muted">
              Template for the header value. Use{" "}
              <span className="font-mono">{`{value}`}</span> as the token
              placeholder.
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
