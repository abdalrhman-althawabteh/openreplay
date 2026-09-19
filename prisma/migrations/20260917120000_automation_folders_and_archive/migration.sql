-- Folders (flat, per workspace) for grouping campaigns and story automations,
-- plus an archive flag. Archiving also sets isActive=false in the API, so the
-- workers need no change.

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folder_workspaceId_idx" ON "Folder"("workspaceId");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "folderId" TEXT;

-- CreateIndex
CREATE INDEX "Automation_folderId_idx" ON "Automation"("folderId");

-- AddForeignKey: deleting a folder unfiles its automations rather than deleting them
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
