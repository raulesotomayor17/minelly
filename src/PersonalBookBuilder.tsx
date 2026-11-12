import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface CustomAttribute {
  key: string;
  value: string;
}

interface PbbMetadata {
  title: string;
  resourceType: string;
  language: string;
  author: string;
  copyright: string;
  description: string;
  coverImagePath: string;
  customAttributes: CustomAttribute[];
}

interface PbbSource {
  path: string;
  orderIndex: number;
}

interface PbbSourceRecord {
  path: string;
  orderIndex: number;
  modified: number;
  size: number;
}

interface PbbBook {
  resourceId: string;
  title: string;
  resourceType: string;
  language: string;
  author: string;
  copyright: string;
  description: string;
  coverPath: string;
  customAttributes: CustomAttribute[];
  sources: PbbSourceRecord[];
  logPath: string;
  status: string;
  errorCount: number;
  warningCount: number;
  cloudSynced: boolean;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
}

interface PbbStage {
  id: number;
  name: string;
  status: string;
  detail: string;
}

interface PbbDiagnostic {
  code: string;
  severity: string;
  message: string;
  source: string;
}

interface PbbBuildResult {
  status: string;
  errorCount: number;
  warningCount: number;
  logPath: string;
  resourceId: string;
  title: string;
  stages: PbbStage[];
  diagnostics: PbbDiagnostic[];
  message: string;
}

interface PersonalBookBuilderProps {
  onClose: () => void;
  onOpenResource: (resourceId: string) => void;
  onCatalogChanged: () => Promise<void>;
  onOpenCustomization?: () => void;
}

const RESOURCE_TYPES = [
  "Monograph",
  "Commentary",
  "Bible Harmony",
  "Sermon",
  "Lexicon",
];

const TYPE_LABELS: Record<string, string> = {
  Monograph: "Monografía",
  Commentary: "Comentario",
  "Bible Harmony": "Armonía bíblica",
  Sermon: "Sermón",
  Lexicon: "Léxico",
};

const LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
  { value: "pt", label: "Portugués" },
  { value: "fr", label: "Francés" },
  { value: "de", label: "Alemán" },
];

const CUSTOM_KEYS = [
  "Series Title",
  "Subject Heading",
  "Publisher",
  "Publication Date",
];

const EMPTY_METADATA: PbbMetadata = {
  title: "",
  resourceType: "Monograph",
  language: "es",
  author: "",
  copyright: "",
  description: "",
  coverImagePath: "",
  customAttributes: [],
};

