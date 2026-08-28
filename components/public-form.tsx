"use client";

/**
 * Public Form
 *
 * Renders a form's questions for a stranger and posts the answers. Every rule
 * enforced here is enforced again on the server — this layer exists to make
 * the page pleasant, not to make it safe.
 */

import { useState } from "react";
import { isMultiValue, type Answers, type FormField } from "@/lib/forms/fields";
import { HONEYPOT_FIELD } from "@/lib/honeypot";

type Props = {
  slug: string;
  headline: string;
  description: string | null;
  submitButtonLabel: string;
  successMessage: string;
  fields: FormField[];
};

const controlClass =
  "w-full rounded-lg border border-border bg-background px-3.5 py-3 text-sm transition-colors focus:border-accent";

/** Maps a field type onto the native input type that already validates it. */
const INPUT_TYPES: Partial<Record<FormField["type"], string>> = {
  email: "email",
  phone: "tel",
  url: "url",
};

export default function PublicForm({
  slug,
  headline,
  description,
  submitButtonLabel,
  successMessage,
  fields,
}: Props) {
  const [answers, setAnswers] = useState<Answers>({});
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function setAnswer(fieldId: string, value: string | string[]) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  }

  function toggleChoice(field: FormField, option: string, checked: boolean) {
    const current = answers[field.id];
    const list = Array.isArray(current) ? current : [];
    setAnswer(
      field.id,
      checked ? [...list, option] : list.filter((item) => item !== option)
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/form/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, [HONEYPOT_FIELD]: honeypot }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Could not send that. Check your answers.");
        return;
      }
      if (data.data?.redirectTo) {
        window.location.href = data.data.redirectTo;
        return;
      }
      setDone(true);
    } catch (err) {
      console.error("Failed to submit form:", err);
      setError("Could not send that. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="panel rounded-lg p-8 text-center sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-2xl text-success">
          ✓
        </div>
        <p className="mx-auto mt-5 max-w-md text-base leading-7">
          {successMessage}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="panel overflow-hidden rounded-lg">
      <header className="border-b border-border px-6 py-6 sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">{headline}</h1>
        {description && (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            {description}
          </p>
        )}
      </header>

      <div className="space-y-6 px-6 py-7 sm:px-8">
        {fields.map((field) => {
          const value = answers[field.id];
          const text = typeof value === "string" ? value : "";

          return (
            <div key={field.id}>
              <label
                htmlFor={field.id}
                className="mb-2 block text-sm font-medium"
              >
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

        {/* Bots fill every input they find; people never see this one. */}
        <input
          type="text"
          name={HONEYPOT_FIELD}
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        {error && (
          <p className="rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || fields.length === 0}
          className="w-full rounded-lg bg-accent px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? "Sending…" : submitButtonLabel}
        </button>
      </div>
    </form>
  );
}
