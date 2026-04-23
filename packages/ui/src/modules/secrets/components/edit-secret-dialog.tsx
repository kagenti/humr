import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
  allEnvMappingsValid,
  EnvMappingsEditor,
  sanitizeEnvMappings,
} from "../../../components/env-mappings-editor.js";
import { FormError } from "../../../components/form-error.js";
import { Modal } from "../../../components/modal.js";
import {
  DEFAULT_INJECTION_CONFIG,
  type EnvMapping,
  type InjectionConfig,
  type SecretView,
} from "../../../types.js";
import { useUpdateSecret } from "../api/mutations.js";

const envMappingSchema = z.object({
  envName: z.string(),
  placeholder: z.string(),
});

const baseShape = {
  name: z.string().trim().min(1, "Required"),
  hostPattern: z.string().trim(),
  pathPattern: z.string().trim(),
  headerName: z.string().trim(),
  valueFormat: z.string().trim(),
  envMappings: z
    .array(envMappingSchema)
    .refine(allEnvMappingsValid, "All mappings need an env name and a secret field"),
};

const anthropicSchema = z.object(baseShape);

// Generic secrets additionally require a non-empty host and header name.
const genericSchema = z.object({
  ...baseShape,
  hostPattern: z.string().trim().min(1, "Required"),
  headerName: z.string().trim().min(1, "Required"),
});

type EditSecretValues = z.infer<typeof anthropicSchema>;

const INPUT_CLASS =
  "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]";
const MONO_INPUT_CLASS = `${INPUT_CLASS} font-mono`;
const FIELD_LABEL_CLASS =
  "text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]";
const FIELD_HINT_CLASS = "text-[11px] text-text-muted";

interface UpdateSecretPatch {
  id: string;
  name?: string;
  hostPattern?: string;
  pathPattern?: string | null;
  injectionConfig?: InjectionConfig | null;
  envMappings?: EnvMapping[];
}

interface Props {
  secret: SecretView;
  onClose: () => void;
}

export function EditSecretDialog({ secret, onClose }: Props) {
  const isGeneric = secret.type !== "anthropic";
  const updateSecret = useUpdateSecret();
  const saving = updateSecret.isPending;

  const { register, handleSubmit, control, formState } = useForm<EditSecretValues>({
    resolver: zodResolver(isGeneric ? genericSchema : anthropicSchema),
    mode: "onChange",
    defaultValues: {
      name: secret.name,
      hostPattern: secret.hostPattern,
      pathPattern: secret.pathPattern ?? "",
      headerName: secret.injectionConfig?.headerName ?? "",
      valueFormat: secret.injectionConfig?.valueFormat ?? "",
      envMappings: secret.envMappings ?? [],
    },
  });
  const { errors, isValid, isDirty, dirtyFields } = formState;
  const canSave = isValid && isDirty && !saving;

  const onSubmit = handleSubmit((values) => {
    const patch: UpdateSecretPatch = { id: secret.id };
    if (dirtyFields.name) patch.name = values.name.trim();
    if (isGeneric) {
      if (dirtyFields.hostPattern) patch.hostPattern = values.hostPattern.trim();
      if (dirtyFields.pathPattern) {
        const trimmed = values.pathPattern.trim();
        patch.pathPattern = trimmed === "" ? null : trimmed;
      }
      if (dirtyFields.headerName || dirtyFields.valueFormat) {
        const header = values.headerName.trim();
        const format = values.valueFormat.trim();
        patch.injectionConfig = {
          headerName: header,
          ...(format.length > 0 && { valueFormat: format }),
        };
      }
    }
    if (dirtyFields.envMappings) {
      patch.envMappings = sanitizeEnvMappings(values.envMappings);
    }
    updateSecret.mutate(patch, { onSuccess: onClose });
  });

  return (
    <Modal onClose={onClose} widthClass="w-[540px]">
      <form onSubmit={onSubmit} className="contents">
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
            <span className={FIELD_LABEL_CLASS}>Name</span>
            <input
              className={INPUT_CLASS}
              autoFocus
              {...register("name")}
            />
            <FormError message={errors.name?.message} />
          </label>

          {isGeneric && (
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL_CLASS}>Host Pattern</span>
              <input
                className={MONO_INPUT_CLASS}
                placeholder="e.g. api.example.com"
                disabled={saving}
                {...register("hostPattern")}
              />
              <span className={FIELD_HINT_CLASS}>
                Hostname OneCLI matches against outbound requests. Required.
              </span>
              <FormError message={errors.hostPattern?.message} />
            </label>
          )}

          {isGeneric && (
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL_CLASS}>Path Pattern</span>
              <input
                className={MONO_INPUT_CLASS}
                placeholder="e.g. /v1/*"
                disabled={saving}
                {...register("pathPattern")}
              />
              <span className={FIELD_HINT_CLASS}>
                Restrict injection to URL paths matching this pattern. Leave blank
                to match every path on the host.
              </span>
            </label>
          )}

          {isGeneric && (
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL_CLASS}>Header Name</span>
              <input
                className={MONO_INPUT_CLASS}
                placeholder={DEFAULT_INJECTION_CONFIG.headerName}
                disabled={saving}
                {...register("headerName")}
              />
              <span className={FIELD_HINT_CLASS}>
                HTTP header OneCLI writes the secret into.
              </span>
              <FormError message={errors.headerName?.message} />
            </label>
          )}

          {isGeneric && (
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL_CLASS}>Value Format</span>
              <input
                className={MONO_INPUT_CLASS}
                placeholder={DEFAULT_INJECTION_CONFIG.valueFormat}
                disabled={saving}
                {...register("valueFormat")}
              />
              <span className={FIELD_HINT_CLASS}>
                Template for the header value. Use{" "}
                <span className="font-mono">{`{value}`}</span> as the token
                placeholder.
              </span>
            </label>
          )}

          <div className="flex flex-col gap-2">
            <span className={FIELD_LABEL_CLASS}>Pod Env Vars</span>
            <p className={FIELD_HINT_CLASS}>
              Applied to every instance granted this connector on next pod
              restart.
            </p>
            <Controller
              control={control}
              name="envMappings"
              render={({ field }) => (
                <EnvMappingsEditor
                  value={field.value}
                  onChange={field.onChange}
                  disabled={saving}
                />
              )}
            />
            <FormError message={errors.envMappings?.message} />
          </div>
        </div>

        <div className="px-7 py-4 border-t-2 border-border-light flex justify-end gap-3">
          <button
            type="button"
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
            disabled={!canSave}
          >
            {saving ? "..." : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