const EMPTY_STAGES: PbbStage[] = [
  { id: 1, name: "Starting", status: "pending", detail: "" },
  { id: 2, name: "Converting", status: "pending", detail: "" },
  { id: 3, name: "Compiling", status: "pending", detail: "" },
  { id: 4, name: "Discovering", status: "pending", detail: "" },
];

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function formatDate(value: number) {
  if (!value) return "—";
  return new Date(value * 1000).toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PersonalBookBuilder({
  onClose,
  onOpenResource,
  onCatalogChanged,
  onOpenCustomization,
}: PersonalBookBuilderProps) {
  const [metadata, setMetadata] = useState<PbbMetadata>(EMPTY_METADATA);
  const [sources, setSources] = useState<PbbSource[]>([]);
  const [books, setBooks] = useState<PbbBook[]>([]);
  const [building, setBuilding] = useState(false);
  const [activeStage, setActiveStage] = useState(0);
  const [stages, setStages] = useState<PbbStage[]>(EMPTY_STAGES);
  const [result, setResult] = useState<PbbBuildResult | null>(null);
  const [logText, setLogText] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pbbScale, setPbbScale] = useState<number>(() => {
    const saved = Number(localStorage.getItem("teoamoxtli.pbb.scale"));
    return saved >= 0.85 && saved <= 1.6 ? saved : 1;
  });

  function adjustPbbScale(delta: number) {
    setPbbScale((prev) => {
      const next = Math.min(1.6, Math.max(0.85, Number((prev + delta).toFixed(2))));
      localStorage.setItem("teoamoxtli.pbb.scale", String(next));
      return next;
    });
  }

  async function refreshBooks() {
    try {
      const list = await invoke<PbbBook[]>("pbb_list");
      setBooks(list);
    } catch (value) {
      setError(String(value));
    }
  }

  useEffect(() => {
    void refreshBooks();
  }, []);

  useEffect(() => {
    if (!building) return;
    setActiveStage(0);
    const timer = window.setInterval(() => {
      setActiveStage((current) => Math.min(3, current + 1));
    }, 900);
    return () => window.clearInterval(timer);
  }, [building]);

  function patchMetadata(patch: Partial<PbbMetadata>) {
    setMetadata((current) => ({ ...current, ...patch }));
  }

  async function chooseSources() {
    const selected = await open({
      multiple: true,
      directory: false,
      title: "Selecciona libros o documentos (.epub, .azw3, .mobi, .docx, .pdf)",
      filters: [
        {
          name: "Libros y documentos (EPUB, AZW3, MOBI, DOCX, PDF)",
          extensions: ["epub", "azw3", "mobi", "docx", "pdf"],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length > 0 && !metadata.title.trim()) {
      const firstFile = basename(paths[0]).replace(/\.(epub|azw3|mobi|docx|pdf)$/i, "");
      const parts = firstFile.split(/\s+-\s+/);
      if (parts.length >= 2) {
        patchMetadata({
          title: parts[0].trim(),
          author: metadata.author.trim() || parts[parts.length - 1].trim(),
        });
      } else {
        patchMetadata({ title: firstFile.trim() });
      }
    }
    setSources((current) => {
      const existing = new Set(current.map((source) => source.path));
      const next = [...current];
      for (const path of paths) {
        if (!existing.has(path)) {
          next.push({ path, orderIndex: next.length });
        }
      }
      return next.map((source, index) => ({ ...source, orderIndex: index }));
    });
  }

  async function chooseCover() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Selecciona la portada",
      filters: [{ name: "Imágenes", extensions: ["jpg", "jpeg", "png"] }],
    });
    if (typeof selected === "string") {
      patchMetadata({ coverImagePath: selected });
    }
  }

  function moveSource(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= sources.length) return;
    const next = [...sources];
    [next[index], next[target]] = [next[target], next[index]];
    setSources(next.map((source, order) => ({ ...source, orderIndex: order })));
  }

  function removeSource(index: number) {
    setSources((current) =>
      current
        .filter((_, position) => position !== index)
        .map((source, order) => ({ ...source, orderIndex: order })),
    );
  }

  function addAttribute() {
    patchMetadata({
      customAttributes: [
        ...metadata.customAttributes,
        { key: CUSTOM_KEYS[0], value: "" },
      ],
    });
  }

  function updateAttribute(index: number, patch: Partial<CustomAttribute>) {
    patchMetadata({
      customAttributes: metadata.customAttributes.map((attribute, position) =>
        position === index ? { ...attribute, ...patch } : attribute,
      ),
    });
  }

  function removeAttribute(index: number) {
    patchMetadata({
      customAttributes: metadata.customAttributes.filter((_, position) => position !== index),
    });
  }

  async function buildBook() {
    if (!metadata.title.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    if (sources.length === 0) {
      setError("Añade al menos un documento fuente.");
      return;
    }
    setBuilding(true);
    setResult(null);
    setError("");
    setMessage("");
    setStages(EMPTY_STAGES);
    try {
      const response = await invoke<PbbBuildResult>("pbb_build", {
        request: {
          metadata,
          sources: sources.map((source) => ({
            path: source.path,
            orderIndex: source.orderIndex,
          })),
          existingResourceId: null,
        },
      });
      setResult(response);
      setStages(response.stages);
      setActiveStage(response.status === "failed" ? 3 : 4);
      setMessage(response.message);
      await refreshBooks();
      await onCatalogChanged();
    } catch (value) {
      setError(String(value));
    } finally {
      setBuilding(false);
    }
  }

  async function openLog(path: string) {
    try {
      const text = await invoke<string>("pbb_read_log", { path });
      setLogText(text);
      setLogOpen(true);
    } catch (value) {
      setError(String(value));
    }
  }

  async function recompile(book: PbbBook) {
    setError("");
    setMessage("");
    setBuilding(true);
    try {
      const response = await invoke<PbbBuildResult>("pbb_recompile", {
        resourceId: book.resourceId,
      });
      setResult(response);
      setStages(response.stages);
      setMessage(response.message);
      await refreshBooks();
      await onCatalogChanged();
    } catch (value) {
      setError(String(value));
    } finally {
      setBuilding(false);
    }
  }

  async function deleteBook(book: PbbBook) {
    const confirmed = window.confirm(
      `¿Eliminar «${book.title}» de la biblioteca local? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;
    try {
      await invoke("pbb_delete", { resourceId: book.resourceId });
      setMessage(`«${book.title}» eliminado de la biblioteca local.`);
      await refreshBooks();
      await onCatalogChanged();
    } catch (value) {
      setError(String(value));
    }
  }

  async function setSynced(book: PbbBook) {
    try {
      const bundle = await invoke<string>("pbb_set_synced", {
        resourceId: book.resourceId,
        synced: true,
      });
      setMessage(
        `Paquete de sincronización local creado en ${bundle}. El libro queda inmutable y solo puede ocultarse.`,
      );
      await refreshBooks();
    } catch (value) {
      setError(String(value));
    }
  }

  const stagesToShow = result?.stages ?? stages.map((stage, index) => ({
    ...stage,
    status:
      building && index < activeStage
        ? "completed"
        : building && index === activeStage
          ? "running"
          : stage.status,
  }));

  return (
    <div
      className="pbb-overlay"
      style={{ "--pbb-scale": pbbScale } as React.CSSProperties}
    >
      <header className="pbb-header">
        <div>
          <span className="eyebrow">Constructor de Libros Personales</span>
          <h1>Biblioteca PBB</h1>
          <p>
            Formatos comerciales (AZW3, EPUB, MOBI, DOCX y PDF), detección automática de jerarquías/estilos implícitos, capítulos automatizados e índice interactivo SQLite/FTS5.
          </p>
        </div>
        <div className="pbb-header-actions">
          <div className="module-scale-group" title="Ajustar tamaño de texto de este módulo">
            <span>Texto</span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => adjustPbbScale(-0.08)}
              title="Reducir tamaño de texto"
            >
              A−
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => adjustPbbScale(0.08)}
              title="Aumentar tamaño de texto"
            >
              A+
            </button>
          </div>
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
          <button className="secondary-button" onClick={() => void refreshBooks()}>
            Actualizar
          </button>
          <button className="primary-button" onClick={onClose}>
            Volver al lector
          </button>
        </div>
      </header>

      {message && (
        <div className="pbb-notice">
          <span>{message}</span>
          <button onClick={() => setMessage("")} aria-label="Cerrar aviso">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="pbb-notice error">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Cerrar error">
            ×
          </button>
        </div>
      )}

      <div className="pbb-layout">
        <main className="pbb-main">
          <section className="pbb-card">
            <div className="pbb-card-heading">
              <div>
                <span className="pbb-step">1</span>
                <h2>Metadatos bibliográficos</h2>
              </div>
              <span className="pbb-required">Título, tipo e idioma obligatorios</span>
            </div>
            <div className="pbb-form-grid">
              <label className="pbb-wide">
                <span>Título *</span>
                <input
                  value={metadata.title}
                  onChange={(event) => patchMetadata({ title: event.target.value })}
                  placeholder="Título del libro personal"
                />
              </label>
              <label>
                <span>Tipo</span>
                <select
                  value={metadata.resourceType}
                  onChange={(event) => patchMetadata({ resourceType: event.target.value })}
                >
                  {RESOURCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Idioma</span>
                <select
                  value={metadata.language}
                  onChange={(event) => patchMetadata({ language: event.target.value })}
                >
                  {LANGUAGES.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Autor</span>
                <input
                  value={metadata.author}
                  onChange={(event) => patchMetadata({ author: event.target.value })}
                  placeholder="Autor o editor"
                />
              </label>
              <label>
                <span>Copyright</span>
                <input
                  value={metadata.copyright}
                  onChange={(event) => patchMetadata({ copyright: event.target.value })}
                  placeholder="© 2026"
                />
              </label>
              <label className="pbb-wide">
                <span>Descripción</span>
                <textarea
                  rows={2}
                  value={metadata.description}
                  onChange={(event) => patchMetadata({ description: event.target.value })}
                  placeholder="Breve descripción del recurso"
                />
              </label>
              <div className="pbb-wide pbb-cover-row">
                <div>
                  <span className="pbb-label">Portada</span>
                  <p className="pbb-hint">JPG o PNG; se copia dentro de los datos de la app.</p>
                </div>
                <button className="secondary-button" onClick={() => void chooseCover()}>
                  {metadata.coverImagePath ? "Cambiar portada" : "Elegir portada"}
                </button>
                {metadata.coverImagePath && (
                  <span className="pbb-file-name">{basename(metadata.coverImagePath)}</span>
                )}
              </div>
            </div>

            <div className="pbb-attributes">
              <div className="pbb-attributes-heading">
                <strong>Campos extensibles</strong>
                <button className="secondary-button" onClick={addAttribute}>
                  + Añadir campo
                </button>
              </div>
              {metadata.customAttributes.length === 0 && (
                <p className="pbb-hint">Opcional: serie, materia, editorial y fecha.</p>
              )}
              {metadata.customAttributes.map((attribute, index) => (
                <div className="pbb-attribute-row" key={`${attribute.key}-${index}`}>
                  <select
                    value={attribute.key}
                    onChange={(event) =>
                      updateAttribute(index, { key: event.target.value })
                    }
                  >
                    {CUSTOM_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                  <input
                    value={attribute.value}
                    onChange={(event) =>
                      updateAttribute(index, { value: event.target.value })
                    }
                    placeholder="Valor"
                  />
                  <button
                    className="icon-button"
                    onClick={() => removeAttribute(index)}
                    aria-label="Quitar campo"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="pbb-card">
            <div className="pbb-card-heading">
              <div>
                <span className="pbb-step">2</span>
                <h2>Cola de archivos fuente</h2>
              </div>
              <button className="secondary-button" onClick={() => void chooseSources()}>
                + Añadir archivos
              </button>
            </div>
            <p className="pbb-hint">
              Formatos comerciales admitidos: <strong>AZW3, EPUB, MOBI, DOCX y PDF</strong>. El compilador respeta automáticamente las jerarquías de títulos (explícitas e implícitas, estilos tipográficos y <code>toc.ncx</code>) para generar los capítulos automatizados y el índice interactivo.
            </p>
            {sources.length === 0 ? (
              <div className="pbb-empty">
                No hay documentos en la cola. Añade uno o varios archivos .azw3, .epub, .mobi, .docx o .pdf.
              </div>
            ) : (
              <div className="pbb-source-list">
                {sources.map((source, index) => (
                  <div className="pbb-source-row" key={source.path}>
                    <span className="pbb-order">{index + 1}</span>
                    <div className="pbb-source-info">
                      <strong>{basename(source.path)}</strong>
                      <span>{source.path}</span>
                    </div>
                    <button
                      className="icon-button"
                      onClick={() => moveSource(index, -1)}
                      disabled={index === 0}
                      aria-label="Subir archivo"
                      title="Subir"
                    >
                      ↑
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => moveSource(index, 1)}
                      disabled={index === sources.length - 1}
                      aria-label="Bajar archivo"
                      title="Bajar"
                    >
                      ↓
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => removeSource(index)}
                      aria-label="Quitar archivo"
                      title="Quitar"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="pbb-card">
            <div className="pbb-card-heading">
              <div>
                <span className="pbb-step">3</span>
                <h2>Validación y compilación</h2>
              </div>
              <button
                className="primary-button"
                onClick={() => void buildBook()}
                disabled={building}
              >
                {building ? "Compilando…" : "Crear libro"}
              </button>
            </div>
            <div className="pbb-pipeline">
              {stagesToShow.map((stage, index) => (
                <div
                  className={`pbb-stage ${stage.status}`}
                  key={stage.id}
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{stage.name}</strong>
                    <small>{stage.detail || stage.status}</small>
                  </div>
                </div>
              ))}
            </div>

            {result && (
              <div className={`pbb-result ${result.status}`}>
                <div className="pbb-result-heading">
                  <strong>
                    {result.status === "success"
                      ? "Libro compilado"
                      : "Compilación fallida"}
                  </strong>
                  <span>
                    {result.errorCount} errores · {result.warningCount} advertencias
                  </span>
                </div>
                <p>{result.message}</p>
                {result.status === "success" && result.diagnostics.some((item) => item.code === "AUTO_HEAL") && (
                  <div className="pbb-autoheal-badge">
                    ✓ Auto-maquetado: {result.diagnostics.find((item) => item.code === "AUTO_HEAL")?.message.replace("Auto-sanación: ", "")}
                  </div>
                )}
                <div className="pbb-result-actions">
                  {result.status === "success" && (
                    <button
                      className="primary-button"
                      onClick={() => onOpenResource(result.resourceId)}
                    >
                      Abrir libro
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    onClick={() => void openLog(result.logPath)}
                  >
                    Ver archivo de registro
                  </button>
                  <button className="secondary-button" onClick={() => setResult(null)}>
                    Terminar
                  </button>
                </div>
              </div>
            )}

            {result && result.diagnostics.length > 0 && (
              <div className="pbb-diagnostics">
                {result.diagnostics.map((diagnostic, index) => (
                  <div className={`pbb-diagnostic ${diagnostic.severity}`} key={index}>
                    <strong>{diagnostic.code}</strong>
                    <span>{diagnostic.message}</span>
                    <small>{diagnostic.source}</small>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="pbb-card">
            <div className="pbb-card-heading">
              <div>
                <span className="pbb-step">4</span>
                <h2>Biblioteca de libros personales</h2>
              </div>
              <span className="pbb-required">{books.length} registros</span>
            </div>
            {books.length === 0 ? (
              <div className="pbb-empty">Todavía no has creado ningún libro personal.</div>
            ) : (
              <div className="pbb-book-list">
                {books.map((book) => (
                  <article className="pbb-book" key={book.resourceId}>
                    <div className="pbb-book-main">
                      <div>
                        <strong>{book.title}</strong>
                        <span>
                          {TYPE_LABELS[book.resourceType] ?? book.resourceType} ·{" "}
                          {book.language.toUpperCase()} · {book.sources.length} archivo(s)
                        </span>
                        <small>
                          {formatDate(book.updatedAt)} · {book.status}
                          {book.cloudSynced ? " · inmutable" : ""}
                        </small>
                      </div>
                      <div className="pbb-book-actions">
                        <button
                          className="secondary-button"
                          onClick={() => onOpenResource(book.resourceId)}
                        >
                          Abrir
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => void recompile(book)}
                          disabled={book.cloudSynced}
                        >
                          Re-maquetar y limpiar
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => void openLog(book.logPath)}
                        >
                          Log
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => void setSynced(book)}
                          disabled={book.status !== "success" || book.cloudSynced}
                          title={
                            book.cloudSynced
                              ? "Ya sincronizado: inmutable"
                              : "Crear paquete local de sincronización"
                          }
                        >
                          {book.cloudSynced ? "Sincronizado" : "Sincronizar"}
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => void deleteBook(book)}
                          disabled={book.cloudSynced}
                          aria-label="Eliminar libro"
                          title="Eliminar de la biblioteca local"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="pbb-side">
          <div className="pbb-side-card">
            <span className="eyebrow">Diagnóstico</span>
            <h3>Estado del proceso</h3>
            <div className="pbb-side-stages">
              {stagesToShow.map((stage) => (
                <div key={stage.id} className={`pbb-side-stage ${stage.status}`}>
                  <span>{stage.id}</span>
                  <div>
                    <strong>{stage.name}</strong>
                    <small>{stage.detail || stage.status}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="pbb-side-card">
            <span className="eyebrow">Resumen</span>
            <dl className="pbb-summary">
              <div>
                <dt>Título</dt>
                <dd>{metadata.title || "Sin título"}</dd>
              </div>
              <div>
                <dt>Tipo</dt>
                <dd>{TYPE_LABELS[metadata.resourceType] ?? metadata.resourceType}</dd>
              </div>
              <div>
                <dt>Documentos</dt>
                <dd>{sources.length}</dd>
              </div>
              <div>
                <dt>Atributos</dt>
                <dd>{metadata.customAttributes.length}</dd>
              </div>
            </dl>
            <p className="pbb-hint">
              La compilación crea capítulos en <code>epub_chapters</code>, un índice
              FTS5 y un registro PBB local.
            </p>
          </div>
        </aside>
      </div>

      {logOpen && (
        <div className="pbb-log-backdrop" role="dialog" aria-modal="true">
          <div className="pbb-log">
            <header>
              <div>
                <span className="eyebrow">Registro de diagnóstico</span>
                <h2>PBB .log</h2>
              </div>
              <button className="icon-button" onClick={() => setLogOpen(false)} aria-label="Cerrar registro">
                ×
              </button>
            </header>
            <pre>{logText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
