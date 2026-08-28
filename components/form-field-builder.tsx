"use client";

/**
 * Form Field Builder
 *
 * Add, relabel, retype, reorder and remove a form's questions. Reordering uses
 * up/down buttons rather than drag-and-drop: no dependency, and it works with a
 * keyboard and on a phone, where dragging a list is miserable.
 */

import {
  CONTACT_TARGETS,
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  MAX_FIELDS,
  hasOptions,
  type ContactTarget,
  type FieldType,
  type FormField,
} from "@/lib/forms/fields";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm";

/** A short, stable id. Only has to be unique within one form. */
function newFieldId() {
  return `f_${Math.random().toString(36).slice(2, 10)}`;
}

export function blankField(type: FieldType = "short_text"): FormField {
  return {
    id: newFieldId(),
    type,
    label: "",
    placeholder: null,
    required: false,
    options: hasOptions(type) ? ["Option 1"] : [],
    mapTo: type === "email" ? "email" : type === "phone" ? "phone" : null,
  };
}

/** The three questions almost every lead form starts with. */
export function starterFields(): FormField[] {
  return [
    { ...blankField("short_text"), label: "Full name", required: true, mapTo: "name" },
    { ...blankField("email"), label: "Email", required: true },
    { ...blankField("phone"), label: "Phone" },
  ];
}

export default function FormFieldBuilder({
  fields,
  onChange,
}: {
  fields: FormField[];
  onChange: (next: FormField[]) => void;
}) {
  function update(index: number, changes: Partial<FormField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...changes } : f)));
  }

  function changeType(index: number, type: FieldType) {
    const field = fields[index];
    update(index, {
      type,
      // Switching to a choice type needs somewhere to start; switching away
      // drops the options so they can't linger invisibly.
      options: hasOptions(type)
        ? field.options.length > 0
          ? field.options
          : ["Option 1"]
        : [],
      mapTo:
        type === "email" ? "email" : type === "phone" ? "phone" : field.mapTo,
    });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <p className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          No questions yet. Add one below.
        </p>
      )}

      {fields.map((field, index) => (
        <div key={field.id} className="rounded border border-border p-4">
          <div className="flex items-start gap-3">
            <div className="flex flex-col gap-1 pt-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move question up"
                className="px-1.5 text-xs text-muted hover:text-foreground disabled:opacity-25"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === fields.length - 1}
                aria-label="Move question down"
                className="px-1.5 text-xs text-muted hover:text-foreground disabled:opacity-25"
              >
                ▼
              </button>
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <input
                value={field.label}
                onChange={(e) => update(index, { label: e.target.value })}
                placeholder="Question, e.g. What are you looking for?"
                className={`${inputClass} font-medium`}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-muted">Type</span>
                  <select
                    value={field.type}
                    onChange={(e) =>
                      changeType(index, e.target.value as FieldType)
                    }
                    className={inputClass}
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {FIELD_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs text-muted">
                    Save to contact
                  </span>
                  <select
                    value={field.mapTo ?? ""}
                    onChange={(e) =>
                      update(index, {
                        mapTo: (e.target.value || null) as ContactTarget | null,
                      })
                    }
                    className={inputClass}
                  >
                    <option value="">Just keep the answer</option>
                    {CONTACT_TARGETS.map((target) => (
                      <option key={target} value={target}>
                        {target.charAt(0).toUpperCase() + target.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {!hasOptions(field.type) && (
                <input
                  value={field.placeholder ?? ""}
                  onChange={(e) =>
                    update(index, { placeholder: e.target.value })
                  }
                  placeholder="Placeholder (optional)"
                  className={inputClass}
                />
              )}

              {hasOptions(field.type) && (
                <div className="space-y-2">
                  <span className="block text-xs text-muted">Choices</span>
                  {field.options.map((option, optionIndex) => (
                    <div key={optionIndex} className="flex items-center gap-2">
                      <input
                        value={option}
                        onChange={(e) =>
                          update(index, {
                            options: field.options.map((o, i) =>
                              i === optionIndex ? e.target.value : o
                            ),
                          })
                        }
                        className={inputClass}
                      />
                      {field.options.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            update(index, {
                              options: field.options.filter(
                                (_, i) => i !== optionIndex
                              ),
                            })
                          }
                          className="shrink-0 text-xs text-muted hover:text-error"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      update(index, {
                        options: [
                          ...field.options,
                          `Option ${field.options.length + 1}`,
                        ],
                      })
                    }
                    className="text-xs text-muted hover:text-foreground"
                  >
                    + Add a choice
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) =>
                      update(index, { required: e.target.checked })
                    }
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() =>
                    onChange(fields.filter((_, i) => i !== index))
                  }
                  className="text-xs text-muted hover:text-error"
                >
                  Remove question
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {fields.length < MAX_FIELDS && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange([...fields, blankField("short_text")])}
            className="rounded border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            + Short answer
          </button>
          <button
            type="button"
            onClick={() => onChange([...fields, blankField("long_text")])}
            className="rounded border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            + Long answer
          </button>
          <button
            type="button"
            onClick={() => onChange([...fields, blankField("select")])}
            className="rounded border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            + Multiple choice
          </button>
          <button
            type="button"
            onClick={() => onChange([...fields, blankField("checkbox")])}
            className="rounded border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            + Checkboxes
          </button>
        </div>
      )}
    </div>
  );
}
