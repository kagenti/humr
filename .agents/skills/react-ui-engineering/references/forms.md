# Forms

**Read when:** building any form, adding fields to an existing form, validating user input, deciding between controlled `useState` and React Hook Form.

## When to reach for React Hook Form + Zod

**[HIGH]** Use React Hook Form + Zod when **any** of these is true:

- **≥ 3 fields.**
- **Cross-field validation** (e.g., `confirmPassword === password`, or "at least one of these three is required").
- **Multi-step flow** (wizard, tabs that must share validation state).
- **Dirty-tracking needed** (disable "Save" unless something changed; warn on navigate-away with unsaved changes).
- **Schema reuse** — the same shape is used for submit, for parsing an API response, and for pre-filling edit forms.

Below the threshold (a 1–2 field input, a search box, an inline edit), controlled `useState` is fine. Don't bring RHF + Zod for a single textbox.

## The default stack

```ts
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
```

- **Zod** defines the schema; the form's values type is `z.infer<typeof schema>`.
- **RHF** manages register/state/validation/submit.
- **`zodResolver`** glues them.

## Schema + values type

**[HIGH] Schema is the source of truth.** Values type is inferred.

```ts
// src/modules/agents/api/schemas.ts (or types.ts)
export const createAgentSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  model: z.enum(["sonnet", "opus", "haiku"]),
  systemPrompt: z.string().min(1),
  required: z.boolean().default(false),
});
export type CreateAgentValues = z.infer<typeof createAgentSchema>;
```

When the schema is consumed by both the form and an API call (e.g., the mutation input), reuse it — don't redeclare the shape.

## Form setup

```tsx
const form = useForm<CreateAgentValues>({
  resolver: zodResolver(createAgentSchema),
  defaultValues: {
    name: "",
    description: "",
    model: "sonnet",
    systemPrompt: "",
    required: false,
  },
  mode: "onBlur",
});

const createAgent = useCreateAgent({ onSuccess: () => closeDialog() });

const onSubmit = form.handleSubmit(async (values) => {
  await createAgent.mutateAsync(values);
});
```

- **`defaultValues`** always set explicitly; never rely on `undefined` → first render renders uncontrolled inputs and RHF yells.
- **`mode: "onBlur"`** is a good default — validate when the user leaves a field, not on every keystroke.
- **Submit goes via a mutation.** Don't `fetch` inside the submit handler.

## Field components

**[HIGH] Build a `FormField` wrapper for the common fields** (text, textarea, select, checkbox). It standardizes label + input + error rendering and takes most of the boilerplate out of every form.

```tsx
// src/components/form/form-text-field.tsx
interface Props {
  name: string;
  label: string;
  control: Control<any>;
  rules?: Parameters<Control["register"]>[1];
  placeholder?: string;
  autoFocus?: boolean;
}
export function FormTextField({ name, label, control, rules, placeholder, autoFocus }: Props) {
  return (
    <Controller
      control={control}
      name={name}
      rules={rules}
      render={({ field, fieldState }) => (
        <div className="flex flex-col gap-1">
          <label htmlFor={name} className="text-sm font-medium">{label}</label>
          <input
            {...field}
            id={name}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className={cn("input", fieldState.invalid && "input-error")}
          />
          {fieldState.error && <span className="text-xs text-danger">{fieldState.error.message}</span>}
        </div>
      )}
    />
  );
}
```

In the form:
```tsx
<FormTextField control={form.control} name="name" label="Name" autoFocus />
```

**[MODERATE]** Prefer `Controller` for anything that isn't a plain input (selects, custom components, date pickers). Use `register` for plain `<input>` / `<textarea>`. Don't mix both for the same field.

## Validation: schema vs UI

**[HIGH]** Put **data-shape validation** in the Zod schema (`min(1)`, `max(500)`, `email()`, `enum(...)`). Put **UX-only validation** in the component's `rules` or local logic (e.g., "cannot submit while async check is pending"). The schema is shared with the server; UX rules are client-only.

## Cross-field validation

Use Zod's `.refine()` or `.superRefine()`:

```ts
export const schema = z.object({
  password: z.string().min(8),
  confirmPassword: z.string(),
}).refine((v) => v.password === v.confirmPassword, {
  message: "Passwords must match",
  path: ["confirmPassword"],
});
```

Path tells RHF where to attach the error so the right field lights up.

## Dirty-tracking

RHF gives you `formState.isDirty` and per-field `dirtyFields`. Use these to:

- Disable the Save button: `disabled={!form.formState.isDirty || createAgent.isPending}`.
- Warn on navigate-away: intercept route change when `isDirty` is true.

Don't reinvent dirty-tracking with refs and deep-compare of initial vs current values. RHF makes this free.

## Resetting the form

On successful submit, either close the dialog (so the form unmounts) or `form.reset(newDefaults)` if you're staying on the page. Don't leave stale values in a persistent form.

## Async validation

For validation that requires a server round-trip (e.g., "is this username taken?"), use a debounced TQ query keyed on the field value plus `form.trigger(fieldName)` or a manual error via `form.setError`. Don't block submit while typing — check on blur or submit.

## Submit errors from the server

When the mutation fails with a field-level error (e.g., "Name already exists"), surface it via `form.setError`:

```ts
await createAgent.mutateAsync(values, {
  onError: (err) => {
    const fieldErrors = extractFieldErrors(err);
    Object.entries(fieldErrors).forEach(([name, message]) => {
      form.setError(name as keyof CreateAgentValues, { type: "server", message });
    });
  },
});
```

Global failure (500, network) gets a toast via `meta.errorToast` on the mutation — don't duplicate it into the form.

## Anti-patterns

- **`useState` mega-form** (14 fields in useState) — convert to RHF + Zod.
- **Manual dirty-tracking** with refs/initial-state copies — use `formState.isDirty`.
- **Fetching inside the submit handler** — use a mutation.
- **Validation duplicated in Zod and in the component** — move shape validation to the schema, UX to the component.
- **No `defaultValues`** — sets inputs to uncontrolled on first render.
- **Mixing `register` and `Controller` on the same field** — pick one.
- **Form-level error UI that doesn't use `formState.errors`** — you're fighting RHF.
