/**
 * Prisma `data` for an archive / restore request on an Automation.
 *
 * Archive = hidden + stopped: it also pauses, so every matcher that filters
 * on `isActive: true` (poller, DM worker) ignores archived automations with
 * no extra code. Restore only un-hides; the owner re-activates deliberately.
 */
export function archiveData(archived: boolean | undefined) {
  if (archived === true) return { archivedAt: new Date(), isActive: false };
  if (archived === false) return { archivedAt: null };
  return {};
}
