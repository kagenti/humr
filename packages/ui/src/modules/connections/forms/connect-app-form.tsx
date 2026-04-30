import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { Modal } from "../../../components/modal.js";
import { useStore } from "../../../store.js";
import type { OAuthAppDescriptor } from "../api/fetchers.js";
import { useStartAppOAuth } from "../api/mutations.js";

const INPUT_CLASS =
  "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

interface Props {
  app: OAuthAppDescriptor;
  onCancel: () => void;
}

export function ConnectAppForm({ app, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const showToast = useStore((s) => s.showToast);
  const startAppOAuth = useStartAppOAuth();

  const allFilled = app.inputs.every((field) => (values[field.name] ?? "").trim().length > 0);

  const setField = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const submit = () => {
    if (!allFilled) return;
    const input = Object.fromEntries(
      app.inputs.map((field) => [field.name, (values[field.name] ?? "").trim()]),
    );
    startAppOAuth.mutate(
      { appId: app.id, input },
      {
        onSuccess: (data) => {
          if (data.error) {
            showToast({ kind: "error", message: data.error });
            return;
          }
          if (data.authUrl) {
            sessionStorage.setItem("humr-return-view", "connections");
            window.location.href = data.authUrl;
          }
        },
        onError: (err) => {
          showToast({ kind: "error", message: err.message });
        },
      },
    );
  };

  return (
    <Modal onClose={onCancel} widthClass="w-[480px]">
      <div className="flex flex-col gap-5 p-5 md:p-7">
        <h2 className="text-[20px] font-bold text-text">Connect {app.displayName}</h2>
        <p className="text-[13px] text-text-secondary">{app.description}</p>
        {app.registrationUrl && (
          <a
            href={app.registrationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-accent hover:underline inline-flex items-center gap-1.5"
          >
            Register an OAuth app first <ExternalLink size={13} />
          </a>
        )}
        {app.inputs.map((field) => (
          <div key={field.name} className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-text">{field.label}</label>
            <input
              type={field.secret ? "password" : "text"}
              className={INPUT_CLASS}
              value={values[field.name] ?? ""}
              onChange={(e) => setField(field.name, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && allFilled && submit()}
              placeholder={field.placeholder ?? ""}
              autoComplete="off"
              autoFocus={field === app.inputs[0]}
            />
            {field.helper && (
              <span className="text-[12px] text-text-muted">{field.helper}</span>
            )}
          </div>
        ))}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
            onClick={submit}
            disabled={!allFilled || startAppOAuth.isPending}
          >
            {startAppOAuth.isPending ? "..." : "Connect"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
