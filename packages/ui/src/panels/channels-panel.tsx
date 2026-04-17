import { useState, useEffect } from "react";
import { useStore } from "../store.js";
import { X, Plus } from "lucide-react";
import type { UnifiedBackend } from "../types.js";

export function ChannelsPanel() {
  const instances = useStore(s => s.instances);
  const selectedInstance = useStore(s => s.selectedInstance);
  const connectSlack = useStore(s => s.connectSlack);
  const disconnectSlack = useStore(s => s.disconnectSlack);
  const connectTelegram = useStore(s => s.connectTelegram);
  const disconnectTelegram = useStore(s => s.disconnectTelegram);
  const connectUnified = useStore(s => s.connectUnified);
  const disconnectUnified = useStore(s => s.disconnectUnified);
  const updateInstance = useStore(s => s.updateInstance);
  const slackAvailable = useStore(s => !!s.availableChannels.slack);
  const telegramAvailable = useStore(s => !!s.availableChannels.telegram);
  const unifiedAvailable = useStore(s => !!s.availableChannels.unified);

  const inst = instances.find(i => i.id === selectedInstance);
  const slackChannel = inst?.channels.find(c => c.type === "slack");
  const telegramChannel = inst?.channels.find(c => c.type === "telegram");
  const unifiedChannel = inst?.channels.find(c => c.type === "unified");

  const [slackEnabled, setSlackEnabled] = useState(!!slackChannel);
  const [slackChannelId, setSlackChannelId] = useState(
    slackChannel?.type === "slack" ? slackChannel.slackChannelId : "",
  );

  const [telegramEnabled, setTelegramEnabled] = useState(!!telegramChannel);
  const [telegramChatId, setTelegramChatId] = useState(
    telegramChannel?.type === "telegram" ? telegramChannel.telegramChatId : "",
  );
  const [telegramBotToken, setTelegramBotToken] = useState("");

  const [unifiedEnabled, setUnifiedEnabled] = useState(!!unifiedChannel);
  const [unifiedBackend, setUnifiedBackend] = useState<UnifiedBackend>(
    unifiedChannel?.type === "unified" ? unifiedChannel.backend : "telegram",
  );
  const [uSlackChannelId, setUSlackChannelId] = useState(
    unifiedChannel?.type === "unified" ? (unifiedChannel.slackChannelId ?? "") : "",
  );
  const [uSlackBotToken, setUSlackBotToken] = useState("");
  const [uSlackAppToken, setUSlackAppToken] = useState("");
  const [uTelegramChatId, setUTelegramChatId] = useState(
    unifiedChannel?.type === "unified" ? (unifiedChannel.telegramChatId ?? "") : "",
  );
  const [uTelegramBotToken, setUTelegramBotToken] = useState("");

  const [users, setUsers] = useState<string[]>(inst?.allowedUsers ?? []);
  const [userInput, setUserInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const slack = inst?.channels.find(c => c.type === "slack");
    const tg = inst?.channels.find(c => c.type === "telegram");
    const uni = inst?.channels.find(c => c.type === "unified");
    setSlackEnabled(!!slack);
    setSlackChannelId(slack?.type === "slack" ? slack.slackChannelId : "");
    setTelegramEnabled(!!tg);
    setTelegramChatId(tg?.type === "telegram" ? tg.telegramChatId : "");
    setTelegramBotToken("");
    setUnifiedEnabled(!!uni);
    setUnifiedBackend(uni?.type === "unified" ? uni.backend : "telegram");
    setUSlackChannelId(uni?.type === "unified" ? (uni.slackChannelId ?? "") : "");
    setUSlackBotToken("");
    setUSlackAppToken("");
    setUTelegramChatId(uni?.type === "unified" ? (uni.telegramChatId ?? "") : "");
    setUTelegramBotToken("");
    setUsers(inst?.allowedUsers ?? []);
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
      if (slackAvailable) {
        if (slackEnabled && !slackChannel && slackChannelId.trim()) {
          await connectSlack(inst.id, slackChannelId.trim());
        } else if (!slackEnabled && slackChannel) {
          await disconnectSlack(inst.id);
        } else if (
          slackEnabled && slackChannel?.type === "slack"
          && slackChannelId.trim() !== slackChannel.slackChannelId
        ) {
          await disconnectSlack(inst.id);
          await connectSlack(inst.id, slackChannelId.trim());
        }
      }

      if (telegramAvailable) {
        if (telegramEnabled && telegramChatId.trim() && telegramBotToken.trim()) {
          await connectTelegram(inst.id, {
            botToken: telegramBotToken.trim(),
            telegramChatId: telegramChatId.trim(),
          });
        } else if (!telegramEnabled && telegramChannel) {
          await disconnectTelegram(inst.id);
        }
      }

      if (unifiedAvailable) {
        if (unifiedEnabled) {
          const input: Parameters<typeof connectUnified>[1] = { backend: unifiedBackend };
          if (unifiedBackend === "slack") {
            if (!uSlackChannelId.trim() || !uSlackBotToken.trim() || !uSlackAppToken.trim()) {
              // skip — incomplete
            } else {
              input.slackChannelId = uSlackChannelId.trim();
              input.slackBotToken = uSlackBotToken.trim();
              input.slackAppToken = uSlackAppToken.trim();
              await connectUnified(inst.id, input);
            }
          } else {
            if (!uTelegramChatId.trim() || !uTelegramBotToken.trim()) {
              // skip
            } else {
              input.telegramChatId = uTelegramChatId.trim();
              input.telegramBotToken = uTelegramBotToken.trim();
              await connectUnified(inst.id, input);
            }
          }
        } else if (!unifiedEnabled && unifiedChannel) {
          await disconnectUnified(inst.id);
        }
      }

      await updateInstance(inst.id, { allowedUsers: users });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  if (!slackAvailable && !telegramAvailable && !unifiedAvailable) {
    return (
      <div className="px-4 py-4 text-[12px] text-text-muted">
        No channels are configured for this installation.
      </div>
    );
  }

  const inputClass =
    "h-8 rounded-md border border-border-light bg-bg px-3 text-[13px] text-text outline-none focus:border-accent";

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {slackAvailable && (
        <fieldset className="rounded-lg border-2 border-border p-4 flex flex-col gap-3">
          <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-text-secondary px-1">Slack</legend>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={slackEnabled}
              onChange={e => { setSlackEnabled(e.target.checked); setDirty(true); }}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
            <span className="text-[13px] font-semibold text-text">Enabled</span>
          </label>
          {slackEnabled && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">Channel ID</label>
              <input
                type="text"
                value={slackChannelId}
                onChange={e => { setSlackChannelId(e.target.value); setDirty(true); }}
                placeholder="C0..."
                className={inputClass}
              />
            </div>
          )}
        </fieldset>
      )}

      {telegramAvailable && (
        <fieldset className="rounded-lg border-2 border-border p-4 flex flex-col gap-3">
          <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-text-secondary px-1">Telegram</legend>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={telegramEnabled}
              onChange={e => { setTelegramEnabled(e.target.checked); setDirty(true); }}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
            <span className="text-[13px] font-semibold text-text">Enabled</span>
          </label>
          {telegramEnabled && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">Chat ID</label>
                <input
                  type="text"
                  value={telegramChatId}
                  onChange={e => { setTelegramChatId(e.target.value); setDirty(true); }}
                  placeholder="123456789"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">
                  Bot Token {telegramChannel ? "(leave blank to keep existing)" : ""}
                </label>
                <input
                  type="password"
                  value={telegramBotToken}
                  onChange={e => { setTelegramBotToken(e.target.value); setDirty(true); }}
                  placeholder="123456:ABC-DEF..."
                  className={inputClass}
                />
              </div>
            </>
          )}
        </fieldset>
      )}

      {unifiedAvailable && (
        <fieldset className="rounded-lg border-2 border-border p-4 flex flex-col gap-3">
          <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-text-secondary px-1">
            Unified (abstraction)
          </legend>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={unifiedEnabled}
              onChange={e => { setUnifiedEnabled(e.target.checked); setDirty(true); }}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
            <span className="text-[13px] font-semibold text-text">Enabled</span>
          </label>
          {unifiedEnabled && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">Backend</label>
                <select
                  value={unifiedBackend}
                  onChange={e => { setUnifiedBackend(e.target.value as UnifiedBackend); setDirty(true); }}
                  className={inputClass}
                >
                  <option value="telegram">Telegram</option>
                  <option value="slack">Slack</option>
                </select>
              </div>

              {unifiedBackend === "slack" ? (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">Slack Channel ID</label>
                    <input type="text" value={uSlackChannelId}
                      onChange={e => { setUSlackChannelId(e.target.value); setDirty(true); }}
                      placeholder="C0..." className={inputClass} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">Slack Bot Token</label>
                    <input type="password" value={uSlackBotToken}
                      onChange={e => { setUSlackBotToken(e.target.value); setDirty(true); }}
                      placeholder="xoxb-..." className={inputClass} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">Slack App Token</label>
                    <input type="password" value={uSlackAppToken}
                      onChange={e => { setUSlackAppToken(e.target.value); setDirty(true); }}
                      placeholder="xapp-..." className={inputClass} />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">Telegram Chat ID</label>
                    <input type="text" value={uTelegramChatId}
                      onChange={e => { setUTelegramChatId(e.target.value); setDirty(true); }}
                      placeholder="123456789" className={inputClass} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">Telegram Bot Token</label>
                    <input type="password" value={uTelegramBotToken}
                      onChange={e => { setUTelegramBotToken(e.target.value); setDirty(true); }}
                      placeholder="123456:ABC-DEF..." className={inputClass} />
                  </div>
                </>
              )}
            </>
          )}
        </fieldset>
      )}

      <fieldset className="rounded-lg border-2 border-border p-4 flex flex-col gap-3">
        <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-text-secondary px-1">Allowed Users</legend>
        {users.length === 0 && (
          <span className="text-[12px] text-text-muted italic">Unrestricted — all linked users can interact</span>
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
        <div className="flex gap-1">
          <input
            type="text"
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addUser())}
            placeholder="Keycloak user ID"
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
