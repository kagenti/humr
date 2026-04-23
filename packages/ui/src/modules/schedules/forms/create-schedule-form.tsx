import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormError } from "../../../components/form-error.js";
import { useCreateSchedule } from "../api/mutations.js";

export const createScheduleSchema = z.object({
  name: z.string().trim().min(1, "Required"),
  cron: z.string().trim().min(1, "Required"),
  task: z.string().trim().min(1, "Required"),
  sessionMode: z.enum(["fresh", "continuous"]),
});

export type CreateScheduleValues = z.infer<typeof createScheduleSchema>;

const INPUT_CLASS =
  "w-full h-8 rounded-md border-2 border-border-light bg-surface px-3 text-[12px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]";

interface Props {
  instanceId: string;
  onCancel: () => void;
  onCreated: () => void;
}

export function CreateScheduleForm({ instanceId, onCancel, onCreated }: Props) {
  const createSchedule = useCreateSchedule();
  const { register, handleSubmit, watch, setValue, formState } =
    useForm<CreateScheduleValues>({
      resolver: zodResolver(createScheduleSchema),
      mode: "onChange",
      defaultValues: { name: "", cron: "", task: "", sessionMode: "fresh" },
    });
  const { errors, isValid } = formState;
  const sessionMode = watch("sessionMode");

  const onSubmit = handleSubmit((values) => {
    createSchedule.mutate(
      { ...values, instanceId },
      { onSuccess: onCreated },
    );
  });

  return (
    <form
      className="flex flex-col gap-3 border-b border-border-light p-4 anim-in"
      onSubmit={onSubmit}
    >
      <div>
        <input className={INPUT_CLASS} placeholder="Name" {...register("name")} />
        <FormError message={errors.name?.message} />
      </div>
      <div>
        <input className={`${INPUT_CLASS} font-mono`} placeholder="Cron expression" {...register("cron")} />
        <FormError message={errors.cron?.message} />
      </div>
      <div>
        <textarea
          className="w-full rounded-md border-2 border-border-light bg-surface px-3 py-2 text-[12px] text-text outline-none transition-all focus:border-accent resize-y min-h-[50px]"
          placeholder="Task prompt"
          rows={2}
          {...register("task")}
        />
        <FormError message={errors.task?.message} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-text-secondary">Session:</span>
        {(["fresh", "continuous"] as const).map(mode => (
          <button
            key={mode}
            type="button"
            className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 capitalize ${sessionMode === mode ? "bg-accent text-white border-accent-hover" : "bg-surface text-text-muted border-border-light"}`}
            onClick={() => setValue("sessionMode", mode, { shouldDirty: true })}
          >
            {mode}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="h-7 rounded-md border-2 border-border-light px-3 text-[11px] font-semibold text-text-muted hover:text-text transition-colors"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn-brutal h-7 rounded-md border-2 border-accent-hover bg-accent px-3.5 text-[11px] font-bold text-white shadow-brutal-accent disabled:opacity-40"
          disabled={!isValid || createSchedule.isPending}
        >
          {createSchedule.isPending ? "..." : "Create"}
        </button>
      </div>
    </form>
  );
}
