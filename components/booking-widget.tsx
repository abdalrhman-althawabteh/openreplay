"use client";

/**
 * Public Booking Widget
 *
 * The whole customer-facing flow behind one calendar link: a form step and a
 * date/time step, in whichever order the owner set (`formFirst`). When no form
 * is attached the time step asks for name, email and phone itself.
 *
 * Nothing is written until the last step is submitted — both halves land in one
 * request, so abandoning halfway leaves no orphan contact or submission.
 *
 * Times are shown in the visitor's own zone; the server only ever deals in UTC
 * instants, and the zone the visitor saw is sent back with the booking.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import FormFieldsRenderer from "@/components/form-fields-renderer";
import { monthGrid, monthOf } from "@/lib/calendars/slots";
import type { Answers, FormField } from "@/lib/forms/fields";
import { HONEYPOT_FIELD } from "@/lib/honeypot";

type WidgetForm = {
  headline: string | null;
  description: string | null;
  submitButtonLabel: string;
  fields: FormField[];
};

type Props = {
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  formFirst: boolean;
  successMessage: string;
  form: WidgetForm | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const controlClass =
  "w-full rounded-lg border border-border bg-background px-3.5 py-3 text-sm";

/** "YYYY-MM" for the month a Date falls in, in the given zone. */
function monthKey(date: Date, timeZone: string) {
  return date.toLocaleDateString("en-CA", { timeZone }).slice(0, 7);
}

