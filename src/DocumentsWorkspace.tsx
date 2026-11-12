import { useEffect, useMemo, useState } from "react";

interface DocumentsWorkspaceProps {
  onClose: () => void;
  onOpenPrayer: () => void;
  onOpenGuides: () => void;
}

interface PrayerDoc {
  id: string;
  title: string;
  body?: string;
  createdAt?: number;
}

interface GuideDoc {
  templateId?: string;
  updatedAt?: number;
}

const GUIDE_NAMES: Record<string, string> = {
  inductivo: "Método inductivo",
  devocional: "Devocional personal",
  palabra: "Estudio de palabra",
  sermon: "Preparación de sermón",
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function DocumentsWorkspace({
  onClose,
  onOpenPrayer,
  onOpenGuides,
}: DocumentsWorkspaceProps) {
  const prayers = readJson<PrayerDoc[]>("teoamoxtli.prayers.v1", []);
  const guide = readJson<GuideDoc>("teoamoxtli.study-guide.v1", {});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "prayer" | "guide">("all");
  const [modified, setModified] = useState<"all" | "today" | "7" | "30">("all");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const documents = useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      type: "Lista de oración" | "Guía de estudio";
      detail: string;
      date: number;
      open: () => void;
    }> = [
      {
        id: "prayer-list",
        name: "Lista de oración devocional",
        type: "Lista de oración" as const,
        detail: `${prayers.length} oraciones`,
        date: Math.max(0, ...prayers.map((item) => item.createdAt ?? 0)),
        open: onOpenPrayer,
      },
    ];
    const guideAnswers = readJson<{ answers?: string[] }>(
      "teoamoxtli.study-guide.v1",
      {},
    ).answers;
    const guideHasContent = Array.isArray(guideAnswers)
      ? guideAnswers.some((answer) => answer?.trim())
      : false;
    if (guide.templateId || guideHasContent) {
      items.push({
        id: "study-guide",
        name: `Guía: ${GUIDE_NAMES[guide.templateId ?? "inductivo"] ?? "Estudio"}`,
        type: "Guía de estudio" as const,
        detail: guideHasContent ? "Con respuestas guardadas" : "Sin respuestas todavía",
        date: guide.updatedAt ?? 0,
        open: onOpenGuides,
      });
    }
    const now = Date.now();
    const cutoff =
      modified === "today"
        ? new Date().setHours(0, 0, 0, 0)
        : modified === "7"
          ? now - 7 * 86400000
          : modified === "30"
            ? now - 30 * 86400000
            : 0;
    return items.filter(
      (item) =>
        (filter === "all" || (filter === "prayer" ? item.type === "Lista de oración" : item.type === "Guía de estudio")) &&
        item.date >= cutoff &&
        (!query.trim() ||
          `${item.name} ${item.type} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase())),
    );
  }, [prayers, guide, filter, query, modified, onOpenPrayer, onOpenGuides]);

  function formatDate(value: number) {
    if (!value) return "Hoy";
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  }

  return (
    <div className="documents-backdrop" role="dialog" aria-modal="true">
      <section className="documents-panel">
        <header className="documents-head">
          <div>
            <span className="eyebrow">Documentos</span>
            <h2>Tus documentos de estudio</h2>
          </div>
          <button type="button" className="word-study-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="documents-tabs">
          <button type="button" className="active">Tuyos</button>
          <button type="button" disabled>Grupos</button>
          <button type="button" disabled>Público</button>
          <span />
          <button type="button" className="home-primary" onClick={onOpenPrayer}>+ Nueva oración</button>
          <button type="button" className="secondary-button" onClick={onOpenGuides}>+ Nueva guía</button>
        </div>
        <div className="documents-body">
          <aside className="documents-filters">
            <label className="documents-search">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar documentos…"
              />
            </label>
            <div className="documents-filter-group">
              <span>TIPO</span>
              <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todos</button>
              <button type="button" className={filter === "prayer" ? "active" : ""} onClick={() => setFilter("prayer")}>Listas de oración</button>
              <button type="button" className={filter === "guide" ? "active" : ""} onClick={() => setFilter("guide")}>Guías de estudio</button>
            </div>
            <div className="documents-filter-group">
              <span>MODIFICADO</span>
              <button type="button" className={modified === "today" ? "active" : ""} onClick={() => setModified("today")}>Hoy</button>
              <button type="button" className={modified === "7" ? "active" : ""} onClick={() => setModified("7")}>Últimos 7 días</button>
              <button type="button" className={modified === "30" ? "active" : ""} onClick={() => setModified("30")}>Últimos 30 días</button>
              {modified !== "all" && (
                <button type="button" onClick={() => setModified("all")}>Ver todas las fechas</button>
              )}
            </div>
          </aside>
          <div className="documents-list">
            <div className="documents-list-head">
              <strong>Nombre</strong>
              <span>Tipo</span>
              <span>Fecha</span>
            </div>
            {documents.map((document) => (
              <button
                key={document.id}
                type="button"
                className="document-row"
                onClick={document.open}
              >
                <span className="document-icon">▤</span>
                <span>
                  <strong>{document.name}</strong>
                  <small>{document.detail}</small>
                </span>
                <span>{document.type}</span>
                <span>{formatDate(document.date)}</span>
              </button>
            ))}
            {documents.length === 0 && (
              <div className="documents-empty">
                <h3>No hay documentos con este filtro</h3>
                <p>Crea una lista de oración o una guía de estudio para comenzar.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
