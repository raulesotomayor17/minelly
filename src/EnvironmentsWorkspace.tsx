import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ModuleEmblem from "./ModuleEmblem";
import type { ReaderMode, Workspace } from "./workspaceTypes";
import "./Environments.css";

interface BibleItem {
  id: string;
  title: string;
  abbreviation: string;
}

interface BookItem {
  number: number;
  name: string;
}

interface EnvironmentsWorkspaceProps {
  workspaces: Workspace[];
  workspaceName: string;
  onWorkspaceNameChange: (value: string) => void;
  onSave: () => void;
  onApply: (workspace: Workspace) => void;
  onUpdate: (workspaceId: string) => void;
  onDelete: (workspaceId: string) => void;
  onApplyWindowPreset: (preset: "study" | "reading") => void;
  onOpenModularPreset: (presetId: string) => void;
  onClose: () => void;
  bibles: BibleItem[];
  books: BookItem[];
}

type DiagramShape = "split" | "row" | "grid" | "full";

interface DiagramPane {
  label: string;
  link?: string;
  grow?: number;
}

interface LayoutTemplate {
  id: string;
  title: string;
  description: string;
  kind: "window" | "canvas";
  tag?: string;
  diagram: { shape: DiagramShape; panes: DiagramPane[] };
}

const TEMPLATES: LayoutTemplate[] = [
  {
    id: "study",
    title: "Estudio bíblico integrado",
    description:
      "Biblia por versículo con panel lateral de comentario, diccionario y notas enlazadas.",
    kind: "window",
    tag: "Recomendado",
    diagram: {
      shape: "split",
      panes: [
        { label: "Biblia", link: "A", grow: 1.6 },
        { label: "Comentario", link: "A" },
        { label: "Diccionario" },
        { label: "Notas" },
      ],
    },
  },
  {
    id: "reading",
    title: "Lectura inmersiva",
    description:
      "Libro completo sin distracciones, con tipografía de papel y modo enfoque activo.",
    kind: "window",
    diagram: { shape: "full", panes: [{ label: "Lectura continua" }] },
  },
  {
    id: "seminary",
    title: "Seminario exegético",
    description:
      "Biblia, libro y comentario sincronizados por el mismo grupo de enlace del Lienzo.",
    kind: "canvas",
    diagram: {
      shape: "row",
      panes: [
        { label: "Biblia", link: "A" },
        { label: "Libro", link: "A" },
        { label: "Comentario", link: "A" },
      ],
    },
  },
  {
    id: "grid4",
    title: "Cuadrícula multivista",
    description:
      "Dos traducciones, comentario y libro conectados en una cuadrícula de cuatro paneles.",
    kind: "canvas",
    diagram: {
      shape: "grid",
      panes: [
        { label: "Biblia 1", link: "A" },
        { label: "Biblia 2", link: "A" },
        { label: "Comentario", link: "A" },
        { label: "Libro", link: "A" },
      ],
    },
  },
  {
    id: "compare",
    title: "Paralelo de traducciones",
    description:
      "Dos versiones enfrentadas verso a verso, con comentario exegético a la vista.",
    kind: "canvas",
    diagram: {
      shape: "row",
      panes: [
        { label: "Biblia 1", link: "A" },
        { label: "Biblia 2", link: "A" },
        { label: "Comentario", link: "A" },
      ],
    },
  },
  {
    id: "avanzado-compare",
    title: "Estudio comparado avanzado",
    description:
      "Biblia, comparador integrado y comentario compartiendo el mismo grupo de enlace.",
    kind: "canvas",
    diagram: {
      shape: "row",
      panes: [
        { label: "Biblia", link: "A" },
        { label: "Comparador", link: "A" },
        { label: "Comentario", link: "A" },
      ],
    },
  },
  {
    id: "avanzado-original",
    title: "Idiomas originales",
    description:
      "Biblia, interlineal hebreo/griego, comentario y léxico Strong en una sola mirada.",
    kind: "canvas",
    diagram: {
      shape: "grid",
      panes: [
        { label: "Biblia", link: "A" },
        { label: "Interlineal", link: "A" },
        { label: "Comentario", link: "A" },
        { label: "Léxico Strong" },
      ],
    },
  },
];

const MODE_LABEL: Record<ReaderMode, string> = {
  verse: "Versículo",
  page: "Página",
  book: "Libro",
  interlinear: "Interlineal",
};

