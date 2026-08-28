import { describe, expect, it } from "vitest";
import {
  MAX_ANSWER_LENGTH,
  contactFromAnswers,
  labelAnswers,
  parseFields,
  validateAnswers,
  type FormField,
} from "@/lib/forms/fields";

function field(overrides: Partial<FormField> & { id: string }): FormField {
  return {
    type: "short_text",
    label: overrides.id,
    placeholder: null,
    required: false,
    options: [],
    mapTo: null,
    ...overrides,
  };
}

const FIELDS: FormField[] = [
  field({ id: "name", type: "short_text", label: "Full name", required: true, mapTo: "name" }),
  field({ id: "mail", type: "email", label: "Email", required: true }),
  field({ id: "tel", type: "phone", label: "Phone" }),
  field({
    id: "svc",
    type: "select",
    label: "Which service?",
    required: true,
    options: ["Coaching", "Consulting"],
  }),
  field({
    id: "goals",
    type: "checkbox",
    label: "Goals",
    options: ["Grow", "Automate"],
  }),
  field({ id: "story", type: "long_text", label: "Tell us about yourself" }),
];

const VALID = {
  name: "Sara",
  mail: "sara@example.com",
  svc: "Coaching",
};

describe("validateAnswers", () => {
  it("accepts a complete submission", () => {
    const result = validateAnswers(FIELDS, VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answers.name).toBe("Sara");
  });

  it("rejects a field the form does not have", () => {
    const result = validateAnswers(FIELDS, { ...VALID, isAdmin: "true" });
    expect(result).toEqual({ ok: false, error: 'Unknown field "isAdmin"' });
  });

  it("enforces required, even though the browser already did", () => {
    const withoutName = { mail: VALID.mail, svc: VALID.svc };
    expect(validateAnswers(FIELDS, withoutName).ok).toBe(false);
  });

  it("treats whitespace as an empty answer", () => {
    const result = validateAnswers(FIELDS, { ...VALID, name: "   " });
    expect(result.ok).toBe(false);
  });

  it("rejects a choice the form never offered", () => {
    const result = validateAnswers(FIELDS, { ...VALID, svc: "Free work" });
    expect(result.ok).toBe(false);
  });

  it("rejects a checkbox value that is not an option", () => {
    const result = validateAnswers(FIELDS, { ...VALID, goals: ["Grow", "Hack"] });
    expect(result.ok).toBe(false);
  });

  it("keeps multiple checkbox answers as a list", () => {
    const result = validateAnswers(FIELDS, { ...VALID, goals: ["Grow", "Automate"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answers.goals).toEqual(["Grow", "Automate"]);
  });

  it("rejects a malformed email", () => {
    const result = validateAnswers(FIELDS, { ...VALID, mail: "not-an-email" });
    expect(result.ok).toBe(false);
  });

  it("caps answer length", () => {
    const result = validateAnswers(FIELDS, {
      ...VALID,
      story: "x".repeat(MAX_ANSWER_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a body that is not an object", () => {
    expect(validateAnswers(FIELDS, "nope").ok).toBe(false);
    expect(validateAnswers(FIELDS, ["nope"]).ok).toBe(false);
  });

  it("omits optional answers that were left blank", () => {
    const result = validateAnswers(FIELDS, VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect("tel" in result.answers).toBe(false);
  });
});

describe("contactFromAnswers", () => {
  it("pulls name, email and phone out using mapTo and field type", () => {
    const result = validateAnswers(FIELDS, { ...VALID, tel: "+962700000000" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(contactFromAnswers(FIELDS, result.answers)).toEqual({
      name: "Sara",
      email: "sara@example.com",
      phone: "+962700000000",
    });
  });

  it("lets the first answer win when two questions map to the same column", () => {
    const fields = [
      field({ id: "a", type: "email", label: "Work email" }),
      field({ id: "b", type: "email", label: "Personal email" }),
    ];
    const contact = contactFromAnswers(fields, {
      a: "work@example.com",
      b: "home@example.com",
    });
    expect(contact.email).toBe("work@example.com");
  });

  it("returns nothing when no question maps to a contact column", () => {
    const fields = [field({ id: "q", label: "Anything else?" })];
    expect(contactFromAnswers(fields, { q: "hello" })).toEqual({});
  });
});

describe("labelAnswers", () => {
  it("keys answers by the question so they survive a later form edit", () => {
    expect(labelAnswers(FIELDS, { name: "Sara", svc: "Coaching" })).toEqual({
      "Full name": "Sara",
      "Which service?": "Coaching",
    });
  });
});

describe("parseFields", () => {
  it("reads a well-formed fields array", () => {
    expect(parseFields(FIELDS)).toHaveLength(FIELDS.length);
  });

  it("falls back to no fields rather than throwing on a bad row", () => {
    expect(parseFields("garbage")).toEqual([]);
    expect(parseFields([{ id: "x" }])).toEqual([]);
  });

  it("rejects a choice field with no choices", () => {
    expect(
      parseFields([field({ id: "s", type: "select", label: "Pick", options: [] })])
    ).toEqual([]);
  });

  it("rejects duplicate field ids", () => {
    expect(
      parseFields([field({ id: "dup" }), field({ id: "dup" })])
    ).toEqual([]);
  });
});
