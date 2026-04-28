import { useEffect, useState } from "react";

import { useStore } from "../../../store.js";
import { useUpdateInstance } from "../../instances/api/mutations.js";
import { useInstances } from "../../instances/api/queries.js";

export function ExperimentalPanel() {
  const { data: instancesData } = useInstances();
  const instances = instancesData?.list ?? [];
  const selectedInstance = useStore(s => s.selectedInstance);
  const updateInstance = useUpdateInstance();

  const inst = instances.find(i => i.id === selectedInstance);

  const [credentialInjector, setCredentialInjector] = useState<boolean>(!!inst?.experimentalCredentialInjector);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setCredentialInjector(!!inst?.experimentalCredentialInjector);
    setDirty(false);
  }, [inst?.id, inst?.experimentalCredentialInjector]);

  const save = async () => {
    if (!inst) return;
    setSaving(true);
    try {
      await updateInstance.mutateAsync({ id: inst.id, experimentalCredentialInjector: credentialInjector });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  if (!inst) {
    return (
      <div className="px-4 py-4 text-[12px] text-text-muted">
        Select an instance to configure experimental settings.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      <fieldset className="rounded-lg border-2 border-border p-4 flex flex-col gap-3">
        <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-text-secondary px-1">Credential injector</legend>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={credentialInjector}
            onChange={e => { setCredentialInjector(e.target.checked); setDirty(true); }}
            className="mt-0.5 w-4 h-4 accent-[var(--color-accent)]"
          />
          <span className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-text">Envoy credential gateway</span>
            <span className="text-[11px] text-text-muted">
              Replaces OneCLI with an Envoy credential gateway for this instance. OAuth-backed services (GitHub, Slack, Google) will not work when enabled. Only secrets created after enabling will be injected. Restart required.
            </span>
          </span>
        </label>
      </fieldset>

      <button
        onClick={save}
        disabled={saving || !dirty}
        className="btn-brutal h-8 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[12px] font-bold text-white disabled:opacity-40 self-start"
        style={{ boxShadow: "var(--shadow-brutal-accent)" }}
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
