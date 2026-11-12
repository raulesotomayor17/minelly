import { useEffect, useMemo, useState, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { JSONContent } from "@tiptap/core";
import NoteEditor, { emptyNoteDocument } from "./NoteEditor";
import { anchorLabel, parseAnchor } from "./anchors";
import { PaperModePicker } from "./CustomizationModal";

interface BookInfo {
  number: number;
  name: string;
  abbreviation: string;
}

interface Notebook {
  id: string;
  parentId: string | null;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  nodeType?: "folder" | "notebook";
  icon?: string;
  sortOrder?: number;
  originUuid?: string | null;
  sharedBy?: string;
}

interface Tag {
  id: string;
  name: string;
  count: number;
}

interface Anchor {
  id: string;
  targetId: string;
  targetType: string;
  anchorUri: string;
  exactText: string;
  startOffset: number;
  endOffset: number;
  createdAt: number;
}

interface Highlight {
  id: string;
  styleId: string;
  anchorUri: string;
  exactText: string;
  startOffset: number;
  endOffset: number;
  createdAt: number;
}

interface NoteSummary {
  id: string;
  notebookId: string | null;
  title: string;
  excerpt: string;
  createdAt: number;
  updatedAt: number;
  tags: Tag[];
  anchors: Anchor[];
}

interface Note {
  id: string;
  notebookId: string | null;
  title: string;
  contentJson: JSONContent;
  createdAt: number;
  updatedAt: number;
  tags: Tag[];
  anchors: Anchor[];
}

interface AnchorSeed {
  anchorUri: string;
  exactText: string;
  startOffset: number;
  endOffset: number;
  label?: string;
}

interface NoteDraft {
  id?: string;
  notebookId: string;
  title: string;
  content: JSONContent;
  tags: string[];
  anchors: {
    anchorUri: string;
    exactText: string;
    startOffset: number;
    endOffset: number;
  }[];
}

interface NotesWorkspaceProps {
  books: BookInfo[];
  initialAnchor?: AnchorSeed | null;
  initialNoteId?: string | null;
  onClose: () => void;
  onOpenAnchor: (anchorUri: string) => void;
  onChanged: () => void;
  onOpenCustomization?: () => void;
}

const EMPTY_DRAFT: NoteDraft = {
  notebookId: "",
  title: "",
  content: emptyNoteDocument(),
  tags: [],
  anchors: [],
};

function bookName(books: BookInfo[], number: number) {
  return books.find((book) => book.number === number)?.name ?? "Biblia";
}

function anchorText(uri: string, books: BookInfo[]) {
  return anchorLabel(uri, (book) => bookName(books, book));
}

function flattenNotebooks(notebooks: Notebook[]) {
  const byParent = new Map<string, Notebook[]>();
  for (const notebook of notebooks) {
    const key = notebook.parentId ?? "root";
    const list = byParent.get(key) ?? [];
    list.push(notebook);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "es"));
  }
  return byParent;
}

