import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { NeuButton, NeuCard } from "@/styles/neu";
import "./entity-notes.css";

export type EntityNoteType =
  | "invoice" | "carrier" | "broker" | "document" | "chargeback"
  | "followup" | "task" | "submission" | "load" | "payout";

type EntityNote = {
  id: number;
  entityType: EntityNoteType;
  entityId: number;
  userId: number | string | null;
  noteText: string;
  createdAt: string;
  updatedAt?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  author: {
    id: number | string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  } | null;
};

type EntityNotesProps = {
  entityType: EntityNoteType;
  entityId: number;
  focusNoteId?: number | null;
  onFocused?: () => void;
};

const noteRotations = [-2, 1.4, -1.1, 2.6, -2.7, 1.9];

function relativeTime(value: string) {
  const date = new Date(value);
  const delta = (date.getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000], ["month", 2592000], ["week", 604800],
    ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, seconds] of units) {
    if (Math.abs(delta) >= seconds) return formatter.format(Math.round(delta / seconds), unit);
  }
  return "just now";
}

export default function EntityNotes(props: EntityNotesProps) {
  return <EntityNotesContent key={`${props.entityType}:${props.entityId}`} {...props} />;
}

function EntityNotesContent({ entityType, entityId, focusNoteId, onFocused }: EntityNotesProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const noteRefs = useRef<Record<number, HTMLElement | null>>({});
  const sectionRef = useRef<HTMLElement | null>(null);
  const submitting = useRef(false);
  const onFocusedRef = useRef(onFocused);
  onFocusedRef.current = onFocused;
  const notesKey = ["/api/notes", entityType, entityId] as const;

  const notesQuery = useQuery<EntityNote[]>({
    queryKey: notesKey,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ entityType, entityId: String(entityId) });
      const response = await fetch(`/api/notes?${params.toString()}`, { credentials: "include", signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Unable to load notes.");
      }
      return response.json();
    },
    enabled: Number.isInteger(entityId) && entityId > 0,
  });
  const notes = useMemo(
    () => [...(notesQuery.data ?? [])].filter(note => !note.deletedAt)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id),
    [notesQuery.data],
  );

  const refreshAfterChange = async () => {
    const relatedKeys: unknown[][] = [["/api/admin/audit-log"], ["/api/dashboard"]];
    if (entityType === "invoice") relatedKeys.push(["/api/invoices", entityId, "detail"], ["/api/invoices", entityId, "timeline"]);
    if (entityType === "carrier") relatedKeys.push(["/api/clients", entityId], ["/api/carriers", entityId]);
    if (entityType === "broker") relatedKeys.push(["/api/brokers", entityId]);
    if (entityType === "document") relatedKeys.push(["/api/load-documents", entityId, "detail"], ["/api/documents"]);
    if (entityType === "chargeback") relatedKeys.push(["/api/invoices", entityId, "chargeback", "lifecycle"]);
    if (entityType === "followup") relatedKeys.push(["/api/broker-follow-ups"]);
    if (entityType === "task") relatedKeys.push(["/api/tasks", entityId], ["/api/tasks"]);
    if (entityType === "submission") relatedKeys.push(["/api/carrier-portal/submissions"]);
    if (entityType === "load") relatedKeys.push(["/api/loads", entityId]);
    if (entityType === "payout") relatedKeys.push(["/api/payouts", entityId]);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: notesKey }),
      ...relatedKeys.map(queryKey => queryClient.invalidateQueries({ queryKey })),
    ]);
  };
  const createNote = useMutation({
    mutationFn: async (noteText: string) =>
      (await apiRequest("POST", "/api/notes", { entityType, entityId, noteText })).json(),
    onSuccess: async () => {
      setDraft("");
      setAdding(false);
      setError("");
      await refreshAfterChange();
    },
    onError: (cause: Error) => setError(cause.message || "Could not add note. Your draft is still here."),
    onSettled: () => { submitting.current = false; },
  });
  const updateNote = useMutation({
    mutationFn: async ({ noteId, noteText }: { noteId: number; noteText: string }) =>
      (await apiRequest("PATCH", `/api/notes/${noteId}`, { noteText })).json(),
    onSuccess: async () => {
      setEditingId(null);
      setEditDraft("");
      setError("");
      await refreshAfterChange();
    },
    onError: (cause: Error) => setError(cause.message || "Could not update note. Your changes are still here."),
    onSettled: () => { submitting.current = false; },
  });
  const removeNote = useMutation({
    mutationFn: async (noteId: number) => (await apiRequest("DELETE", `/api/notes/${noteId}`)).json(),
    onSuccess: async () => {
      setDeleteId(null);
      setExpandedId(null);
      setError("");
      await refreshAfterChange();
    },
    onError: (cause: Error) => setError(cause.message || "Could not delete note."),
    onSettled: () => { submitting.current = false; },
  });

  useEffect(() => {
    if (focusNoteId == null) return;
    const target = noteRefs.current[focusNoteId];
    if (target) {
      setExpandedId(focusNoteId);
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
      onFocusedRef.current?.();
    } else if (!notesQuery.isLoading) {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      sectionRef.current?.focus({ preventScroll: true });
      onFocusedRef.current?.();
    }
  }, [focusNoteId, notesQuery.isLoading, notes]);

  const viewerId = user?.id == null ? null : String(user.id);
  const canDeleteAny = user?.role === "manager" || user?.role === "admin";
  const beginSubmit = (action: () => void) => {
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    action();
  };
  const displayName = (note: EntityNote) =>
    [note.author?.firstName, note.author?.lastName].filter(Boolean).join(" ") ||
    (note.userId == null ? "Legacy note — author unavailable" : "Former staff member");
  const title = entityType === "followup" ? "Follow-up" : entityType[0].toUpperCase() + entityType.slice(1);

  return (
    <section className="ff-entity-notes" id={`${entityType}-notes-${entityId}`} ref={sectionRef} tabIndex={-1} aria-labelledby={`entity-notes-title-${entityType}-${entityId}`}>
      <header className="ff-entity-notes__header">
        <div>
          <p className="ff-entity-notes__eyebrow">Shared context</p>
          <h2 id={`entity-notes-title-${entityType}-${entityId}`}>{title} notes <span>{notes.length}</span></h2>
          <p className="ff-entity-notes__hint">A readable trail for the whole team.</p>
        </div>
        {!adding && (
          <NeuButton variant="accent" className="ff-entity-notes__add" onClick={() => { setAdding(true); setError(""); }}>
            <Plus className="h-4 w-4" /> Add note
          </NeuButton>
        )}
      </header>

      {adding && (
        <NeuCard pressed className="ff-entity-notes__composer">
          <label htmlFor={`entity-note-draft-${entityType}-${entityId}`}>Add context for your team</label>
          <textarea id={`entity-note-draft-${entityType}-${entityId}`} maxLength={10000} value={draft} onChange={event => setDraft(event.target.value)}
            placeholder="What should the next person know?" rows={4} autoFocus />
          <div className="ff-entity-notes__controls">
            <NeuButton onClick={() => { setAdding(false); setDraft(""); setError(""); }}><X className="h-4 w-4" />Cancel</NeuButton>
            <NeuButton variant="accent" disabled={!draft.trim() || createNote.isPending}
              onClick={() => beginSubmit(() => createNote.mutate(draft.trim()))}>
              {createNote.isPending ? "Saving…" : "Save note"}
            </NeuButton>
          </div>
        </NeuCard>
      )}
      {error && <p role="alert" className="ff-entity-notes__error">{error}</p>}

      {notesQuery.isLoading ? (
        <div className="ff-entity-notes__loading" aria-label="Loading notes">
          {[0, 1, 2].map(index => <div key={index} className="ff-entity-notes__skeleton" />)}
        </div>
      ) : notesQuery.isError ? (
        <div className="ff-entity-notes__load-error" role="alert">
          <p>{(notesQuery.error as Error)?.message || "Notes could not be loaded."}</p>
          <NeuButton onClick={() => notesQuery.refetch()}>Try again</NeuButton>
        </div>
      ) : notes.length === 0 ? (
        <div className="ff-entity-notes__empty">
          <MessageSquare className="h-5 w-5" />
          <p>No notes yet. Add the context your teammates will need next.</p>
        </div>
      ) : (
        <div className="ff-entity-notes__stack">
          {notes.map((note, index) => {
            const name = displayName(note);
            const initials = name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
            const isAuthor = viewerId !== null && String(note.userId) === viewerId;
            const canDeleteNote = isAuthor || canDeleteAny;
            const expanded = expandedId === note.id;
            const preview = note.noteText.length > 50 ? `${note.noteText.slice(0, 50).trimEnd()}…` : note.noteText;
            return (
              <NeuCard key={note.id} ref={element => { noteRefs.current[note.id] = element; }}
                role="article"
                tabIndex={0} aria-label={`Note by ${name}, ${relativeTime(note.createdAt)}`}
                className={`ff-entity-note${expanded ? " is-expanded" : ""}`}
                style={{ "--note-rotation": `${noteRotations[index % noteRotations.length]}deg`, zIndex: expanded ? 20 : notes.length - index } as CSSProperties}
                onFocus={() => setExpandedId(note.id)}
                onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setExpandedId(null); }}
                onMouseEnter={() => setExpandedId(note.id)}
                onMouseLeave={event => {
                  if (!event.currentTarget.contains(document.activeElement)) setExpandedId(null);
                }}
                onClick={() => setExpandedId(note.id)}
                onKeyDown={event => {
                  if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
                    event.preventDefault();
                    setExpandedId(expanded ? null : note.id);
                  }
                  if (event.key === "Escape") { setExpandedId(null); setEditingId(null); setDeleteId(null); }
                }}>
                <div className="ff-entity-note__meta">
                  <span className="ff-entity-note__avatar" aria-hidden="true">
                    {note.author?.profileImageUrl ? <img src={note.author.profileImageUrl} alt="" /> : initials}
                  </span>
                  <span className="ff-entity-note__identity">
                    <strong>{name}</strong><time dateTime={note.createdAt}>{relativeTime(note.createdAt)}</time>
                  </span>
                  {note.editedAt && <span className="ff-entity-note__edited">(edited)</span>}
                </div>
                {editingId === note.id ? (
                  <div className="ff-entity-note__edit" onClick={event => event.stopPropagation()}>
                    <textarea aria-label="Edit note" maxLength={10000} value={editDraft} onChange={event => setEditDraft(event.target.value)} rows={4} autoFocus />
                    <div className="ff-entity-notes__controls">
                      <NeuButton onClick={() => { setEditingId(null); setEditDraft(""); setError(""); }}><X className="h-4 w-4" />Cancel</NeuButton>
                      <NeuButton variant="accent" disabled={!editDraft.trim() || updateNote.isPending}
                        onClick={() => beginSubmit(() => updateNote.mutate({ noteId: note.id, noteText: editDraft.trim() }))}>
                        {updateNote.isPending ? "Saving…" : "Save"}
                      </NeuButton>
                    </div>
                  </div>
                ) : <p className={`ff-entity-note__body${expanded ? " is-full" : ""}`} title={expanded ? undefined : note.noteText}>{expanded ? note.noteText : preview}</p>}
                {expanded && canDeleteNote && editingId !== note.id && (
                  <div className="ff-entity-note__actions" onClick={event => event.stopPropagation()}>
                    {isAuthor && <NeuButton aria-label="Edit note" onClick={() => { setEditingId(note.id); setEditDraft(note.noteText); setDeleteId(null); setError(""); }}>
                      <Pencil className="h-3.5 w-3.5" /><span className="sr-only">Edit</span>
                    </NeuButton>}
                    {canDeleteNote && (deleteId === note.id ? (
                      <span className="ff-entity-note__confirm">
                        <span>Delete this note?</span>
                        <NeuButton onClick={() => setDeleteId(null)}>No</NeuButton>
                        <NeuButton className="ff-entity-notes__danger" disabled={removeNote.isPending}
                          onClick={() => beginSubmit(() => removeNote.mutate(note.id))}>{removeNote.isPending ? "Deleting…" : "Yes"}</NeuButton>
                      </span>
                    ) : <NeuButton aria-label="Delete note" onClick={() => setDeleteId(note.id)}><Trash2 className="h-3.5 w-3.5" /><span className="sr-only">Delete</span></NeuButton>)}
                  </div>
                )}
              </NeuCard>
            );
          })}
        </div>
      )}
    </section>
  );
}
