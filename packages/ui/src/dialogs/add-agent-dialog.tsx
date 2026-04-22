import { useState, useEffect } from "react";
import type { TemplateView, SecretView, EnvVar } from "../types.js";
import type { AppConnectionView } from "api-server-api";
import { Sparkles } from "lucide-react";
import { platform } from "../platform.js";
import { HoverTooltip } from "../components/hover-tooltip.js";
import { ConnectionsPicker } from "../components/connections-picker.js";
import { envsToAddOnGrant } from "./connection-env-helpers.js";
import { useStore } from "../store.js";

type Step = "pick" | "configure";

export function AddAgentDialog({
  templates,
  onSubmit,
  onCancel,
  onGoToProviders,
}: {
  templates: TemplateView[];
  onSubmit: (i: {
    name: string;
    templateId?: string;
    image?: string;
    description?: string;
    env?: EnvVar[];
    secretIds?: string[];
    appConnectionIds?: string[];
  }) => void;
  onCancel: () => void;
  onGoToProviders: () => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateView | null>(
    null,
  );
  const [customImage, setCustomImage] = useState("");

  // Configure step state
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [selSecrets, setSelSecrets] = useState<Set<string>>(new Set());
  // Tracks whether the user touched the selection at all. Needed because the
  // controller auto-assigns the single Anthropic provider when no explicit
  // list is sent, which would otherwise silently ignore an explicit uncheck.
  const [secretsDirty, setSecretsDirty] = useState(false);
  const [loadSecrets, setLoadSecrets] = useState(true);
  const [apps, setApps] = useState<AppConnectionView[]>([]);
  const [selApps, setSelApps] = useState<Set<string>>(new Set());
  const showToast = useStore((s) => s.showToast);

  useEffect(() => {
    platform.secrets.list
      .query()
      .then((loaded) => {
        setSecrets(loaded);
        const providers = loaded.filter((s) => s.type === "anthropic");
        if (providers.length === 1) {
          setSelSecrets(new Set([providers[0].id]));
        }
      })
      .catch((err) =>
        showToast({
          kind: "error",
          message: `Couldn't load secrets: ${err instanceof Error ? err.message : "unknown error"}`,
        }),
      )
      .finally(() => setLoadSecrets(false));
    platform.connections.list
      .query()
      .then(setApps)
      .catch((err) =>
        showToast({
          kind: "error",
          message: `Couldn't load connections: ${err instanceof Error ? err.message : "unknown error"}`,
        }),
      );
  }, [showToast]);

  const toggleSecret = (id: string) => {
    setSecretsDirty(true);
    setSelSecrets((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const toggleApp = (id: string) =>
    setSelApps((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const pickTemplate = (tmpl: TemplateView) => {
    setSelectedTemplate(tmpl);
    setName(tmpl.name);
    setDesc(tmpl.description ?? "");
    setStep("configure");
  };

  const pickCustom = () => {
    const img = customImage.trim();
    if (!img) return;
    setSelectedTemplate(null);
    setName("");
    setDesc("");
    setStep("configure");
  };

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    // Derive env from each granted app's envMappings (dedupe by name across
    // apps — e.g. Gmail + Drive both declare GOOGLE_WORKSPACE_CLI_TOKEN).
    const grantedApps = apps.filter((a) => selApps.has(a.id));
    const env = grantedApps.reduce<EnvVar[]>((acc, app) => {
      const toAdd = envsToAddOnGrant(acc, app);
      return toAdd.length > 0 ? [...acc, ...toAdd] : acc;
    }, []);
    onSubmit({
      name: n,
      templateId: selectedTemplate?.id,
      image: selectedTemplate ? undefined : customImage.trim(),
      description: desc.trim() || undefined,
      env: env.length > 0 ? env : undefined,
      secretIds: secretsDirty ? [...selSecrets] : undefined,
      appConnectionIds: selApps.size ? [...selApps] : undefined,
    });
  };

  const inp =
    "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

  const anthropicSecrets = secrets.filter((s) => s.type === "anthropic");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in"
      onClick={onCancel}
    >
      <div
        className="w-[520px] max-w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto rounded-xl border-2 border-border bg-surface p-5 md:p-7 flex flex-col gap-5 anim-scale-in"
        style={{ boxShadow: "var(--shadow-brutal)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {step === "pick" ? (
          <>
            <h2 className="text-[20px] font-bold text-text">Add Agent</h2>

            {/* Template catalog */}
            {templates.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
                  From Template
                </span>
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => pickTemplate(tmpl)}
                    className="flex flex-col gap-1 rounded-lg border-2 border-border-light bg-bg px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent-light min-w-0"
                  >
                    <div className="text-[14px] font-semibold text-text truncate w-full">{tmpl.name}</div>
                    {tmpl.description && <div className="text-[12px] text-text-muted truncate w-full">{tmpl.description}</div>}
                  </button>
                ))}
              </div>
            )}

            {/* Custom image */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
                Custom Image
              </span>
              <div className="flex gap-2">
                <input
                  className={inp}
                  value={customImage}
                  onChange={(e) => setCustomImage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && pickCustom()}
                  placeholder="ghcr.io/org/agent:latest"
                />
                <button
                  className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-bold text-white disabled:opacity-40 shrink-0"
                  style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                  onClick={pickCustom}
                  disabled={!customImage.trim()}
                >
                  Use
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text"
                style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-[20px] font-bold text-text">
                Configure Agent
              </h2>
              <p className="text-[12px] text-text-muted mt-1">
                {selectedTemplate ? (
                  <>
                    Template:{" "}
                    <HoverTooltip
                      placement="right"
                      trigger={
                        <span className="font-semibold text-text-secondary border-b border-dotted border-text-muted cursor-help">
                          {selectedTemplate.name}
                        </span>
                      }
                    >
                      <span className="font-mono">{selectedTemplate.image}</span>
                    </HoverTooltip>
                  </>
                ) : (
                  <>
                    Image:{" "}
                    <span className="font-mono text-text-secondary break-all">
                      {customImage}
                    </span>
                  </>
                )}
              </p>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                Name
              </span>
              <input
                className={inp}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-agent"
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                Description
              </span>
              <input
                className={inp}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Optional"
              />
            </label>

            {!loadSecrets && anthropicSecrets.length === 0 && (
              <div className="rounded-lg border-2 border-warning bg-warning-light px-4 py-3 flex items-center gap-3">
                <Sparkles size={16} className="text-warning shrink-0" />
                <p className="text-[12px] text-text-secondary">
                  No provider configured, so this agent won't be able to reach an
                  AI model.{" "}
                  <button
                    className="text-accent font-semibold hover:underline"
                    onClick={onGoToProviders}
                  >
                    Set one up
                  </button>
                </p>
              </div>
            )}

            <ConnectionsPicker
              loading={loadSecrets}
              secrets={secrets}
              apps={apps}
              selSecrets={selSecrets}
              selApps={selApps}
              onToggleSecret={toggleSecret}
              onToggleApp={toggleApp}
              onGoToProviders={onGoToProviders}
            />

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text"
                style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                onClick={() => setStep("pick")}
              >
                Back
              </button>
              <button
                className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40"
                style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                onClick={submit}
                disabled={!name.trim()}
              >
                Create Agent
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
