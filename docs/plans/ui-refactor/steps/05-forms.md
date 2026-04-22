# Step 05 — Forms

**Goal:** every form that clears the threshold uses React Hook Form + Zod. Below the threshold, controlled `useState` is fine.

**Skill reference:** [`references/forms.md`](../../../../.agents/skills/react-ui-engineering/references/forms.md).

**Preconditions:** step 04 (splitting) complete — converting a form inside a 760-line dialog is much easier once the dialog has been broken apart.

---

## Threshold

Use RHF + Zod when **any one** of these is true:

- ≥ 3 fields.
- Cross-field validation (e.g., "end date > start date", "if X then Y required").
- Multi-step flow (wizard).
- Dirty-tracking matters (disable Save until changed; prompt on close).

Below the threshold (a single input in a dialog, a search box), controlled `useState` is fine — don't force RHF.

## Recipe

### Define the schema first

```ts
// modules/{domain}/forms/{form-name}-schema.ts
import { z } from "zod";

export const editSecretSchema = z.object({
  name: z.string().min(1, "Required").max(128),
  kind: z.enum(["api-key", "oauth", "basic"]),
  value: z.string().min(1),
  envMapping: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
});

export type EditSecretValues = z.infer<typeof editSecretSchema>;
```

The schema is the single source of truth: types flow from it.

### Wire RHF + zodResolver

```tsx
const form = useForm<EditSecretValues>({
  resolver: zodResolver(editSecretSchema),
  defaultValues: { name: "", kind: "api-key", value: "" },
});
```

### Replace manual dirty-tracking

Anti-pattern:

```tsx
const initialMode = useRef(mode);
const initialAssigned = useRef(assigned);
const isDirty = mode !== initialMode.current || !setsEqual(assigned, initialAssigned.current);
```

Fix: `formState.isDirty`. Wire Save disabled state and the close-confirmation to that.

### Submit via TQ mutation

```tsx
const updateSecret = useUpdateSecret(); // from step 02
const onSubmit = form.handleSubmit((values) => {
  updateSecret.mutate(values, { onSuccess: onClose });
});
```

### Validation messages

Let Zod provide them. Components render `formState.errors.fieldName?.message` directly — no custom error mapping.

### Field components

Build thin field wrappers so you don't restate label + error scaffolding:

```tsx
<FormField label="Name" error={errors.name?.message}>
  <input {...register("name")} className="..." />
</FormField>
```

Keep the field wrapper generic — it's a primitive, not domain-specific.

## Definition of done

- Every form in the domain that crosses the threshold uses RHF + Zod.
- No form holds initial-value refs for manual dirty tracking.
- Schemas live in `modules/{domain}/forms/`; types are inferred via `z.infer`.
- Submit paths go through TQ mutations (no direct `platform.xxx.mutation()` in form handlers).
- `mise run check` green.

## How to verify

1. **`mise run check`** — must pass.
2. **Playwright (preferred for forms):** for each RHF-converted form, exercise:
   - Blur an invalid field → error message appears.
   - Fill validly → Save enables.
   - Open, don't change anything → Save is disabled from the start.
   - Close with pending changes → confirm-close fires.
   - Successful submit → close + list refreshed (invalidation from step 02).
3. **User test** — keyboard navigation and accessibility: tab order, Enter submits, Escape closes, error messages are announced.
4. **Visual diff** — error styling unchanged. Don't smuggle a UI redesign in a form refactor.