export default function BookingWidget({
  slug,
  name,
  description,
  durationMinutes,
  formFirst,
  successMessage,
  form,
}: Props) {
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  );

  // Which of the two steps is showing. The form step only exists when a form
  // is attached, so a form-less calendar is always on step 2.
  const [step, setStep] = useState<1 | 2>(form ? 1 : 2);

  const [month, setMonth] = useState(() => monthKey(new Date(), timezone));
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Answers>({});
  const [details, setDetails] = useState({ name: "", email: "", phone: "" });
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const [year, monthNumber] = month.split("-").map(Number);
  const weeks = useMemo(() => monthGrid(year, monthNumber), [year, monthNumber]);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    try {
      // The grid's first and last cells, so padding days from the neighbouring
      // months are bookable too rather than showing as dead squares.
      const grid = monthGrid(year, monthNumber);
      const params = new URLSearchParams({ from: grid[0][0], to: grid[5][6] });
      const res = await fetch(`/api/public/calendar/${slug}?${params}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.success) {
        setSlots(data.data.slots);
      } else {
        setError(data.error ?? "Could not load available times");
      }
    } catch (err) {
      console.error("Failed to load slots:", err);
      setError("Could not load available times");
    } finally {
      setLoading(false);
    }
  }, [slug, year, monthNumber]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSlots();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchSlots]);

  /** Slots grouped by the day they fall on *in the visitor's zone*. */
  const byDay = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const slot of slots) {
      const day = new Date(slot).toLocaleDateString("en-CA", {
        timeZone: timezone,
      });
      const existing = groups.get(day);
      if (existing) existing.push(slot);
      else groups.set(day, [slot]);
    }
    return groups;
  }, [slots, timezone]);

  // Derived, not stored: a day this month's slots no longer contain simply
  // stops being selected.
  const activeDay = selectedDay && byDay.has(selectedDay) ? selectedDay : null;
  const daySlots = activeDay ? byDay.get(activeDay) ?? [] : [];

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    setMonth(next.toISOString().slice(0, 7));
    setSelectedDay(null);
    setSelectedSlot(null);
  }

  /** Every required question on the form has an answer. */
  const formComplete = !form
    ? true
    : form.fields.every((field) => {
        if (!field.required) return true;
        const value = answers[field.id];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
      });

  async function book() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/calendar/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: selectedSlot,
          timezone,
          notes,
          [HONEYPOT_FIELD]: honeypot,
          // Exactly one of these applies, and the server decides which from the
          // calendar — sending both would not help.
          ...(form ? { answers } : details),
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
            : data.error ?? "Could not book that time"
        );
        // Someone else took the slot while this visitor was deciding.
        if (res.status === 409) {
          setSelectedSlot(null);
          await fetchSlots();
        }
        return;
      }
      setConfirmed(selectedSlot);
    } catch (err) {
      console.error("Failed to book:", err);
      setError("Could not book that time");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <div className="panel rounded-lg p-8 text-center sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-2xl text-success">
          ✓
        </div>
        <h2 className="mt-5 text-xl font-semibold">You&rsquo;re booked</h2>
        <p className="mt-2 text-sm text-muted">
          {new Date(confirmed).toLocaleString("en-US", {
            timeZone: timezone,
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
        <p className="mt-1 text-xs text-muted">{timezone}</p>
        <p className="mx-auto mt-6 max-w-sm text-sm leading-6 text-muted">
          {successMessage}
        </p>
      </div>
    );
  }

  const stepLabels = form
    ? formFirst
      ? ["Your details", "Pick a time"]
      : ["Pick a time", "Your details"]
    : null;

  // With formFirst the form is step 1; otherwise it is step 2.
  const showingForm = form !== null && (formFirst ? step === 1 : step === 2);

  return (
    <div className="panel overflow-hidden rounded-lg">
      <header className="border-b border-border px-6 py-6 sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <p className="mt-1.5 text-sm text-muted">
          {durationMinutes} minutes · times shown in {timezone}
        </p>
        {description && (
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
            {description}
          </p>
        )}

        {stepLabels && (
          <ol className="mt-5 flex flex-wrap gap-2">
            {stepLabels.map((label, index) => {
              const number = (index + 1) as 1 | 2;
              return (
                <li
                  key={label}
                  className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                    step === number ? "bg-accent/10 text-accent" : "text-muted"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                      step === number
                        ? "bg-accent text-white"
                        : "bg-surface-hover"
                    }`}
                  >
                    {number}
                  </span>
                  {label}
                </li>
              );
            })}
          </ol>
        )}
      </header>

      <div className="px-6 py-6 sm:px-8">
        {/* ── The form step ───────────────────────────────────────────── */}
        {showingForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // On the last step this books; otherwise it advances.
              if (formFirst) setStep(2);
              else void book();
            }}
            className="space-y-6"
          >
            {form?.description && (
              <p className="text-sm leading-6 text-muted">{form.description}</p>
            )}

            <FormFieldsRenderer
              fields={form?.fields ?? []}
              answers={answers}
              onChange={setAnswers}
            />

            {error && (
              <p className="rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              {!formFirst && (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-lg border border-border px-4 py-3 text-sm text-muted hover:text-foreground"
                >
                  Back
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-accent px-6 py-3.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:flex-none sm:px-8"
              >
                {formFirst
                  ? "Next: pick a time"
                  : submitting
                    ? "Booking…"
                    : form?.submitButtonLabel ?? "Book"}
              </button>
            </div>
          </form>
        )}

        {/* ── The date & time step ────────────────────────────────────── */}
        {!showingForm && (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">
                {new Date(
                  Date.UTC(year, monthNumber - 1, 1)
                ).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => shiftMonth(-1)}
                  aria-label="Previous month"
                  className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
                >
                  ←
                </button>
                <button
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                  className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
                >
                  →
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((day) => (
                <div key={day} className="pb-2 text-xs font-medium text-muted">
                  {day}
                </div>
              ))}

              {weeks.flat().map((day) => {
                const available = byDay.has(day);
                const inMonth = monthOf(day) === month;
                const active = day === activeDay;

                return (
                  <button
                    key={day}
                    type="button"
                    disabled={!available}
                    onClick={() => {
                      setSelectedDay(day);
                      setSelectedSlot(null);
                    }}
                    className={`aspect-square rounded-lg text-sm transition-colors ${
                      active
                        ? "bg-accent font-semibold text-white"
                        : available
                          ? "border border-border font-medium hover:border-accent hover:text-accent"
                          : inMonth
                            ? "text-muted/40"
                            : "text-muted/20"
                    }`}
                  >
                    {Number(day.slice(8))}
                  </button>
                );
              })}
            </div>

            {loading && (
              <p className="mt-6 text-center text-sm text-muted">
                Loading available times…
              </p>
            )}

            {!loading && byDay.size === 0 && (
              <p className="mt-6 text-center text-sm text-muted">
                Nothing open this month. Try the next one.
              </p>
            )}

            {activeDay && (
              <>
                <h3 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">
                  {new Date(`${activeDay}T12:00:00`).toLocaleDateString(
                    "en-US",
                    { weekday: "long", month: "long", day: "numeric" }
                  )}
                </h3>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {daySlots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                        slot === selectedSlot
                          ? "border-accent bg-accent text-white"
                          : "border-border hover:border-accent hover:text-accent"
                      }`}
                    >
                      {new Date(slot).toLocaleTimeString("en-US", {
                        timeZone: timezone,
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </button>
                  ))}
                </div>
              </>
            )}

            {selectedSlot && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // Times-first with a form: go on to the questions.
                  if (form && !formFirst) setStep(2);
                  else void book();
                }}
                className="mt-8 border-t border-border pt-6"
              >
                {!form && (
                  <>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                      Your details
                    </h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-sm">Name</span>
                        <input
                          required
                          value={details.name}
                          onChange={(e) =>
                            setDetails({ ...details, name: e.target.value })
                          }
                          className={controlClass}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-sm">Email</span>
                        <input
                          required
                          type="email"
                          value={details.email}
                          onChange={(e) =>
                            setDetails({ ...details, email: e.target.value })
                          }
                          className={controlClass}
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="mb-1.5 block text-sm">
                          Phone <span className="text-muted">(optional)</span>
                        </span>
                        <input
                          type="tel"
                          value={details.phone}
                          onChange={(e) =>
                            setDetails({ ...details, phone: e.target.value })
                          }
                          className={controlClass}
                        />
                      </label>
                    </div>
                  </>
                )}

                <label className="mt-4 block">
                  <span className="mb-1.5 block text-sm">
                    Anything we should know?{" "}
                    <span className="text-muted">(optional)</span>
                  </span>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className={controlClass}
                  />
                </label>

                {error && (
                  <p className="mt-4 rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                    {error}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap gap-3">
                  {form && formFirst && (
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="rounded-lg border border-border px-4 py-3 text-sm text-muted hover:text-foreground"
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={submitting || (formFirst && !formComplete)}
                    className="flex-1 rounded-lg bg-accent px-6 py-3.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:flex-none sm:px-8"
                  >
                    {form && !formFirst
                      ? "Next: your details"
                      : submitting
                        ? "Booking…"
                        : `Book ${new Date(selectedSlot).toLocaleString(
                            "en-US",
                            {
                              timeZone: timezone,
                              weekday: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            }
                          )}`}
                  </button>
                </div>
              </form>
            )}

            {!selectedSlot && error && (
              <p className="mt-4 rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                {error}
              </p>
            )}
          </>
        )}

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
      </div>
    </div>
  );
}