const GLYPHS = {
  close: "M6 6l12 12M18 6 6 18",
  search: "M10.5 4a6.5 6.5 0 1 0 4.1 11.6L20 21l1-1-5.4-5.4A6.5 6.5 0 0 0 10.5 4z",
  refresh: "M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6",
  trash: "M4 7h16M9 7V4h6v3m-8 0 1 14h8l1-14M10 11v6m4-6v6",
  arrow: "M5 12h13M13 6l6 6-6 6",
  bookmark: "M7 4h10v17l-5-3.6L7 21z",
};

function Glyph({ name, size = 16 }: { name: keyof typeof GLYPHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={GLYPHS[name]}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LayoutDiagram({ diagram }: { diagram: LayoutTemplate["diagram"] }) {
  if (diagram.shape === "split") {
    const [main, ...rest] = diagram.panes;
    return (
      <span className="env-diagram env-diagram--split" aria-hidden="true">
        <span className="env-pane" style={{ flexGrow: main.grow ?? 1.5 }}>
          <span>{main.label}</span>
          {main.link && <i>{main.link}</i>}
        </span>
        <span className="env-stack">
          {rest.map((pane) => (
            <span className="env-pane" key={pane.label}>
              <span>{pane.label}</span>
              {pane.link && <i>{pane.link}</i>}
            </span>
          ))}
        </span>
      </span>
    );
  }

  return (
    <span className={`env-diagram env-diagram--${diagram.shape}`} aria-hidden="true">
      {diagram.panes.map((pane) => (
        <span className="env-pane" key={pane.label} style={{ flexGrow: pane.grow ?? 1 }}>
          <span>{pane.label}</span>
          {pane.link && <i>{pane.link}</i>}
        </span>
      ))}
    </span>
  );
}

function shortDate(timestamp: number) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
  });
}

