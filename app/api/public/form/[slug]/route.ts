import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { upsertContactFromCapture } from "@/lib/contacts/upsert";
import {
  contactFromAnswers,
  labelAnswers,
  parseFields,
  validateAnswers,
} from "@/lib/forms/fields";
import {
  allowPublicSubmit,
  getRequestCountry,
  isHoneypotFilled,
} from "@/lib/public-submit-guard";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: RouteProps) {
  const { slug } = await params;

  const body = await request.json().catch(() => null);

  // A bot gets the same reply a person gets, so it learns nothing from the
  // difference — but nothing is written.
  if (isHoneypotFilled(body)) {
    return NextResponse.json({ success: true, data: { redirectTo: null } });
  }

  if (!(await allowPublicSubmit(request, "form"))) {
    return NextResponse.json(
      { success: false, error: "Too many submissions. Try again later." },
      { status: 429 }
    );
  }

  const form = await prisma.form.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      workspaceId: true,
      fields: true,
      redirectUrl: true,
    },
  });

  if (!form) {
    return NextResponse.json(
      { success: false, error: "Form not found" },
      { status: 404 }
    );
  }

  const fields = parseFields(form.fields);
  const submitted =
    typeof body === "object" && body !== null
      ? (body as { answers?: unknown }).answers
      : undefined;

  // The form's own questions are the schema. Anything not on them is rejected,
  // and every rule the browser enforced is enforced again here.
  const validated = validateAnswers(fields, submitted ?? {});
  if (!validated.ok) {
    return NextResponse.json(
      { success: false, error: validated.error },
      { status: 400 }
    );
  }

  const details = contactFromAnswers(fields, validated.answers);
  const country = getRequestCountry(request);

  const submission = await prisma.$transaction(async (tx) => {
    const contact = await upsertContactFromCapture(
      {
        workspaceId: form.workspaceId,
        name: details.name,
        email: details.email,
        phone: details.phone,
        country,
        source: "FORM",
      },
      tx
    );

    return tx.formSubmission.create({
      data: {
        workspaceId: form.workspaceId,
        formId: form.id,
        contactId: contact.id,
        // Stored keyed by question, not field id, so the record still reads
        // correctly after the form is edited or a question is removed.
        answers: labelAnswers(fields, validated.answers),
        country,
      },
      select: { id: true },
    });
  });

  // A form that leads to a booking is now configured on the calendar and runs
  // as one two-step widget at /book/<calendar>, so there is no hand-off here:
  // either an explicit redirect, or the form's own thank-you message.
  const redirectTo = form.redirectUrl || null;

  return NextResponse.json(
    { success: true, data: { submissionId: submission.id, redirectTo } },
    { status: 201 }
  );
}
