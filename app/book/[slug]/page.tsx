import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BookingWidget from "@/components/booking-widget";
import { prisma } from "@/lib/db/client";
import { parseFields } from "@/lib/forms/fields";

type BookPageProps = {
  params: Promise<{ slug: string }>;
};

// Availability is live, so this page can never be prerendered or cached.
export const dynamic = "force-dynamic";

async function getCalendar(slug: string) {
  return prisma.calendar.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      name: true,
      description: true,
      durationMinutes: true,
      formFirst: true,
      successMessage: true,
      form: {
        select: {
          headline: true,
          description: true,
          submitButtonLabel: true,
          fields: true,
        },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: BookPageProps): Promise<Metadata> {
  const { slug } = await params;
  const calendar = await getCalendar(slug);

  return {
    title: calendar ? `Book ${calendar.name}` : "Booking page not found",
    description: calendar?.description ?? undefined,
    // A booking link is shared deliberately, not discovered through search.
    robots: { index: false, follow: false },
  };
}

export default async function BookPage({ params }: BookPageProps) {
  const { slug } = await params;
  const calendar = await getCalendar(slug);

  if (!calendar) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <BookingWidget
          slug={slug}
          name={calendar.name}
          description={calendar.description}
          durationMinutes={calendar.durationMinutes}
          formFirst={calendar.formFirst}
          successMessage={calendar.successMessage}
          form={
            calendar.form
              ? {
                  headline: calendar.form.headline,
                  description: calendar.form.description,
                  submitButtonLabel: calendar.form.submitButtonLabel,
                  fields: parseFields(calendar.form.fields),
                }
              : null
          }
        />
      </div>
    </main>
  );
}
