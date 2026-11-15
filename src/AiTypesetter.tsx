import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ModuleEmblem from "./ModuleEmblem";
import "./AiTypesetter.css";

interface BookItem {
  id: string;
  title: string;
}

interface DigestBlock {
  index: number;
  tag: string;
  text: string;
}

interface BookDigest {
  resourceId: string;
  title: string;
  blockCount: number;
  candidates: DigestBlock[];
  digest: string;
  estimatedTokens: number;
}

interface PlanChapter {
  block: number;
  title: string;
}

interface PlanHeading {
  block: number;
  level: number;
}

interface TypesetPlan {
  chapters: PlanChapter[];
  headings: PlanHeading[];
}

interface ApplyReport {
  chapters: number;
  backupPath: string;
}

interface AiTypesetterProps {
  books: BookItem[];
  onClose: () => void;
  onApplied: () => void;
}

const CONFIG_KEY = "teoamoxtli.assistant.config.v2";

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "deepseek/deepseek-chat",
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1/chat/completions",
    model: "llama3.1",
  },
};

const SYSTEM_PROMPT = `Eres un maquetador editorial experto en libros.
Recibes un mapa de bloques de un libro: índice, etiqueta HTML y las primeras palabras del bloque.
Tu tarea es proponer la estructura de capítulos y los niveles de título.

Devuelve SOLO un objeto JSON, sin comentarios ni markdown:
{"chapters":[{"block":12,"title":"Título del capítulo"}],"headings":[{"block":12,"level":2},{"block":48,"level":3}]}

Reglas:
- "chapters" indica el bloque donde EMPIEZA cada capítulo. El primero debe ser el inicio real del libro o de su primer capítulo.
- "headings" asigna nivel 1-4 a los bloques que son títulos; incluye los inicios de capítulo con nivel 1 o 2 según la jerarquía del libro.
- Usa únicamente índices que aparecen en el mapa. No inventes índices.
- Títulos limpios: sin numeración duplicada, sin símbolos de control, sin comillas decorativas.
- Entre 3 y 80 capítulos según el tamaño del libro. No conviertas cada párrafo en capítulo.
- No inventes contenido ni títulos que no estén sugeridos por el texto.`;

interface AssistantConfig {
  provider?: string;
  baseUrlByProvider?: Record<string, string>;
  modelByProvider?: Record<string, string>;
  apiKeyByProvider?: Record<string, string>;
}

function loadConfig(): AssistantConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as AssistantConfig) : null;
  } catch {
    return null;
  }
}

function resolveProvider(config: AssistantConfig | null) {
  const provider = config?.provider || "deepseek";
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    provider,
    baseUrl:
      config?.baseUrlByProvider?.[provider] || defaults?.baseUrl || PROVIDER_DEFAULTS.deepseek.baseUrl,
    model:
      config?.modelByProvider?.[provider] || defaults?.model || PROVIDER_DEFAULTS.deepseek.model,
    apiKey: config?.apiKeyByProvider?.[provider] || "",
  };
}

function parsePlan(raw: string): TypesetPlan {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("La IA no devolvió JSON válido.");
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<TypesetPlan>;
  const chapters = Array.isArray(parsed.chapters)
    ? parsed.chapters
        .filter(
          (chapter): chapter is PlanChapter =>
            Boolean(chapter) &&
            typeof chapter.block === "number" &&
            Number.isFinite(chapter.block),
        )
        .map((chapter) => ({
          block: Math.trunc(chapter.block),
          title: typeof chapter.title === "string" ? chapter.title.trim() : "",
        }))
    : [];
  const headings = Array.isArray(parsed.headings)
    ? parsed.headings
        .filter(
          (heading): heading is PlanHeading =>
            Boolean(heading) &&
            typeof heading.block === "number" &&
            typeof heading.level === "number",
        )
        .map((heading) => ({
          block: Math.trunc(heading.block),
          level: Math.min(4, Math.max(1, Math.trunc(heading.level))),
        }))
    : [];
  if (chapters.length === 0) {
    throw new Error("La IA no propuso capítulos.");
  }
  return { chapters, headings };
}

