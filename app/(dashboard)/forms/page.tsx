"use client";

/**
 * Forms Page
 *
 * One card per form. Each has a public link you paste into your own website;
 * whoever fills it in becomes a Contact, and — if the form is wired to a
 * calendar — lands on the booking page next.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { starterFields } from "@/components/form-field-builder";

interface FormSummary {
  id: string;
  name: string;
  slug: string;
  headline: string | null;
  isActive: boolean;
  calendar: { id: string; name: string } | null;
  _count: { submissions: number };
}

export default function FormsPage() {
  const router = useRouter();
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchForms = useCallback(async () => {
    try {
      const res = await fetch("/api/forms", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setForms(data.data);
      } else {
        setError(data.error ?? "Failed to load forms");
      }
    } catch (err) {
      console.error("Failed to fetch forms:", err);
      setError("Failed to load forms");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchForms();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchForms]);

  async function createForm() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New form",
          headline: "Get in touch",
          // Name, email and phone: the questions every lead form asks anyway.
          fields: starterFields(),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to create form");
        return;
      }
      router.push(`/forms/${data.data.id}`);
    } catch (err) {
      console.error("Failed to create form:", err);
      setError("Failed to create form");
    } finally {
      setCreating(false);
    }
  }

  async function copyLink(form: FormSummary) {
    const url = `${window.location.origin}/f/${form.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(form.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      prompt("Copy this form link:", url);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted">
          Build a form, copy its link, and put it on your website. Answers
          become contacts, and you can send people straight to a booking page
          afterwards.
        </p>
        <button
          onClick={createForm}
          disabled={creating}
          className="shrink-0 self-start rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {creating ? "Creating…" : "New form"}
        </button>
      </div>

      {error && (
        <p className="rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="panel h-32 rounded" />
          ))}
        </div>
      )}

      {!loading && forms.length === 0 && (
        <div className="panel rounded p-12 text-center">
          <p className="text-sm text-muted">
            No forms yet. Create one to start collecting leads.
          </p>
        </div>
      )}

      {!loading && forms.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {forms.map((form) => (
            <div key={form.id} className="panel rounded p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/forms/${form.id}`}
                    className="block truncate text-base font-semibold hover:text-accent"
                  >
                    {form.name}
                  </Link>
                  <p className="mt-1 text-xs text-muted">
                    {form._count.submissions} submission
                    {form._count.submissions === 1 ? "" : "s"}
                  </p>
                </div>
                {!form.isActive && (
                  <span className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-muted">
                    Off
                  </span>
                )}
              </div>

              <p className="mt-3 text-sm text-muted">
                {form.calendar ? (
                  <>
                    Sends people to{" "}
                    <span className="text-foreground">{form.calendar.name}</span>{" "}
                    to book
                  </>
                ) : (
                  "Not linked to a calendar"
                )}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/forms/${form.id}`}
                  className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  Edit
                </Link>
                <button
                  onClick={() => copyLink(form)}
                  className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  {copiedId === form.id ? "Copied" : "Copy form link"}
                </button>
                <a
                  href={`/f/${form.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  Preview
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
