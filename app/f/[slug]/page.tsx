import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicForm from "@/components/public-form";
import { prisma } from "@/lib/db/client";
import { parseFields } from "@/lib/forms/fields";

type FormPageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

async function getForm(slug: string) {
  return prisma.form.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      name: true,
      headline: true,
      description: true,
      submitButtonLabel: true,
      successMessage: true,
      fields: true,
    },
  });
}

export async function generateMetadata({
  params,
}: FormPageProps): Promise<Metadata> {
  const { slug } = await params;
  const form = await getForm(slug);

  return {
    title: form ? form.headline ?? form.name : "Form not found",
    description: form?.description ?? undefined,
    // The owner puts this link on their own site; it is not for search.
    robots: { index: false, follow: false },
  };
}

export default async function FormPage({ params }: FormPageProps) {
  const { slug } = await params;
  const form = await getForm(slug);

  if (!form) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <PublicForm
          slug={slug}
          headline={form.headline ?? form.name}
          description={form.description}
          submitButtonLabel={form.submitButtonLabel}
          successMessage={form.successMessage}
          fields={parseFields(form.fields)}
        />
      </div>
    </main>
  );
}