async function analyzeWithModel(digest: BookDigest): Promise<TypesetPlan> {
  const config = loadConfig();
  const { provider, baseUrl, model, apiKey } = resolveProvider(config);
  if (!apiKey) {
    throw new Error(
      "No hay clave de API guardada. Abre «Asistente» o «Configuración» y guarda la clave del proveedor.",
    );
  }
  if (provider === "gemini") {
    throw new Error(
      "Gemini usa otra forma de API. Para maquetado usa DeepSeek u otro proveedor compatible con OpenAI en «Configuración del Asistente».",
    );
  }
  const body = {
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: digest.digest },
    ],
    response_format: { type: "json_object" },
  };
  let response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok && response.status === 400) {
    // Algunos proveedores no aceptan response_format: reintento sin él.
    const retry = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...body, response_format: undefined }),
    });
    response = retry;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`La API respondió ${response.status}. ${detail.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  return parsePlan(content);
}

export default function AiTypesetter({ books, onClose, onApplied }: AiTypesetterProps) {
  const [selectedId, setSelectedId] = useState(books[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [digest, setDigest] = useState<BookDigest | null>(null);
  const [plan, setPlan] = useState<TypesetPlan | null>(null);
  const [busy, setBusy] = useState<"" | "digest" | "analyze" | "apply" | "undo">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [backupPath, setBackupPath] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    rootRef.current?.querySelector<HTMLElement>(".ai-close")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.();
    };
  }, [onClose]);

  const visibleBooks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return books;
    return books.filter((book) => book.title.toLowerCase().includes(needle));
  }, [books, query]);

  const selectedBook = books.find((book) => book.id === selectedId);

  function resetForBook(id: string) {
    setSelectedId(id);
    setDigest(null);
    setPlan(null);
    setError("");
    setMessage("");
    setBackupPath("");
  }

  async function runDigest() {
    if (!selectedId) return;
    setBusy("digest");
    setError("");
    setMessage("");
    setPlan(null);
    try {
      const result = await invoke<BookDigest>("book_typeset_digest", {
        resourceId: selectedId,
      });
      setDigest(result);
      if (result.candidates.length < 3) {
        setError("El libro no tiene suficientes bloques candidatos para analizar.");
      } else {
        setMessage(
          `Mapa listo: ${result.candidates.length} candidatos de ${result.blockCount} bloques.`,
        );
      }
    } catch (issue) {
      setError(String(issue));
    } finally {
      setBusy("");
    }
  }

  async function runAnalysis() {
    if (!digest) return;
    const estimate = digest.estimatedTokens;
    const confirmed = window.confirm(
      `Se enviarán aproximadamente ${estimate.toLocaleString("es")} tokens al proveedor de IA ` +
        `(entrada + respuesta). El coste depende de tu tarifa.\n\n¿Analizar «${digest.title}»?`,
    );
    if (!confirmed) return;
    setBusy("analyze");
    setError("");
    setMessage("");
    try {
      const result = await analyzeWithModel(digest);
      setPlan(result);
      setMessage(
        `Propuesta: ${result.chapters.length} capítulos y ${result.headings.length} títulos.`,
      );
    } catch (issue) {
      setError(String(issue));
    } finally {
      setBusy("");
    }
  }

  async function applyPlan() {
    if (!plan || !digest) return;
    const confirmed = window.confirm(
      `Se reescribirán los capítulos del libro con ${plan.chapters.length} capítulos propuestos.\n\n` +
        "Se guardará una copia de seguridad para poder deshacer. ¿Aplicar?",
    );
    if (!confirmed) return;
    setBusy("apply");
    setError("");
    try {
      const report = await invoke<ApplyReport>("book_typeset_apply", {
        resourceId: digest.resourceId,
        plan,
      });
      setBackupPath(report.backupPath);
      setPlan(null);
      setDigest(null);
      setMessage(`Estructura aplicada: ${report.chapters} capítulos.`);
      onApplied();
    } catch (issue) {
      setError(String(issue));
    } finally {
      setBusy("");
    }
  }

  async function undo() {
    if (!backupPath) return;
    setBusy("undo");
    setError("");
    try {
      const chapters = await invoke<number>("book_typeset_undo", {
        backupPath,
      });
      setBackupPath("");
      setMessage(`Cambios deshechos: ${chapters} capítulos restaurados.`);
      onApplied();
    } catch (issue) {
      setError(String(issue));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="ai-overlay" ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="ai-title">
      <header className="ai-toolbar">
        <div className="ai-brand">
          <span className="ai-emblem">
            <ModuleEmblem id="typeset" size={22} />
          </span>
          <div>
            <span className="eyebrow">Maquetado asistido</span>
            <h1 id="ai-title">Maquetado con IA</h1>
            <p>
              La IA propone capítulos y jerarquía; la aplicación la aplica de forma determinista.
            </p>
          </div>
        </div>
        <div className="ai-toolbar-actions">
          <span className="ai-cost">
            {digest ? `~${digest.estimatedTokens.toLocaleString("es")} tokens` : "Coste por análisis"}
          </span>
          <button type="button" className="ai-close" onClick={onClose} aria-label="Cerrar maquetado IA">
            ✕
          </button>
        </div>
      </header>

      <div className="ai-body">
        <aside className="ai-books" aria-label="Libros para maquetar">
          <div className="ai-books-head">
            <span className="eyebrow">Biblioteca</span>
            <h2>Libros</h2>
            <p>{books.length} títulos importados.</p>
          </div>
          <input
            className="ai-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar libro…"
            aria-label="Buscar libro"
          />
          <ul className="ai-book-list">
            {visibleBooks.map((book) => (
              <li key={book.id}>
                <button
                  type="button"
                  className={`ai-book${book.id === selectedId ? " active" : ""}`}
                  onClick={() => resetForBook(book.id)}
                >
                  <span>{book.title}</span>
                </button>
              </li>
            ))}
            {visibleBooks.length === 0 && <li className="ai-empty-list">Sin coincidencias.</li>}
          </ul>
        </aside>

        <main className="ai-work">
          <div className="ai-work-head">
            <div>
              <span className="eyebrow">Espacio de trabajo</span>
              <h2>{selectedBook?.title ?? "Selecciona un libro"}</h2>
              <p>
                El análisis no reescribe el texto: solo decide dónde empieza cada capítulo y qué
                nivel tiene cada título.
              </p>
            </div>
            <div className="ai-actions">
              <button
                type="button"
                className="ai-secondary"
                onClick={() => void runDigest()}
                disabled={!selectedId || busy !== ""}
              >
                {busy === "digest" ? "Analizando…" : "1 · Preparar mapa"}
              </button>
              <button
                type="button"
                className="ai-secondary"
                onClick={() => void runAnalysis()}
                disabled={!digest || busy !== "" || digest.candidates.length < 3}
              >
                {busy === "analyze" ? "Consultando IA…" : "2 · Analizar con IA"}
              </button>
              <button
                type="button"
                className="ai-primary"
                onClick={() => void applyPlan()}
                disabled={!plan || busy !== ""}
              >
                {busy === "apply" ? "Aplicando…" : "3 · Aplicar estructura"}
              </button>
              {backupPath && (
                <button
                  type="button"
                  className="ai-secondary"
                  onClick={() => void undo()}
                  disabled={busy !== ""}
                >
                  {busy === "undo" ? "Restaurando…" : "Deshacer"}
                </button>
              )}
            </div>
          </div>

          {error && <div className="ai-alert error">{error}</div>}
          {message && <div className="ai-alert ok">{message}</div>}

          <div className="ai-grid">
            <section className="ai-panel">
              <header>
                <h3>Mapa del libro</h3>
                <span>
                  {digest ? `${digest.blockCount} bloques` : "Pendiente"}
                </span>
              </header>
              {digest ? (
                <ul className="ai-blocks">
                  {digest.candidates.slice(0, 40).map((candidate) => (
                    <li key={candidate.index}>
                      <span className="ai-index">{candidate.index}</span>
                      <span className="ai-tag">{candidate.tag}</span>
                      <span className="ai-text">{candidate.text || "…"}</span>
                    </li>
                  ))}
                  {digest.candidates.length > 40 && (
                    <li className="ai-more">+{digest.candidates.length - 40} candidatos más…</li>
                  )}
                </ul>
              ) : (
                <p className="ai-hint">
                  Pulsa «Preparar mapa» para extraer los bloques y los títulos candidatos.
                </p>
              )}
            </section>

            <section className="ai-panel">
              <header>
                <h3>Propuesta de la IA</h3>
                <span>{plan ? `${plan.chapters.length} capítulos` : "Sin propuesta"}</span>
              </header>
              {plan ? (
                <ol className="ai-plan">
                  {plan.chapters.map((chapter, index) => (
                    <li key={`${chapter.block}-${index}`}>
                      <span className="ai-index">{chapter.block}</span>
                      <span className="ai-text">{chapter.title || "Sin título"}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="ai-hint">
                  La propuesta aparecerá aquí antes de tocar el libro. Podrás revisarla y aplicar o
                  descartar.
                </p>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
