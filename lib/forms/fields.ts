/**
 * Form fields.
 *
 * A form's questions are a JSON array on the Form row rather than their own
 * table: they are only ever read and written as a whole, and nothing joins
 * against an individual question. This module owns their shape, their
 * validation, and how an answer becomes a Contact.
 */

import { z } from "zod";

export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "address",
  "select",
  "checkbox",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: "Short answer",
  long_text: "Long answer",
  email: "Email",
  phone: "Phone",
  url: "Website",
  address: "Address",
  select: "Multiple choice (pick one)",
  checkbox: "Checkboxes (pick any)",
};

/** Field types whose answer is a list rather than a single string. */
export function isMultiValue(type: FieldType) {
  return type === "checkbox";
}

/** Field types that need an options list to make sense. */
export function hasOptions(type: FieldType) {
  return type === "select" || type === "checkbox";
}

/**
 * Which Contact column this question fills in, if any. Set automatically for
 * email and phone fields; a name field has to say so, because "your name" is
 * just a short-answer question as far as the type system is concerned.
 */
export const CONTACT_TARGETS = ["name", "email", "phone"] as const;
export type ContactTarget = (typeof CONTACT_TARGETS)[number];

export const formFieldSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(FIELD_TYPES),
  label: z.string().min(1).max(200),
  placeholder: z.string().max(200).nullable().optional(),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(200)).max(30).default([]),
  mapTo: z.enum(CONTACT_TARGETS).nullable().optional(),
});

export type FormField = z.infer<typeof formFieldSchema>;

export const MAX_FIELDS = 50;
export const MAX_ANSWER_LENGTH = 5000;

export const formFieldsSchema = z
  .array(formFieldSchema)
  .max(MAX_FIELDS)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      if (seen.has(field.id)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Duplicate field id",
        });
      }
      seen.add(field.id);

      if (hasOptions(field.type) && field.options.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: [index, "options"],
          message: `"${field.label}" needs at least one choice`,
        });
      }
    });
  });

/** Read a form's stored `fields` JSON, tolerating a row written by older code. */
export function parseFields(value: unknown): FormField[] {
  const parsed = formFieldsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;

/**
 * Validate a submission against the form's own questions.
 *
 * This is the trust boundary: the body is whatever a stranger posted, so
 * unknown field ids are rejected outright, required answers are enforced here
 * rather than in the browser, and a choice must be one the form actually
 * offers.
 */
export function validateAnswers(
  fields: FormField[],
  raw: unknown
): { ok: true; answers: Answers } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Answers must be an object" };
  }

  const submitted = raw as Record<string, unknown>;
  const known = new Set(fields.map((field) => field.id));
  for (const key of Object.keys(submitted)) {
    if (!known.has(key)) {
      return { ok: false, error: `Unknown field "${key}"` };
    }
  }

  const answers: Answers = {};

  for (const field of fields) {
    const value = submitted[field.id];

    if (isMultiValue(field.type)) {
      const list = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
      const invalid = list.find((item) => !field.options.includes(item));
      if (invalid) {
        return { ok: false, error: `"${invalid}" is not a choice on "${field.label}"` };
      }
      if (field.required && list.length === 0) {
        return { ok: false, error: `"${field.label}" is required` };
      }
      if (list.length > 0) answers[field.id] = list;
      continue;
    }

    const text = typeof value === "string" ? value.trim() : "";

    if (!text) {
      if (field.required) {
        return { ok: false, error: `"${field.label}" is required` };
      }
      continue;
    }

    if (text.length > MAX_ANSWER_LENGTH) {
      return { ok: false, error: `"${field.label}" is too long` };
    }

    if (field.type === "select" && !field.options.includes(text)) {
      return { ok: false, error: `"${text}" is not a choice on "${field.label}"` };
    }

    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      return { ok: false, error: `"${field.label}" needs a valid email address` };
    }

    answers[field.id] = text;
  }

  return { ok: true, answers };
}

/** Pull the contact details out of a set of answers, using each field's mapTo. */
export function contactFromAnswers(fields: FormField[], answers: Answers) {
  const contact: { name?: string; email?: string; phone?: string } = {};

  for (const field of fields) {
    // An email or phone question fills its column even when nobody set mapTo.
    const target =
      field.mapTo ??
      (field.type === "email"
        ? "email"
        : field.type === "phone"
          ? "phone"
          : null);
    if (!target) continue;

    const value = answers[field.id];
    if (typeof value !== "string" || !value) continue;
    // First answer wins, so a second email question can't overwrite the first.
    if (!contact[target]) contact[target] = value;
  }

  return contact;
}

/**
 * Whether these fields can produce an email address.
 *
 * A calendar may only attach a form that can: email is the key contacts are
 * deduped on, so a booking form without one would silently create a new person
 * every time the same customer books.
 */
export function capturesEmail(fields: FormField[]) {
  return fields.some(
    (field) => field.type === "email" || field.mapTo === "email"
  );
}

/**
 * Render answers for a human: `{ "Which service?": "Coaching" }`, keyed by the
 * question rather than its id, so a booking's stored answers stay readable
 * even if the form is later edited.
 */
export function labelAnswers(fields: FormField[], answers: Answers) {
  const labelled: Record<string, AnswerValue> = {};
  for (const field of fields) {
    const value = answers[field.id];
    if (value === undefined) continue;
    labelled[field.label] = value;
  }
  return labelled;
}
