"use client";

/**
 * Contacts Page
 *
 * Every person captured by a form or a booking, plus manually added ones.
 * Searching and filtering happen on the server so the list stays fast as it
 * grows; editing happens inline in a row rather than on a separate page.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CONTACT_SOURCES,
  contactSourceLabel,
} from "@/lib/contacts/sources";

interface Contact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  source: string;
  notes: string | null;
  createdAt: string;
  _count: { bookings: number; submissions: number };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type Draft = {
  name: string;
  email: string;
  phone: string;
  country: string;
  notes: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  email: "",
  phone: "",
  country: "",
  notes: "",
};

function toDraft(contact: Contact): Draft {
  return {
    name: contact.name ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    country: contact.country ?? "",
    notes: contact.notes ?? "",
  };
}

const inputClass =
  "w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  // Typing in the search box shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (sourceFilter !== "ALL") params.set("source", sourceFilter);

      const res = await fetch(`/api/contacts?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setContacts(data.data.contacts);
        setPagination(data.data.pagination);
      } else {
        setError(data.error ?? "Failed to load contacts");
      }
    } catch (err) {
      console.error("Failed to fetch contacts:", err);
      setError("Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, sourceFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchContacts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchContacts]);

  function startEdit(contact: Contact) {
    setError(null);
    setAdding(false);
    setEditingId(contact.id);
    setDraft(toDraft(contact));
  }

  function startAdd() {
    setError(null);
    setEditingId(null);
    setAdding(true);
    setDraft(EMPTY_DRAFT);
  }

  function cancelEdit() {
    setEditingId(null);
    setAdding(false);
    setDraft(EMPTY_DRAFT);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const url = adding ? "/api/contacts" : `/api/contacts?id=${editingId}`;
      const res = await fetch(url, {
        method: adding ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          country: draft.country.trim().toUpperCase(),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        const fieldErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const firstField = fieldErrors && Object.keys(fieldErrors)[0];
        setError(
          firstField
            ? `${firstField}: ${fieldErrors[firstField][0]}`
            : data.error ?? "Failed to save contact"
        );
        return;
      }
      cancelEdit();
      setLoading(true);
      await fetchContacts();
    } catch (err) {
      console.error("Failed to save contact:", err);
      setError("Failed to save contact");
    } finally {
      setSaving(false);
    }
  }

  async function remove(contact: Contact) {
    const label = contact.name ?? contact.email ?? "this contact";
    if (
      !confirm(
        `Delete ${label}? Their bookings and submissions go too. This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/contacts?id=${contact.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Failed to delete contact");
        return;
      }
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    } catch (err) {
      console.error("Failed to delete contact:", err);
      setError("Failed to delete contact");
    }
  }

  // Rendered into both the "add" row and whichever row is being edited, so the
  // two never drift apart.
  const editorCells = (
    <>
      <td className="px-4 py-3 sm:px-6">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Name"
          className={inputClass}
        />
      </td>
      <td className="px-4 py-3 sm:px-6">
        <input
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          placeholder="email@example.com"
          type="email"
          className={inputClass}
        />
      </td>
      <td className="px-4 py-3 sm:px-6">
        <input
          value={draft.phone}
          onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          placeholder="+962…"
          className={inputClass}
        />
      </td>
      <td className="px-4 py-3 sm:px-6">
        <input
          value={draft.country}
          onChange={(e) => setDraft({ ...draft, country: e.target.value })}
          placeholder="JO"
          maxLength={2}
          className={inputClass}
        />
      </td>
      <td className="px-4 py-3 sm:px-6" colSpan={2}>
        <input
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="Notes"
          className={inputClass}
        />
      </td>
      <td className="px-4 py-3 whitespace-nowrap sm:px-6">
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={cancelEdit}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </td>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or phone"
            className="w-64 max-w-full rounded border border-border bg-surface px-3 py-2 text-sm"
          />
          <select
            value={sourceFilter}
            onChange={(e) => {
              setLoading(true);
              setSourceFilter(e.target.value);
              setPage(1);
            }}
            className="rounded border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="ALL">All sources</option>
            {CONTACT_SOURCES.map((source) => (
              <option key={source} value={source}>
                {contactSourceLabel(source)}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={startAdd}
          className="self-start rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Add contact
        </button>
      </div>

      {error && (
        <p className="rounded border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      <div className="panel rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {[
                  "Name",
                  "Email",
                  "Phone",
                  "Country",
                  "Source",
                  "Activity",
                  "",
                ].map((heading, i) => (
                  <th
                    key={i}
                    className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {adding && (
                <tr className="bg-surface-hover/40">{editorCells}</tr>
              )}

              {loading &&
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-4 sm:px-6">
                      <div className="h-4 rounded bg-surface-hover" />
                    </td>
                  </tr>
                ))}

              {!loading && contacts.length === 0 && !adding && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-muted sm:px-6"
                  >
                    No contacts yet. They appear here as people submit your
                    forms and book calls.
                  </td>
                </tr>
              )}

              {!loading &&
                contacts.map((contact) =>
                  editingId === contact.id ? (
                    <tr key={contact.id} className="bg-surface-hover/40">
                      {editorCells}
                    </tr>
                  ) : (
                    <tr
                      key={contact.id}
                      className="transition-colors hover:bg-surface-hover/50"
                    >
                      <td className="px-4 py-4 sm:px-6">
                        <span className="font-medium text-foreground">
                          {contact.name ?? "—"}
                        </span>
                        {contact.notes && (
                          <span className="mt-0.5 block max-w-[220px] truncate text-xs text-muted">
                            {contact.notes}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-muted sm:px-6">
                        {contact.email ?? "—"}
                      </td>
                      <td className="px-4 py-4 text-muted sm:px-6">
                        {contact.phone ?? "—"}
                      </td>
                      <td className="px-4 py-4 text-muted sm:px-6">
                        {contact.country ?? "—"}
                      </td>
                      <td className="px-4 py-4 text-muted sm:px-6">
                        {contactSourceLabel(contact.source)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-muted sm:px-6">
                        {contact._count.bookings} booking
                        {contact._count.bookings === 1 ? "" : "s"} ·{" "}
                        {contact._count.submissions} form
                        {contact._count.submissions === 1 ? "" : "s"}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap sm:px-6">
                        <div className="flex gap-3">
                          <button
                            onClick={() => startEdit(contact)}
                            className="text-xs text-muted hover:text-foreground"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => remove(contact)}
                            className="text-xs text-muted hover:text-error"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4 sm:px-6">
            <p className="text-xs text-muted">
              Showing {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
              {pagination.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => {
                  setLoading(true);
                  setPage(page - 1);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-all hover:border-border-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                Previous
              </button>
              <span className="px-2 text-xs text-muted">
                {page} / {pagination.totalPages}
              </span>
              <button
                disabled={page >= pagination.totalPages}
                onClick={() => {
                  setLoading(true);
                  setPage(page + 1);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-all hover:border-border-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
