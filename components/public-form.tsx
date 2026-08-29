"use client";

/**
 * Public Form
 *
 * A standalone lead-capture form — one that is not attached to any calendar.
 * A form used as a booking step is rendered by the booking widget instead, so
 * both steps can be saved in one transaction.
 */

import { useState } from "react";
import FormFieldsRenderer from "@/components/form-fields-renderer";
import type { Answers, FormField } from "@/lib/forms/fields";
import { HONEYPOT_FIELD } from "@/lib/honeypot";

type Props = {
  slug: string;
  headline: string;
  description: string | null;
  submitButtonLabel: string;
  successMessage: string;
  fields: FormField[];
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
        <FormFieldsRenderer
          fields={fields}
          answers={answers}
          onChange={setAnswers}
        />

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
