import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Plus, RefreshCw, X } from "lucide-react";
import type { Skill, SkillRef, SkillSource } from "api-server-api";
import { platform } from "../platform.js";
import { ACTION_FAILED, runAction } from "../store/query-helpers.js";
import { useStore } from "../store.js";

interface SkillsPanelProps {
  instanceId: string | null;
  isRunning: boolean;
}

const skillKey = (source: string, name: string) => `${source}::${name}`;

/**
 * Best-effort URL to the skill's SKILL.md at the installed commit. Assumes
 * the `skills/<name>/` layout (the de-facto convention our scanner tries
 * first). Falls back to the repo root for non-GitHub-like hosts.
 */
function skillSourceUrl(source: string, version: string, name: string): string {
  const base = source.replace(/\.git$/, "").replace(/\/$/, "");
  if (/(github|gitlab)\.com|bitbucket\.org/.test(base)) {
    return `${base}/blob/${version}/skills/${name}/SKILL.md`;
  }
  return base;
}

export function SkillsPanel({ instanceId, isRunning }: SkillsPanelProps) {
  const showConfirm = useStore((s) => s.showConfirm);

  const [sources, setSources] = useState<SkillSource[]>([]);
  const [skillsBySource, setSkillsBySource] = useState<Record<string, Skill[]>>({});
  const [loadingBySource, setLoadingBySource] = useState<Record<string, boolean>>({});
  const [errorBySource, setErrorBySource] = useState<Record<string, string | null>>({});
  const [installed, setInstalled] = useState<SkillRef[]>([]);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", gitUrl: "" });
  const [addBusy, setAddBusy] = useState(false);

  const loadSkills = useCallback(async (sourceId: string) => {
    setLoadingBySource((l) => ({ ...l, [sourceId]: true }));
    setErrorBySource((e) => ({ ...e, [sourceId]: null }));
    try {
      const list = await platform.skills.listSkills.query({ sourceId });
      setSkillsBySource((s) => ({ ...s, [sourceId]: list }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load skills";
      setErrorBySource((e) => ({ ...e, [sourceId]: msg }));
      setSkillsBySource((s) => ({ ...s, [sourceId]: [] }));
    } finally {
      setLoadingBySource((l) => ({ ...l, [sourceId]: false }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshInstalled = async () => {
      if (!instanceId) {
        if (!cancelled) setInstalled([]);
        return;
      }
      try {
        const inst = await platform.instances.get.query({ id: instanceId });
        if (!cancelled) setInstalled(inst?.skills ?? []);
      } catch {}
    };

    (async () => {
      try {
        const srcs = await platform.skills.sources.list.query();
        if (!cancelled) setSources(srcs);
      } catch {
        if (!cancelled) setSources([]);
      }
    })();
    refreshInstalled();

    // Poll so agent-initiated installs (via MCP tool calls in chat) show up
    // without a manual refresh. Matches SchedulesPanel's cadence.
    const iv = setInterval(refreshInstalled, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [instanceId]);

  useEffect(() => {
    for (const src of sources) {
      if (skillsBySource[src.id] === undefined && !loadingBySource[src.id]) {
        loadSkills(src.id);
      }
    }
  }, [sources, skillsBySource, loadingBySource, loadSkills]);

  const isInstalled = (source: string, name: string) =>
    installed.some((s) => s.source === source && s.name === name);

  const installedVersion = (source: string, name: string) =>
    installed.find((s) => s.source === source && s.name === name)?.version;

  const toggle = async (skill: Skill) => {
    if (!instanceId || !isRunning) return;
    const key = skillKey(skill.source, skill.name);
    setBusyRow(key);
    const currentlyInstalled = isInstalled(skill.source, skill.name);
    const result = await runAction(
      () => currentlyInstalled
        ? platform.skills.uninstall.mutate({ instanceId, source: skill.source, name: skill.name })
        : platform.skills.install.mutate({ instanceId, source: skill.source, name: skill.name, version: skill.version }),
      `Failed to ${currentlyInstalled ? "uninstall" : "install"} ${skill.name}`,
    );
    if (result !== ACTION_FAILED) setInstalled(result);
    setBusyRow(null);
  };

  const updateDrift = async (skill: Skill) => {
    if (!instanceId || !isRunning) return;
    const key = skillKey(skill.source, skill.name);
    setBusyRow(key);
    const result = await runAction(
      () => platform.skills.install.mutate({
        instanceId, source: skill.source, name: skill.name, version: skill.version,
      }),
      `Failed to update ${skill.name}`,
    );
    if (result !== ACTION_FAILED) setInstalled(result);
    setBusyRow(null);
  };

  const addSource = async () => {
    if (!addForm.name.trim() || !addForm.gitUrl.trim()) return;
    setAddBusy(true);
    const result = await runAction(
      () => platform.skills.sources.create.mutate({
        name: addForm.name.trim(),
        gitUrl: addForm.gitUrl.trim(),
      }),
      "Failed to add source",
    );
    setAddBusy(false);
    if (result !== ACTION_FAILED) {
      setSources((s) => [...s, result]);
      setAddForm({ name: "", gitUrl: "" });
      setShowAdd(false);
    }
  };

  const deleteSource = async (src: SkillSource) => {
    const ok = await showConfirm(
      `Remove source "${src.name}"? Installed skills stay on running instances.`,
      "Remove Source",
    );
    if (!ok) return;
    const result = await runAction(
      () => platform.skills.sources.delete.mutate({ id: src.id }),
      "Failed to remove source",
    );
    if (result !== ACTION_FAILED) {
      setSources((s) => s.filter((x) => x.id !== src.id));
      setSkillsBySource((s) => {
        const next = { ...s };
        delete next[src.id];
        return next;
      });
    }
  };

  const inp = "w-full h-8 rounded-md border-2 border-border-light bg-surface px-3 text-[12px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]";

  return (
    <div className="flex flex-col">
      {!isRunning && instanceId && (
        <div className="px-4 py-2 border-b border-border-light text-[11px] text-text-muted bg-warning-light">
          Start the instance to manage skills.
        </div>
      )}

      <div className="px-3 py-2.5 shrink-0">
        <button
          className="w-full h-7 rounded-md border border-border-light text-[11px] font-semibold text-text-secondary hover:text-accent hover:border-accent flex items-center justify-center gap-1 transition-colors"
          onClick={() => { setAddForm({ name: "", gitUrl: "" }); setShowAdd(true); }}
        >
          <Plus size={12} /> Add Source
        </button>
      </div>

      {showAdd && (
        <div className="flex flex-col gap-3 border-b border-border-light p-4 anim-in">
          <input
            className={inp}
            placeholder='Name (e.g. "Apocohq Skills")'
            value={addForm.name}
            onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className={`${inp} font-mono`}
            placeholder="https://github.com/apocohq/skills"
            value={addForm.gitUrl}
            onChange={(e) => setAddForm((f) => ({ ...f, gitUrl: e.target.value }))}
          />
          <div className="flex justify-end gap-2">
            <button
              className="h-7 rounded-md border-2 border-border-light px-3 text-[11px] font-semibold text-text-muted hover:text-text transition-colors"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </button>
            <button
              className="btn-brutal h-7 rounded-md border-2 border-accent-hover bg-accent px-3.5 text-[11px] font-bold text-white disabled:opacity-40"
              style={{ boxShadow: "var(--shadow-brutal-accent)" }}
              disabled={addBusy || !addForm.name.trim() || !addForm.gitUrl.trim()}
              onClick={addSource}
            >
              {addBusy ? "..." : "Add"}
            </button>
          </div>
        </div>
      )}

      {sources.length === 0 && !showAdd && (
        <p className="px-4 py-5 text-[12px] text-text-muted">No sources. Add a public git repo with skills.</p>
      )}

      {sources.map((src) => {
        const list = skillsBySource[src.id] ?? [];
        const loading = !!loadingBySource[src.id];
        const error = errorBySource[src.id];
        return (
          <div key={src.id} className="border-b border-border-light">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-raised">
              <span className="text-[12px] font-bold text-text flex-1 truncate">{src.name}</span>
              {src.system && (
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 bg-info-light text-info border-info"
                  title="Provided by the cluster admin"
                >
                  Admin
                </span>
              )}
              <span className="text-[11px] text-text-muted truncate max-w-[200px]" title={src.gitUrl}>
                {src.gitUrl.replace(/^https:\/\/github\.com\//, "")}
              </span>
              {!src.system && (
                <button
                  className="text-text-muted hover:text-danger transition-colors"
                  onClick={() => deleteSource(src)}
                  title="Remove source"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {loading && (
              <div className="px-4 py-3 text-[11px] text-text-muted">Loading skills...</div>
            )}

            {error && (
              <div className="px-4 py-2 text-[11px] text-danger bg-danger-light">
                {error}
              </div>
            )}

            {!loading && !error && list.length === 0 && (
              <p className="px-4 py-3 text-[11px] text-text-muted">No skills in this source.</p>
            )}

            {list.map((skill) => {
              const installedVer = installedVersion(skill.source, skill.name);
              const isInst = installedVer !== undefined;
              const hasDrift = isInst && installedVer !== skill.version;
              const key = skillKey(skill.source, skill.name);
              const rowBusy = busyRow === key;
              const disabled = !instanceId || !isRunning || rowBusy;

              return (
                <label
                  key={key}
                  className={`flex items-start gap-3 border-b border-border-light last:border-b-0 px-4 py-3 transition-colors ${isInst ? "bg-accent-light" : ""} ${disabled ? "opacity-60" : "cursor-pointer hover:bg-surface-raised"}`}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--color-accent)] w-4 h-4 mt-0.5"
                    checked={isInst}
                    disabled={disabled}
                    onChange={() => toggle(skill)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-text truncate">{skill.name}</span>
                      <a
                        href={skillSourceUrl(skill.source, skill.version, skill.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-muted hover:text-accent transition-colors shrink-0"
                        title="View SKILL.md at the pinned commit"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={11} />
                      </a>
                      {hasDrift && (
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 bg-info-light text-info border-info hover:opacity-80 disabled:opacity-40"
                          title={`Update available (installed ${installedVer?.slice(0, 8)} → ${skill.version.slice(0, 8)})`}
                          disabled={disabled}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); updateDrift(skill); }}
                        >
                          <RefreshCw size={10} /> Update
                        </button>
                      )}
                      {rowBusy && (
                        <span className="w-3 h-3 rounded-full border-2 border-border-light border-t-accent anim-spin shrink-0" />
                      )}
                    </div>
                    {skill.description && (
                      <div className="mt-0.5 text-[11px] text-text-muted line-clamp-2" title={skill.description}>
                        {skill.description}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
