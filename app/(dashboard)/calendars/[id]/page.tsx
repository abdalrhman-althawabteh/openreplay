"use client";

/**
 * Calendar Settings
 *
 * Everything about one calendar: when it is open, which form it asks, and in
 * what order the two steps appear on the public page. Appointments themselves
 * live under /calendars.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import CalendarHoursEditor from "@/components/calendar-hours-editor";
import type { Availability } from "@/lib/calendars/slots";

interface Calendar {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  timezone: string;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  availability: Availability;
  isActive: boolean;
  formId: string | null;
  formFirst: boolean;
  successMessage: string;
  redirectUrl: string | null;
}

interface FormOption {
  id: string;
  name: string;
}

const fieldClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm";

export default function CalendarSettingsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const calendarId = params.id;

  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [forms, setForms] = useState<FormOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCalendar = useCallback(async () => {
    try {
      const res = await fetch(`/api/calendars?id=${calendarId}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.success) setCalendar(data.data);
      else setError(data.error ?? "Failed to load calendar");
    } catch (err) {
      console.error("Failed to fetch calendar:", err);
      setError("Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [calendarId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCalendar();
      void fetch("/api/forms", { cache: "no-store" })
        .then((res) => res.json())
        .then((payload) => {
          if (payload.success) setForms(payload.data);
        })
        .catch(console.error);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchCalendar]);

  function patchCalendar(changes: Partial<Calendar>) {
    setSaved(false);
    setCalendar((prev) => (prev ? { ...prev, ...changes } : prev));
  }

  async function save() {
    if (!calendar) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendars?id=${calendar.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: calendar.name,
          description: calendar.description,
          timezone: calendar.timezone,
          durationMinutes: calendar.durationMinutes,
          bufferMinutes: calendar.bufferMinutes,
          minNoticeHours: calendar.minNoticeHours,
          maxDaysAhead: calendar.maxDaysAhead,
          availability: calendar.availability,
          isActive: calendar.isActive,
          formId: calendar.formId ?? "",
          formFirst: calendar.formFirst,
          successMessage: calendar.successMessage,
          redirectUrl: calendar.redirectUrl ?? "",
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
            : data.error ?? "Failed to save calendar"
        );
        return;
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save calendar:", err);
      setError("Failed to save calendar");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCalendar() {
    if (!calendar) return;
    if (
      !confirm(
        `Delete "${calendar.name}"? Every booking on it goes too, and the public link stops working. This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/calendars?id=${calendar.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to delete calendar");
        return;
      }
      router.push("/calendars?view=calendars");
      router.refresh();
    } catch (err) {
      console.error("Failed to delete calendar:", err);
      setError("Failed to delete calendar");
    }
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (!calendar) {
    return (
      <div className="panel rounded p-12 text-center">
        <p className="text-sm text-muted">{error ?? "Calendar not found."}</p>
        <Link
          href="/calendars?view=calendars"
          className="mt-4 inline-block text-sm text-accent hover:underline"
        >
          Back to calendars
        </Link>
      </div>
    );
  }

  const bookingUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/book/${calendar.slug}`
      : `/book/${calendar.slug}`;

  // Step 1 is whichever widget comes first. With no form attached there is only
  // one step, so the order control has nothing to order.
  const steps = calendar.formFirst
    ? ["Form", "Date & time selector"]
    : ["Date & time selector", "Form"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/calendars?view=calendars"
          className="text-sm text-muted hover:text-foreground"
        >
          ← Calendars
        </Link>
        <a
          href={`/book/${calendar.slug}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto truncate rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          {bookingUrl}
        </a>
      </div>

      {error && (
        <p className="rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Basics and availability ──────────────────────────────────── */}
        <div className="panel space-y-5 rounded p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Basics
          </h2>

          <label className="block">
            <span className="mb-1.5 block text-sm">Name</span>
            <input
              value={calendar.name}
              onChange={(e) => patchCalendar({ name: e.target.value })}
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm">
              Description{" "}
              <span className="text-muted">— shown on the booking page</span>
            </span>
            <textarea
              value={calendar.description ?? ""}
              onChange={(e) => patchCalendar({ description: e.target.value })}
              rows={2}
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm">Time zone</span>
            <select
              value={calendar.timezone}
              onChange={(e) => patchCalendar({ timezone: e.target.value })}
              className={fieldClass}
            >
              {/* The runtime ships the full IANA list, so there is no reason to
                  hardcode a shortlist that would go stale. */}
              {Intl.supportedValuesOf("timeZone").map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1.5 block text-sm">Length (min)</span>
              <input
                type="number"
                min={5}
                max={480}
                value={calendar.durationMinutes}
                onChange={(e) =>
                  patchCalendar({ durationMinutes: Number(e.target.value) })
                }
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm">Gap between (min)</span>
              <input
                type="number"
                min={0}
                max={240}
                value={calendar.bufferMinutes}
                onChange={(e) =>
                  patchCalendar({ bufferMinutes: Number(e.target.value) })
                }
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm">Notice (hours)</span>
              <input
                type="number"
                min={0}
                max={720}
                value={calendar.minNoticeHours}
                onChange={(e) =>
                  patchCalendar({ minNoticeHours: Number(e.target.value) })
                }
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm">Book up to (days)</span>
              <input
                type="number"
                min={1}
                max={365}
                value={calendar.maxDaysAhead}
                onChange={(e) =>
                  patchCalendar({ maxDaysAhead: Number(e.target.value) })
                }
                className={fieldClass}
              />
            </label>
          </div>

          <div>
            <span className="mb-2 block text-sm">Weekly hours</span>
            <CalendarHoursEditor
              value={calendar.availability}
              onChange={(availability) => patchCalendar({ availability })}
            />
          </div>

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={calendar.isActive}
              onChange={(e) => patchCalendar({ isActive: e.target.checked })}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Accepting bookings
          </label>
        </div>

        {/* ── Form & confirmation ──────────────────────────────────────── */}
        <div className="panel h-fit space-y-5 rounded p-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Form &amp; confirmation
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              What the booking page collects, and in what order.
            </p>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm">Select form</span>
            <select
              value={calendar.formId ?? ""}
              onChange={(e) => patchCalendar({ formId: e.target.value || null })}
              className={fieldClass}
            >
              <option value="">
                No form — just ask for name, email and phone
              </option>
              {forms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name}
                </option>
              ))}
            </select>
            <span className="mt-1.5 block text-xs text-muted">
              The form needs an email question, so bookings can be matched to a
              contact.
            </span>
          </label>

          {calendar.formId && (
            <div>
              <span className="mb-2 block text-sm">Widget order</span>
              <div className="overflow-hidden rounded border border-border">
                {steps.map((label, index) => (
                  <div
                    key={label}
                    className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-0"
                  >
                    <span className="w-14 shrink-0 text-xs text-muted">
                      Step {index + 1}
                    </span>
                    <span className="flex-1 text-sm font-medium">{label}</span>
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => patchCalendar({ formFirst: !calendar.formFirst })}
                        disabled={index === 0}
                        aria-label={`Move ${label} up`}
                        className="px-1.5 text-xs text-muted hover:text-foreground disabled:opacity-25"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => patchCalendar({ formFirst: !calendar.formFirst })}
                        disabled={index === steps.length - 1}
                        aria-label={`Move ${label} down`}
                        className="px-1.5 text-xs text-muted hover:text-foreground disabled:opacity-25"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-border pt-5">
            <h3 className="text-sm font-semibold">Confirmation page</h3>
            <p className="mt-1 text-sm text-muted">
              Shown after a successful booking.
            </p>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm">Thank-you message</span>
              <textarea
                rows={2}
                value={calendar.successMessage}
                onChange={(e) =>
                  patchCalendar({ successMessage: e.target.value })
                }
                className={fieldClass}
              />
            </label>
          </div>
        </div>
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
          onClick={deleteCalendar}
          className="ml-auto text-sm text-muted hover:text-error"
        >
          Delete calendar
        </button>
      </div>
    </div>
  );
}
