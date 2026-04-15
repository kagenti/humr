import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { platform } from "../platform.js";

interface LinkedUser {
  keycloakSub: string;
  username: string | null;
}

export function InstanceSettingsDialog({ instanceName, allowedUsers, onSubmit, onCancel }: {
  instanceName: string;
  allowedUsers: string[];
  onSubmit: (allowedUsers: string[]) => void;
  onCancel: () => void;
}) {
  const [users, setUsers] = useState<string[]>(allowedUsers);
  const [linkedUsers, setLinkedUsers] = useState<LinkedUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    platform.channels.linkedUsers.query().then((list) => {
      setLinkedUsers(list);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const available = linkedUsers.filter(u => !users.includes(u.keycloakSub));
  const displayName = (sub: string) => linkedUsers.find(u => u.keycloakSub === sub)?.username ?? sub;
  const addUser = (sub: string) => setUsers([...users, sub]);
  const removeUser = (sub: string) => setUsers(users.filter(u => u !== sub));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in" onClick={onCancel}>
      <div
        className="w-[460px] max-h-[80vh] overflow-y-auto rounded-xl border-2 border-border bg-surface p-7 flex flex-col gap-5 anim-scale-in"
        style={{ boxShadow: "var(--shadow-brutal)" }}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h2 className="text-[20px] font-bold text-text">Instance Settings</h2>
          <p className="text-[12px] text-text-muted mt-1">Instance: <span className="font-semibold text-text-secondary">{instanceName}</span></p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">Allowed Users</span>
            <span className="text-[11px] text-text-muted">{users.length === 0 ? "unrestricted" : `${users.length} user${users.length !== 1 ? "s" : ""}`}</span>
          </div>
          <p className="text-[12px] text-text-muted -mt-1">Users who can interact via Slack. Leave empty for unrestricted access.</p>

          {users.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {users.map(sub => (
                <div key={sub} className="flex items-center gap-2 rounded-lg border-2 border-accent bg-accent-light px-4 py-2">
                  <span className="flex-1 text-[13px] font-semibold text-text truncate">{displayName(sub)}</span>
                  <span className="text-[11px] font-mono text-text-muted truncate max-w-[160px]">{sub}</span>
                  <button
                    onClick={() => removeUser(sub)}
                    className="shrink-0 text-text-muted hover:text-danger transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <p className="text-[12px] text-text-muted">Loading linked users...</p>
          ) : available.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mt-1">Add user</span>
              {available.map(u => (
                <button
                  key={u.keycloakSub}
                  onClick={() => addUser(u.keycloakSub)}
                  className="flex items-center gap-2 rounded-lg border-2 border-border-light bg-bg px-4 py-2 cursor-pointer transition-colors hover:border-accent text-left"
                >
                  <span className="flex-1 text-[13px] font-semibold text-text truncate">{u.username ?? u.keycloakSub}</span>
                  {u.username && <span className="text-[11px] font-mono text-text-muted truncate max-w-[160px]">{u.keycloakSub}</span>}
                </button>
              ))}
            </div>
          ) : !loading && linkedUsers.length === 0 ? (
            <p className="text-[12px] text-text-muted">No linked users found. Users must run <code className="font-mono text-[11px] bg-bg border border-border-light rounded px-1.5 py-0.5">/humr login</code> in Slack first.</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text"
            style={{ boxShadow: "var(--shadow-brutal-sm)" }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40"
            style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            onClick={() => onSubmit(users)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