export default function NotesWorkspace({
  books,
  initialAnchor,
  initialNoteId,
  onClose,
  onOpenAnchor,
  onChanged,
  onOpenCustomization,
}: NotesWorkspaceProps) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selectedNotebook, setSelectedNotebook] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [bookFilter, setBookFilter] = useState("");
  const [notesScale, setNotesScale] = useState<number>(() => {
    const saved = Number(localStorage.getItem("teoamoxtli.notes.scale"));
    return saved >= 0.85 && saved <= 1.65 ? saved : 1;
  });

  function adjustNotesScale(delta: number) {
    setNotesScale((prev) => {
      const next = Math.min(1.65, Math.max(0.85, Number((prev + delta).toFixed(2))));
      localStorage.setItem("teoamoxtli.notes.scale", String(next));
      return next;
    });
  }
  const [kindFilter, setKindFilter] = useState<"notes" | "highlights">("notes");
  const [query, setQuery] = useState("");
  const [anchorFilter, setAnchorFilter] = useState("");
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [showNewNotebook, setShowNewNotebook] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState("");
  const [newNodeType, setNewNodeType] = useState<"notebook" | "folder">("notebook");
  const [backlinks, setBacklinks] = useState<NoteSummary[]>([]);
  const [dragOverNotebook, setDragOverNotebook] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const tree = useMemo(() => flattenNotebooks(notebooks), [notebooks]);

  async function refreshNotes() {
    try {
      const list = await invoke<NoteSummary[]>("notes_list", {
        filter: {
          notebookId: selectedNotebook || null,
          tagId: selectedTag || null,
          query: query.trim() || null,
          anchorUri: anchorFilter.trim() || null,
        },
      });
      setNotes(list);
    } catch (value) {
      setError(String(value));
    }
  }

  async function refreshReference() {
    const [notebookList, tagList] = await Promise.all([
      invoke<Notebook[]>("notebooks_list"),
      invoke<Tag[]>("tags_list"),
    ]);
    setNotebooks(notebookList);
    setTags(tagList);
  }

  useEffect(() => {
    void (async () => {
      try {
        await refreshReference();
        await refreshNotes();
        const highlighted = await invoke<{
          notes: NoteSummary[];
          highlights: Highlight[];
        }>("annotations_for_prefix", { prefix: "" });
        setHighlights(highlighted.highlights);
      } catch (value) {
        setError(String(value));
      }
    })();
  }, []);

  useEffect(() => {
    void refreshNotes();
  }, [selectedNotebook, selectedTag, anchorFilter]);

  useEffect(() => {
    if (!initialNoteId) return;
    void editNote(initialNoteId);
  }, [initialNoteId]);

  useEffect(() => {
    if (!initialAnchor) return;
    setDraft({
      ...EMPTY_DRAFT,
      title: initialAnchor.label ? `Nota sobre ${initialAnchor.label}` : "Nueva nota",
      content: emptyNoteDocument(),
      anchors: [
        {
          anchorUri: initialAnchor.anchorUri,
          exactText: initialAnchor.exactText,
          startOffset: initialAnchor.startOffset ?? 0,
          endOffset: initialAnchor.endOffset ?? 0,
        },
      ],
    });
    setSelectedNote(null);
    setEditorKey((current) => current + 1);
  }, [initialAnchor]);

  async function applyFilters() {
    await refreshNotes();
  }

  async function createNotebook() {
    if (!newNotebookName.trim()) return;
    try {
      const notebook = await invoke<Notebook>("notebook_create_node", {
        name: newNotebookName.trim(),
        parentId: selectedNotebook || null,
        nodeType: newNodeType,
        color: newNodeType === "folder" ? "#38bdf8" : "#5B95FF",
        icon: newNodeType === "folder" ? "folder" : "notebook",
      });
      setNewNotebookName("");
      setShowNewNotebook(false);
      await refreshReference();
      setSelectedNotebook(notebook.id);
      await refreshNotes();
      setMessage(`Cuaderno “${notebook.name}” creado.`);
    } catch (value) {
      setError(String(value));
    }
  }

  async function removeHighlight(id: string) {
    if (!window.confirm("¿Eliminar este resaltado?")) return;
    try {
      await invoke("highlight_delete", { id });
      const all = await invoke<{ highlights: Highlight[] }>("annotations_for_prefix", {
        prefix: "",
      });
      setHighlights(all.highlights);
      onChanged();
      setMessage("Resaltado eliminado.");
    } catch (value) {
      setError(String(value));
    }
  }

  async function createTag() {
    if (!newTagName.trim()) return;
    try {
      const tag = await invoke<Tag>("tag_create", { name: newTagName.trim() });
      setNewTagName("");
      await refreshReference();
      setSelectedTag(tag.id);
      await refreshNotes();
    } catch (value) {
      setError(String(value));
    }
  }

  function newNote() {
    setSelectedNote(null);
    setDraft({
      ...EMPTY_DRAFT,
      notebookId: selectedNotebook,
    });
    setEditorKey((current) => current + 1);
  }

  async function editNote(id: string) {
    try {
      const note = await invoke<Note | null>("note_get", { id });
      if (!note) return;
      setSelectedNote(note);
      setDraft({
        id: note.id,
        notebookId: note.notebookId ?? "",
        title: note.title,
        content: note.contentJson,
        tags: note.tags.map((tag) => tag.name),
        anchors: note.anchors.map((anchor) => ({
          anchorUri: anchor.anchorUri,
          exactText: anchor.exactText,
          startOffset: anchor.startOffset,
          endOffset: anchor.endOffset,
        })),
      });
      setEditorKey((current) => current + 1);
      try {
        setBacklinks(await invoke<NoteSummary[]>("note_backlinks", { id: note.id }));
      } catch {
        setBacklinks([]);
      }
    } catch (value) {
      setError(String(value));
    }
  }

  function patchDraft(patch: Partial<NoteDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleDraftTag(name: string) {
    if (!draft) return;
    const exists = draft.tags.includes(name);
    patchDraft({
      tags: exists
        ? draft.tags.filter((tag) => tag !== name)
        : [...draft.tags, name],
    });
  }

  async function saveNote() {
    if (!draft) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const input = {
        notebookId: draft.notebookId || null,
        title: draft.title.trim() || "Sin título",
        contentJson: draft.content,
        tags: draft.tags,
        anchors: draft.anchors,
      };
      const note = draft.id
        ? await invoke<Note>("note_update", { id: draft.id, input })
        : await invoke<Note>("note_create", { input });
      setSelectedNote(note);
      setDraft({
        id: note.id,
        notebookId: note.notebookId ?? "",
        title: note.title,
        content: note.contentJson,
        tags: note.tags.map((tag) => tag.name),
        anchors: note.anchors.map((anchor) => ({
          anchorUri: anchor.anchorUri,
          exactText: anchor.exactText,
          startOffset: anchor.startOffset,
          endOffset: anchor.endOffset,
        })),
      });
      setEditorKey((current) => current + 1);
      await refreshReference();
      await refreshNotes();
      onChanged();
      setMessage("Nota guardada.");
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote() {
    if (!draft?.id) return;
    if (!window.confirm("¿Eliminar esta nota? Esta acción no se puede deshacer.")) return;
    try {
      await invoke("note_delete", { id: draft.id });
      setSelectedNote(null);
      setDraft(null);
      await refreshReference();
      await refreshNotes();
      onChanged();
      setMessage("Nota eliminada.");
    } catch (value) {
      setError(String(value));
    }
  }

  async function requestImage() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Insertar imagen local",
      filters: [{ name: "Imágenes", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (typeof selected !== "string") return null;
    try {
      return await invoke<string>("read_image_data_url", { path: selected });
    } catch (value) {
      setError(String(value));
      return null;
    }
  }

  async function exportNotes() {
    const path = await save({
      title: "Exportar notas de Minelly",
      defaultPath: "teoamoxtli-notas.teonotes",
      filters: [{ name: "Minelly Notes", extensions: ["teonotes"] }],
    });
    if (!path) return;
    try {
      const result = await invoke<{
        path: string;
        notebooks: number;
        notes: number;
        anchors: number;
        highlights: number;
        tags: number;
      }>("export_notes", { path });
      setMessage(
        `Exportados ${result.notes} notas, ${result.anchors} anclajes y ${result.highlights} resaltados en ${result.path}.`,
      );
    } catch (value) {
      setError(String(value));
    }
  }

  async function importNotes() {
    const path = await open({
      multiple: false,
      directory: false,
      title: "Importar notas de Minelly",
      filters: [{ name: "Minelly Notes", extensions: ["teonotes", "json"] }],
    });
    if (typeof path !== "string") return;
    try {
      const result = await invoke<{
        notebooks: number;
        notes: number;
        anchors: number;
        highlights: number;
        tags: number;
      }>("import_notes", { path });
      await refreshReference();
      await refreshNotes();
      const refreshed = await invoke<{ highlights: Highlight[] }>(
        "annotations_for_prefix",
        { prefix: "" },
      );
      setHighlights(refreshed.highlights);
      onChanged();
      setMessage(
        `Importados ${result.notes} notas, ${result.anchors} anclajes y ${result.highlights} resaltados.`,
      );
    } catch (value) {
      setError(String(value));
    }
  }

  function renderNotebookRows(parentId: string | null, depth: number): ReactElement[] {
    const items = tree.get(parentId ?? "root") ?? [];
    return items.flatMap((notebook) => {
      const row = (
        <button
          key={notebook.id}
          className={`notebook-row ${selectedNotebook === notebook.id ? "active" : ""}${dragOverNotebook === notebook.id ? " drag-over" : ""}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          draggable
          onDragStart={(event) => event.dataTransfer.setData("text/teo-notebook", notebook.id)}
          onDragOver={(event) => { event.preventDefault(); setDragOverNotebook(notebook.id); }}
          onDragLeave={() => setDragOverNotebook(null)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOverNotebook(null);
            const notebookId = event.dataTransfer.getData("text/teo-notebook");
            const noteId = event.dataTransfer.getData("text/teo-note");
            if (notebookId) {
              void invoke("notebook_move", { id: notebookId, parentId: notebook.id, sortOrder: 0 })
                .then(refreshReference);
            } else if (noteId) {
              void invoke("note_move", { id: noteId, notebookId: notebook.id, sortOrder: 0 })
                .then(refreshNotes);
            }
          }}
          onClick={() => {
            setSelectedNotebook(notebook.id);
            setSelectedTag("");
          }}
        >
          <span
            className="notebook-dot"
            style={{ background: notebook.color }}
          />
          <span>{notebook.nodeType === "folder" ? "▸ " : ""}{notebook.icon === "folder" ? "📁 " : ""}{notebook.name}</span>
        </button>
      );
      return [row, ...renderNotebookRows(notebook.id, depth + 1)];
    });
  }

  const activeAnchor = draft?.anchors[0]?.anchorUri ?? "";
  const parsedActiveAnchor = activeAnchor ? parseAnchor(activeAnchor) : null;
  const selectedNotebookName =
    notebooks.find((notebook) => notebook.id === selectedNotebook)?.name ?? "Todos";

  const filteredNotes = useMemo(() => {
    if (!bookFilter) return notes;
    const target = Number(bookFilter);
    return notes.filter((note) =>
      note.anchors.some((anchor) => {
        const parsed = parseAnchor(anchor.anchorUri);
        return parsed?.kind === "bible" && parsed.book === target;
      }),
    );
  }, [notes, bookFilter]);

  const filteredHighlights = useMemo(() => {
    if (!bookFilter) return highlights;
    const target = Number(bookFilter);
    return highlights.filter((highlight) => {
      const parsed = parseAnchor(highlight.anchorUri);
      return parsed?.kind === "bible" && parsed.book === target;
    });
  }, [highlights, bookFilter]);

  return (
    <div
      className="notes-overlay"
      style={{ "--notes-scale": notesScale } as React.CSSProperties}
    >
      <header className="notes-header">
        <div>
          <span className="eyebrow">Cuadernos y anclajes</span>
          <h1>Notas</h1>
          <p>
            Anclas canónicas para Biblia y anclas de recurso para libros; el mismo
            contenido aparece en cualquier versión.
          </p>
        </div>
        <div className="notes-header-actions">
          <div className="module-scale-group" title="Ajustar tamaño de letra en Notas">
            <span>Texto</span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => adjustNotesScale(-0.08)}
              title="Reducir letra de Notas"
            >
              A−
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => adjustNotesScale(0.08)}
              title="Aumentar letra de Notas"
            >
              A+
            </button>
          </div>
          <PaperModePicker compact />
          {onOpenCustomization && (
            <button
              type="button"
              className="secondary-button"
              onClick={onOpenCustomization}
              title="Personalizar tamaño de menús, fuentes y colores del sistema"
            >
              Aa Personalizar
            </button>
          )}
          <button className="secondary-button" onClick={() => void exportNotes()}>
            Exportar .teonotes
          </button>
          <button className="secondary-button" onClick={() => void importNotes()}>
            Importar
          </button>
          <button className="primary-button" onClick={onClose}>
            Volver al lector
          </button>
        </div>
      </header>

      {message && (
        <div className="notes-notice">
          <span>{message}</span>
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}
      {error && (
        <div className="notes-notice error">
          <span>{error}</span>
          <button onClick={() => setError("")}>×</button>
        </div>
      )}

      <div className="notes-layout">
        <aside className="notes-sidebar">
          <div className="notes-side-section">
            <div className="notes-section-heading">
              <span>CUADERNOS</span>
              <button
                className="notes-mini-button"
                onClick={() => { setNewNodeType("notebook"); setShowNewNotebook(true); }}
                title="Nuevo cuaderno"
              >
                +
              </button>
              <button
                className="notes-mini-button"
                onClick={() => { setNewNodeType("folder"); setShowNewNotebook(true); }}
                title="Nueva carpeta"
              >
                📁
              </button>
            </div>
            <button
              className={`notebook-row ${!selectedNotebook ? "active" : ""}`}
              onClick={() => {
                setSelectedNotebook("");
                setSelectedTag("");
              }}
            >
              Todas las notas
            </button>
            {renderNotebookRows(null, 0)}
            {showNewNotebook && (
              <div className="notes-inline-form">
                <input
                  value={newNotebookName}
                  onChange={(event) => setNewNotebookName(event.target.value)}
                  placeholder={newNodeType === "folder" ? "Nombre de la carpeta…" : selectedNotebook ? "Subcuaderno de…" : "Nombre del cuaderno"}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createNotebook();
                  }}
                  autoFocus
                />
                <button onClick={() => void createNotebook()}>Crear</button>
              </div>
            )}
            {selectedNotebook && (
              <p className="notes-hint">
                Nuevo cuaderno dentro de “{selectedNotebookName}”.
              </p>
            )}
          </div>

          <div className="notes-side-section">
            <div className="notes-section-heading">
              <span>ETIQUETAS</span>
            </div>
            <div className="notes-tag-filter">
              <button
                className={`tag-filter ${!selectedTag ? "active" : ""}`}
                onClick={() => setSelectedTag("")}
              >
                Todas
              </button>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  className={`tag-filter ${selectedTag === tag.id ? "active" : ""}`}
                  onClick={() => setSelectedTag(tag.id)}
                >
                  {tag.name} <small>{tag.count}</small>
                </button>
              ))}
            </div>
            <div className="notes-inline-form">
              <input
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
                placeholder="Nueva etiqueta"
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createTag();
                }}
              />
              <button onClick={() => void createTag()}>+</button>
            </div>
          </div>

          <div className="notes-side-section">
            <div className="notes-section-heading">
              <span>FILTROS</span>
            </div>
            <input
              className="notes-filter-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void applyFilters();
              }}
              placeholder="Buscar título o contenido…"
            />
            <input
              className="notes-filter-input"
              value={anchorFilter}
              onChange={(event) => setAnchorFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void applyFilters();
              }}
              placeholder="Ancla exacta: bible:JHN:3:16"
            />
            <select
              className="notes-filter-input"
              value={bookFilter}
              onChange={(event) => setBookFilter(event.target.value)}
              aria-label="Filtrar por libro bíblico"
            >
              <option value="">Todos los libros</option>
              {books.map((book) => (
                <option key={book.number} value={book.number}>
                  {book.name}
                </option>
              ))}
            </select>
            <button className="notes-apply-filter" onClick={() => void applyFilters()}>
              Aplicar filtros
            </button>
          </div>

          <div className="notes-side-summary">
            <span>{filteredNotes.length} notas</span>
            <span>{filteredHighlights.length} resaltados</span>
          </div>
        </aside>

        <section className="notes-list-panel">
          <div className="notes-list-header">
            <div>
              <span className="eyebrow">Lista</span>
              <h2>{selectedTag ? "Etiqueta" : selectedNotebookName}</h2>
            </div>
            <div className="notes-kind-toggle">
              <button
                className={kindFilter === "notes" ? "active" : ""}
                onClick={() => setKindFilter("notes")}
              >
                Notas
              </button>
              <button
                className={kindFilter === "highlights" ? "active" : ""}
                onClick={() => setKindFilter("highlights")}
              >
                Resaltados
              </button>
            </div>
            <div className="notes-list-actions">
              {selectedNote && (
                <button className="secondary-button" onClick={() => void deleteNote()}>
                  Eliminar
                </button>
              )}
              <button className="primary-button" onClick={newNote}>
                + Nota
              </button>
            </div>
          </div>
          <div className="notes-list">
            {kindFilter === "notes" && filteredNotes.length === 0 && (
              <div className="notes-empty">
                No hay notas con estos filtros. Crea una nota o limpia los filtros.
              </div>
            )}
            {kindFilter === "notes" &&
              filteredNotes.map((note) => (
                <button
                  key={note.id}
                  className={`note-row ${selectedNote?.id === note.id ? "active" : ""}`}
                  onClick={() => void editNote(note.id)}
                >
                  <strong>{note.title}</strong>
                  <span>{note.excerpt || "Nota vacía"}</span>
                  <div className="note-row-meta">
                    <small>
                      {new Date(note.updatedAt * 1000).toLocaleDateString("es-MX")}
                    </small>
                    {note.tags.slice(0, 3).map((tag) => (
                      <em key={tag.id}>{tag.name}</em>
                    ))}
                  </div>
                  {note.anchors[0] && (
                    <small className="note-row-anchor">
                      {anchorText(note.anchors[0].anchorUri, books)}
                    </small>
                  )}
                </button>
              ))}

            {kindFilter === "highlights" && filteredHighlights.length === 0 && (
              <div className="notes-empty">
                No hay resaltados con estos filtros. Selecciona texto en el lector
                para crear uno.
              </div>
            )}
            {kindFilter === "highlights" &&
              filteredHighlights.map((highlight) => (
                <div className="highlight-row" key={highlight.id}>
                  <span
                    className={`highlight-row-dot ${highlight.styleId}`}
                  />
                  <button
                    className="highlight-row-main"
                    onClick={() => onOpenAnchor(highlight.anchorUri)}
                  >
                    <strong>{anchorText(highlight.anchorUri, books)}</strong>
                    <span>{highlight.exactText || "Resaltado"}</span>
                  </button>
                  <button
                    className="highlight-row-delete"
                    onClick={() => void removeHighlight(highlight.id)}
                    title="Eliminar resaltado"
                    aria-label="Eliminar resaltado"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
          </div>
        </section>

        <section className="notes-editor-panel">
          {draft ? (
            <>
              <div className="notes-editor-heading">
                <div className="notes-editor-title">
                  <input
                    value={draft.title}
                    onChange={(event) => patchDraft({ title: event.target.value })}
                    placeholder="Título de la nota"
                  />
                  <div className="notes-editor-meta">
                    <select
                      value={draft.notebookId}
                      onChange={(event) => patchDraft({ notebookId: event.target.value })}
                      aria-label="Cuaderno de la nota"
                    >
                      <option value="">Sin cuaderno</option>
                      {notebooks.map((notebook) => (
                        <option key={notebook.id} value={notebook.id}>
                          {notebook.name}
                        </option>
                      ))}
                    </select>
                    <span>
                      {draft.id ? "Editando" : "Nueva nota"} ·{" "}
                      {new Date().toLocaleDateString("es-MX")}
                    </span>
                  </div>
                </div>
                <div className="notes-editor-actions">
                  <button className="primary-button" onClick={() => void saveNote()} disabled={busy}>
                    {busy ? "Guardando…" : "Guardar"}
                  </button>
                  {draft.id && (
                    <button className="secondary-button" onClick={() => void deleteNote()}>
                      Eliminar
                    </button>
                  )}
                </div>
              </div>

              <div className="notes-anchor-bar">
                {draft.anchors.length === 0 && (
                  <span className="notes-hint">Sin anclajes. Selecciona texto en el lector para crear uno.</span>
                )}
                {draft.anchors.map((anchor, index) => (
                  <span className="anchor-chip" key={`${anchor.anchorUri}-${index}`}>
                    <span>{anchorText(anchor.anchorUri, books)}</span>
                    {index === 0 && parsedActiveAnchor && (
                      <button
                        className="anchor-open"
                        onClick={() => onOpenAnchor(anchor.anchorUri)}
                        title="Abrir ancla en el lector"
                      >
                        ↗
                      </button>
                    )}
                    <button
                      className="anchor-remove"
                      onClick={() =>
                        patchDraft({
                          anchors: draft.anchors.filter((_, position) => position !== index),
                        })
                      }
                      aria-label="Quitar anclaje"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <div className="notes-tag-picker">
                <span className="notes-hint">Etiquetas:</span>
                {tags.length === 0 && <span className="notes-hint">Crea una etiqueta en la barra izquierda.</span>}
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    className={`tag-choice ${draft.tags.includes(tag.name) ? "active" : ""}`}
                    onClick={() => toggleDraftTag(tag.name)}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>

              {draft.id && backlinks.length > 0 && (
                <div className="notes-backlinks">
                  <span className="notes-hint">Backlinks · notas que enlazan aquí</span>
                  {backlinks.map((note) => (
                    <button key={note.id} onClick={() => void editNote(note.id)}>{note.title}</button>
                  ))}
                </div>
              )}

              <div className="notes-editor-shell">
                <NoteEditor
                  key={editorKey}
                  content={draft.content}
                  onChange={(content) => patchDraft({ content })}
                  onRequestImage={requestImage}
                />
              </div>
            </>
          ) : (
            <div className="notes-editor-empty">
              <span className="eyebrow">Editor de bloques</span>
              <h2>Selecciona o crea una nota</h2>
              <p>
                TipTap permite títulos, listas anidadas, citas, código, imágenes y
                comandos con <kbd>/</kbd>.
              </p>
              <button className="primary-button" onClick={newNote}>
                Crear primera nota
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
