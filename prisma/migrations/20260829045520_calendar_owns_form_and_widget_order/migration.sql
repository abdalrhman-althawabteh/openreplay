-- The form/calendar link moves from Form.calendarId to Calendar.formId.
--
-- The old direction let several forms point at one calendar; the new one is a
-- single form per calendar, so a collision is possible. DISTINCT ON picks the
-- oldest form deterministically rather than letting the planner choose.
--
-- Order matters: the new column is filled from the old one BEFORE the old one
-- is dropped, so an existing link survives the migration.

-- AlterTable: add the new columns first
ALTER TABLE "Calendar" ADD COLUMN     "formFirst" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "formId" TEXT,
ADD COLUMN     "redirectUrl" TEXT,
ADD COLUMN     "successMessage" TEXT NOT NULL DEFAULT 'Thanks! We''ll review your request and get back to you.';

-- Carry the existing links across
UPDATE "Calendar" c
SET "formId" = picked.id
FROM (
  SELECT DISTINCT ON ("calendarId") "calendarId", id
  FROM "Form"
  WHERE "calendarId" IS NOT NULL
  ORDER BY "calendarId", "createdAt" ASC
) AS picked
WHERE picked."calendarId" = c.id;

-- Only now is the old column safe to remove
-- DropForeignKey
ALTER TABLE "Form" DROP CONSTRAINT "Form_calendarId_fkey";

-- DropIndex
DROP INDEX "Form_calendarId_idx";

-- AlterTable
ALTER TABLE "Form" DROP COLUMN "calendarId";

-- CreateIndex
CREATE INDEX "Calendar_formId_idx" ON "Calendar"("formId");

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE SET NULL ON UPDATE CASCADE;
