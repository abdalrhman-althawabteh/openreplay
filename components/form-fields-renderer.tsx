"use client";

/**
 * Form Fields Renderer
 *
 * Renders a form's questions and reports the answers back. Shared by the
 * standalone public form page and by the booking widget's form step, so a
 * question looks and behaves identically wherever it is asked.
 *
 * Every rule enforced here is enforced again on the server — this layer exists
 * to make the page pleasant, not to make it safe.
 */

import { isMultiValue, type Answers, type FormField } from "@/lib/forms/fields";

const controlClass =
  "w-full rounded-lg border border-border bg-background px-3.5 py-3 text-sm transition-colors focus:border-accent";

/** Maps a field type onto the native input type that already validates it. */
const INPUT_TYPES: Partial<Record<FormField["type"], string>> = {
  email: "email",
  phone: "tel",
  url: "url",
};

export default function FormFieldsRenderer({
  fields,
  answers,
  onChange,
}: {
  fields: FormField[];
  answers: Answers;
  onChange: (answers: Answers) => void;
}) {
  function setAnswer(fieldId: string, value: string | string[]) {
    onChange({ ...answers, [fieldId]: value });
  }

  function toggleChoice(field: FormField, option: string, checked: boolean) {
    const current = answers[field.id];
    const list = Array.isArray(current) ? current : [];
    setAnswer(
      field.id,
      checked ? [...list, option] : list.filter((item) => item !== option)
    );
  }

  return (
    <>
      {fields.map((field) => {
        const value = answers[field.id];
        const text = typeof value === "string" ? value : "";

        return (
          <div key={field.id}>
            <label htmlFor={field.id} className="mb-2 block text-sm font-medium">
              {field.label}
              {field.required && <span className="ml-1 text-error">*</span>}
            </label>

            {field.type === "long_text" || field.type === "address" ? (
              <textarea
                id={field.id}
                required={field.required}
                rows={field.type === "address" ? 3 : 4}
                value={text}
                placeholder={field.placeholder ?? undefined}
                onChange={(e) => setAnswer(field.id, e.target.value)}
                className={controlClass}
              />
            ) : field.type === "select" ? (
              <div className="space-y-2">
                {field.options.map((option) => (
                  <label
                    key={option}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-sm transition-colors ${
                      text === option
                        ? "border-accent bg-accent/5"
                        : "border-border hover:border-border-hover"
                    }`}
                  >
                    <input
                      type="radio"
                      name={field.id}
                      required={field.required}
                      checked={text === option}
                      onChange={() => setAnswer(field.id, option)}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    {option}
                  </label>
                ))}
              </div>
            ) : isMultiValue(field.type) ? (
              <div className="space-y-2">
                {field.options.map((option) => {
                  const list = Array.isArray(value) ? value : [];
                  const checked = list.includes(option);
                  return (
                    <label
                      key={option}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-sm transition-colors ${
                        checked
                          ? "border-accent bg-accent/5"
                          : "border-border hover:border-border-hover"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          toggleChoice(field, option, e.target.checked)
                        }
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                      {option}
                    </label>
                  );
                })}
              </div>
            ) : (
              <input
                id={field.id}
                type={INPUT_TYPES[field.type] ?? "text"}
                required={field.required}
                value={text}
                placeholder={field.placeholder ?? undefined}
                onChange={(e) => setAnswer(field.id, e.target.value)}
                className={controlClass}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
