import { useState, useEffect } from "react";
import { useStore } from "../store.js";
import { X, Plus } from "lucide-react";

export function ChannelsPanel() {
  const instances = useStore(s => s.instances);
  const selectedInstance = useStore(s => s.selectedInstance);
  const connectSlack = useStore(s => s.connectSlack);
  const disconnectSlack = useStore(s => s.disconnectSlack);
  const updateInstance = useStore(s => s.updateInstance);
  const slackAvailable = useStore(s => !!s.availableChannels.slack);

  const inst = instances.find(i => i.id === selectedInstance);
  const slackChannel = inst?.channels.find(c => c.type === "slack");

  const [enabled, setEnabled] = useState(!!slackChannel);
  const [channelId, setChannelId] = useState(slackChannel?.slackChannelId ?? "");
  const [users, setUsers] = useState<string[]>(inst?.allowedUserEmails ?? []);
  const [userInput, setUserInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const sc = inst?.channels.find(c => c.type === "slack");
    setEnabled(!!sc);
    setChannelId(sc?.slackChannelId ?? "");
    setUsers(inst?.allowedUserEmails ?? []);
    setDirty(false);
  }, [inst]);

  const addUser = () => {
    const v = userInput.trim();
    if (!v || users.includes(v)) return;
    setUsers(prev => [...prev, v]);
    setUserInput("");
    setDirty(true);
  };

  const removeUser = (u: string) => {
    setUsers(prev => prev.filter(x => x !== u));
    setDirty(true);
  };

  const save = async () => {
    if (!inst) return;
    setSaving(true);
    try {
      if (enabled && !slackChannel && channelId.trim()) {
        await connectSlack(inst.id, channelId.trim());
      } else if (!enabled && slackChannel) {
        await disconnectSlack(inst.id);
      } else if (enabled && slackChannel && channelId.trim() !== slackChannel.slackChannelId) {
        await disconnectSlack(inst.id);
        await connectSlack(inst.id, channelId.trim());
      }
      await updateInstance(inst.id, { allowedUserEmails: users });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  if (!slackAvailable) {
    return (
      <div className="px-4 py-4 text-[12px] text-text-muted">
        Slack is not configured for this installation.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      <fieldset className="rounded-lg border-2 border-border p-4 flex flex-col gap-3">
        <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-text-secondary px-1">Slack</legend>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => { setEnabled(e.target.checked); setDirty(true); }}
            className="w-4 h-4 accent-[var(--color-accent)]"
          />
          <span className="text-[13px] font-semibold text-text">Enabled</span>
        </label>

        {enabled && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">Channel ID</label>
              <input
                type="text"
                value={channelId}
                onChange={e => { setChannelId(e.target.value); setDirty(true); }}
                placeholder="C0..."
                className="h-8 rounded-md border border-border-light bg-bg px-3 text-[13px] text-text outline-none focus:border-accent"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">Allowed Users</label>
              {users.length === 0 && (
                <span className="text-[12px] text-text-muted italic">Unrestricted — all channel members can interact</span>
              )}
              <div className="flex flex-col gap-1">
                {users.map(u => (
                  <div key={u} className="flex items-center gap-2 rounded-md border border-border-light bg-bg px-2 py-1">
                    <span className="flex-1 text-[12px] font-mono text-text truncate">{u}</span>
                    <button onClick={() => removeUser(u)} className="text-text-muted hover:text-danger shrink-0">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1 mt-1">
                <input
                  type="email"
                  value={userInput}
                  onChange={e => setUserInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addUser())}
                  placeholder="user@example.com"
                  className="flex-1 h-7 rounded-md border border-border-light bg-bg px-2 text-[12px] text-text outline-none focus:border-accent"
                />
                <button
                  onClick={addUser}
                  disabled={!userInput.trim()}
                  className="h-7 w-7 rounded-md border border-border-light flex items-center justify-center text-text-muted hover:text-accent hover:border-accent disabled:opacity-30"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          </>
        )}
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
