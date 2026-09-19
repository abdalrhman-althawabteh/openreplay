import { describe, expect, it } from "vitest";
import { archiveData } from "@/lib/automations/archive";

describe("archiveData", () => {
  it("archiving also pauses", () => {
    const d = archiveData(true);
    expect(d).toMatchObject({ isActive: false });
    expect(d.archivedAt).toBeInstanceOf(Date);
  });
  it("restoring un-hides but does not re-activate", () => {
    expect(archiveData(false)).toEqual({ archivedAt: null });
  });
  it("is a no-op when not requested", () => {
    expect(archiveData(undefined)).toEqual({});
  });
});