export default function EnvironmentsWorkspace({
  workspaces,
  workspaceName,
  onWorkspaceNameChange,
  onSave,
  onApply,
  onUpdate,
  onDelete,
  onApplyWindowPreset,
  onOpenModularPreset,
  onClose,
  bibles,
  books,
}: EnvironmentsWorkspaceProps) {
  const [filter, setFilter] = useState<"all" | "window" | "canvas">("all");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    rootRef.current?.querySelector<HTMLElement>(".env-close")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !rootRef.current) return;
      const focusable = Array.from(
        rootRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const visibleTemplates = useMemo(
    () => (filter === "all" ? TEMPLATES : TEMPLATES.filter((item) => item.kind === filter)),
    [filter],
  );

  const savedWorkspaces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workspaces;
    return workspaces.filter((workspace) => {
      const bible = bibles.find((item) => item.id === workspace.bibleId);
      const book = books.find((item) => item.number === workspace.book);
      return [workspace.name, bible?.title, bible?.abbreviation, book?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [bibles, books, query, workspaces]);

  const counts = {
    window: TEMPLATES.filter((item) => item.kind === "window").length,
    canvas: TEMPLATES.filter((item) => item.kind === "canvas").length,
  };

  function openTemplate(template: LayoutTemplate) {
    if (template.kind === "window") {
      onApplyWindowPreset(template.id as "study" | "reading");
      return;
    }
    onOpenModularPreset(template.id);
  }

  return (
    <div
      className="env-overlay"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="env-title"
    >
      <header className="env-toolbar">
        <div className="env-brand">
          <span className="env-emblem">
            <ModuleEmblem id="environments" size={22} />
          </span>
          <div className="env-brand-copy">
            <span className="eyebrow">Disposición del estudio</span>
            <h1 id="env-title">Entornos de estudio</h1>
            <p>
              Plantillas de paneles, enlaces y tipografía para abrir tu trabajo exegético en un
              solo gesto.
            </p>
          </div>
        </div>

        <div className="env-toolbar-actions">
          <span className="env-stat">
            <Glyph name="bookmark" size={13} />
            <strong>{workspaces.length}</strong> guardados
          </span>
          <button type="button" className="env-close" onClick={onClose} aria-label="Cerrar entornos">
            <Glyph name="close" size={17} />
          </button>
        </div>
      </header>

      <div className="env-body">
        <main className="env-gallery">
          <div className="env-gallery-head">
            <div>
              <span className="eyebrow">Plantillas listas</span>
              <h2>Elige cómo quieres leer</h2>
              <p>
                Cada plantilla abre la ventana principal o el Lienzo con sus paneles ya
                sincronizados.
              </p>
            </div>
            <div className="env-filters" role="group" aria-label="Filtrar plantillas">
              {(
                [
                  ["all", "Todas", TEMPLATES.length],
                  ["window", "Ventana", counts.window],
                  ["canvas", "Lienzo", counts.canvas],
                ] as const
              ).map(([value, label, total]) => (
                <button
                  key={value}
                  type="button"
                  className={`env-filter${filter === value ? " active" : ""}`}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                  <span>{total}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="env-grid">
            {visibleTemplates.map((template, index) => (
              <button
                key={template.id}
                type="button"
                className="env-card"
                style={{ "--i": index } as CSSProperties}
                onClick={() => openTemplate(template)}
              >
                <span className="env-card-head">
                  <span className={`env-kind env-kind--${template.kind}`}>
                    {template.kind === "window" ? "Ventana principal" : "Lienzo multipanel"}
                  </span>
                  {template.tag && <span className="env-tag">{template.tag}</span>}
                </span>

                <LayoutDiagram diagram={template.diagram} />

                <span className="env-card-title">{template.title}</span>
                <span className="env-card-desc">{template.description}</span>

                <span className="env-card-cta">
                  Abrir entorno
                  <Glyph name="arrow" size={14} />
                </span>
              </button>
            ))}
          </div>

          <p className="env-hint">
            ¿Prefieres guardar tu propia combinación? Escribe un nombre en <strong>Mis entornos</strong>{" "}
            y pulsa <strong>Guardar</strong>: quedará disponible en cualquier momento.
            <br />
            <strong>Biblia destino:</strong> con el Lienzo abierto, pulsa <strong>Destino</strong> en
            la Biblia que quieras. Las citas de libros, EPUB y comentarios se abrirán exactamente
            ahí, aunque haya otras Biblias abiertas.
          </p>
        </main>

        <aside className="env-side" aria-label="Entornos guardados">
          <div className="env-side-head">
            <span className="eyebrow">Biblioteca personal</span>
            <h2>Mis entornos</h2>
            <p>
              {workspaces.length === 0
                ? "Todavía no has guardado ninguno."
                : `${workspaces.length} de 24 guardados en este equipo.`}
            </p>
          </div>

          <form
            className="env-save"
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <label htmlFor="env-name">Nombre del entorno</label>
            <div className="env-save-row">
              <input
                id="env-name"
                value={workspaceName}
                onChange={(event) => onWorkspaceNameChange(event.target.value)}
                placeholder="Ej. Juan 3 · Sepia"
                autoComplete="off"
              />
              <button type="submit" className="env-save-button">
                Guardar
              </button>
            </div>
            <small>Captura la ventana actual: Biblia, paneles, tipografía y tema.</small>
          </form>

          <div className="env-search">
            <Glyph name="search" size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar entorno guardado…"
              aria-label="Buscar entorno guardado"
            />
          </div>

          <ul className="env-list">
            {savedWorkspaces.map((workspace) => {
              const bible = bibles.find((item) => item.id === workspace.bibleId);
              const book = books.find((item) => item.number === workspace.book);
              return (
                <li className="env-saved" key={workspace.id}>
                  <button
                    type="button"
                    className="env-saved-main"
                    onClick={() => onApply(workspace)}
                    title={`Aplicar ${workspace.name}`}
                  >
                    <span className="env-saved-name">{workspace.name}</span>
                    <span className="env-saved-meta">
                      {bible?.abbreviation || bible?.title || "Biblia"} ·{" "}
                      {book?.name ?? `Libro ${workspace.book}`} {workspace.chapter}:
                      {workspace.activeVerse}
                    </span>
                    <span className="env-saved-foot">
                      {MODE_LABEL[workspace.readerMode]} · {shortDate(workspace.createdAt)}
                    </span>
                  </button>
                  <span className="env-saved-actions">
                    <button
                      type="button"
                      onClick={() => onUpdate(workspace.id)}
                      title="Actualizar con la disposición actual"
                      aria-label={`Actualizar entorno ${workspace.name}`}
                    >
                      <Glyph name="refresh" size={14} />
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onDelete(workspace.id)}
                      title="Eliminar entorno"
                      aria-label={`Eliminar entorno ${workspace.name}`}
                    >
                      <Glyph name="trash" size={14} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>

          {savedWorkspaces.length === 0 && (
            <div className="env-empty">
              <span className="env-empty-mark">
                <ModuleEmblem id="environments" size={22} />
              </span>
              <strong>{query ? "Sin coincidencias" : "Tu primer entorno"}</strong>
              <p>
                {query
                  ? "Prueba con otro nombre, versión o libro."
                  : "Ajusta la Biblia, los paneles y la tipografía; después guarda una instantánea con su nombre."}
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
