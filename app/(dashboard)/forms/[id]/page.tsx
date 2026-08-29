"use client";

/**
 * Form Editor
 *
 * Settings and questions on the left, what people have answered on the right.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import FormFieldBuilder from "@/components/form-field-builder";
import type { AnswerValue, FormField } from "@/lib/forms/fields";

interface FormRecord {
  id: string;
  name: string;
  slug: string;
  headline: string | null;
  description: string | null;
  submitButtonLabel: string;
  successMessage: string;
  redirectUrl: string | null;
  calendars: { id: string; name: string }[];
  fields: FormField[];
  isActive: boolean;
}

interface Submission {
  id: string;
  answers: Record<string, AnswerValue>;
  country: string | null;
  createdAt: string;
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

const fieldClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm";

export default function FormEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const formId = params.id;

  const [form, setForm] = useState<FormRecord | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchForm = useCallback(async () => {
    try {
      const res = await fetch(`/api/forms?id=${formId}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setForm(data.data);
      } else {
        setError(data.error ?? "Failed to load form");
      }
    } catch (err) {
      console.error("Failed to fetch form:", err);
      setError("Failed to load form");
    } finally {
      setLoading(false);
    }
  }, [formId]);

  const fetchSubmissions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/form-submissions?formId=${formId}&limit=50`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data.success) setSubmissions(data.data.submissions);
    } catch (err) {
      console.error("Failed to fetch submissions:", err);
    }
  }, [formId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchForm();
      void fetchSubmissions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchForm, fetchSubmissions]);

  function patchForm(changes: Partial<FormRecord>) {
    setSaved(false);
    setForm((prev) => (prev ? { ...prev, ...changes } : prev));
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/forms?id=${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          headline: form.headline,
          description: form.description,
          submitButtonLabel: form.submitButtonLabel,
          successMessage: form.successMessage,
          redirectUrl: form.redirectUrl ?? "",
          fields: form.fields,
          isActive: form.isActive,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        const fieldErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const firstField = fieldErrors && Object.keys(fieldErrors)[0];
        setError(
          firstField
            ? `${firstField}: ${fieldErrors[firstField][0]}`
            : data.error ?? "Failed to save form"
        );
        return;
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save form:", err);
      setError("Failed to save form");
    } finally {
      setSaving(false);
    }
  }

  async function deleteForm() {
    if (!form) return;
    if (
      !confirm(
        `Delete "${form.name}"? Its submissions go too, and the public link stops working. This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/forms?id=${form.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to delete form");
        return;
      }
      router.push("/forms");
      router.refresh();
    } catch (err) {
      console.error("Failed to delete form:", err);
      setError("Failed to delete form");
    }
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (!form) {
    return (
      <div className="panel rounded p-12 text-center">
        <p className="text-sm text-muted">{error ?? "Form not found."}</p>
        <Link
          href="/forms"
          className="mt-4 inline-block text-sm text-accent hover:underline"
        >
          Back to forms
        </Link>
      </div>
    );
  }

  const formUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/f/${form.slug}`
      : `/f/${form.slug}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/forms" className="text-sm text-muted hover:text-foreground">
          ← Forms
        </Link>
        <a
          href={`/f/${form.slug}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto truncate rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          {formUrl}
        </a>
      </div>

      {error && (
        <p className="rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* ── Editor ───────────────────────────────────────────────────── */}
        <div className="space-y-6">
          <div className="panel space-y-5 rounded p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Setup
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm">
                  Internal name{" "}
                  <span className="text-muted">— only you see this</span>
                </span>
                <input
                  value={form.name}
                  onChange={(e) => patchForm({ name: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm">Headline on the page</span>
                <input
                  value={form.headline ?? ""}
                  onChange={(e) => patchForm({ headline: e.target.value })}
                  placeholder={form.name}
                  className={fieldClass}
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm">
                Intro text <span className="text-muted">(optional)</span>
              </span>
              <textarea
                value={form.description ?? ""}
                onChange={(e) => patchForm({ description: e.target.value })}
                rows={2}
                className={fieldClass}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm">Button text</span>
                <input
                  value={form.submitButtonLabel}
                  onChange={(e) =>
                    patchForm({ submitButtonLabel: e.target.value })
                  }
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm">Thank-you message</span>
                <input
                  value={form.successMessage}
                  onChange={(e) =>
                    patchForm({ successMessage: e.target.value })
                  }
                  className={fieldClass}
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm">
                Or send them to a URL{" "}
                <span className="text-muted">(optional)</span>
              </span>
              <input
                value={form.redirectUrl ?? ""}
                onChange={(e) => patchForm({ redirectUrl: e.target.value })}
                placeholder="https://…"
                className={fieldClass}
              />
            </label>

            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => patchForm({ isActive: e.target.checked })}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              Accepting submissions
            </label>
          </div>

          <div className="panel rounded p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
              Questions
            </h2>
            <FormFieldBuilder
              fields={form.fields}
              onChange={(fields) => patchForm({ fields })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="text-sm text-success">Saved</span>}
            <button
              onClick={deleteForm}
              className="ml-auto text-sm text-muted hover:text-error"
            >
              Delete form
            </button>
          </div>
        </div>

        {/* ── Submissions ──────────────────────────────────────────────── */}
        <div className="panel rounded p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Submissions
          </h2>

          {submissions.length === 0 && (
            <p className="py-12 text-center text-sm text-muted">
              Nothing yet. Share the link above.
            </p>
          )}

          <div className="mt-4 divide-y divide-border">
            {submissions.map((submission) => (
              <div key={submission.id} className="py-4 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {submission.contact?.name ??
                      submission.contact?.email ??
                      "Anonymous"}
                  </p>
                  <p className="text-xs text-muted">
                    {new Date(submission.createdAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>

                <div className="mt-2 space-y-1 text-sm">
                  {Object.entries(submission.answers).map(([label, value]) => (
                    <p key={label}>
                      <span className="text-muted">{label}: </span>
                      {Array.isArray(value) ? value.join(", ") : value}
                    </p>
                  ))}
                </div>

                {submission.contact && (
                  <Link
                    href="/contacts"
                    className="mt-2 inline-block text-xs text-muted hover:text-foreground"
                  >
                    View in contacts →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
