import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BookingWidget from "@/components/booking-widget";
import { prisma } from "@/lib/db/client";

type BookPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ s?: string }>;
};

// Availability is live, so this page can never be prerendered or cached.
export const dynamic = "force-dynamic";

async function getCalendar(slug: string) {
  return prisma.calendar.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      description: true,
      durationMinutes: true,
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

export default async function BookPage({
  params,
  searchParams,
}: BookPageProps) {
  const { slug } = await params;
  const { s: submissionId } = await searchParams;
  const calendar = await getCalendar(slug);

  if (!calendar) {
    notFound();
  }

  // Arriving from a form: reuse what they already typed rather than asking
  // twice. Scoped to this workspace, so an id from elsewhere reveals nothing.
  const submission = submissionId
    ? await prisma.formSubmission.findFirst({
        where: { id: submissionId, workspaceId: calendar.workspaceId },
        select: {
          id: true,
          contact: { select: { name: true, email: true, phone: true } },
        },
      })
    : null;

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <BookingWidget
          slug={slug}
          name={calendar.name}
          description={calendar.description}
          durationMinutes={calendar.durationMinutes}
          submissionId={submission?.id ?? null}
          prefill={{
            name: submission?.contact?.name ?? undefined,
            email: submission?.contact?.email ?? undefined,
            phone: submission?.contact?.phone ?? undefined,
          }}
        />
      </div>
    </main>
  );
}
