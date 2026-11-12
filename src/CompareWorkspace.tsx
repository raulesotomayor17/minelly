import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import SelectMenu from "./SelectMenu";
import { PaperModePicker } from "./CustomizationModal";

type DiffType = "unchanged" | "deleted" | "added";

interface DiffToken {
  type: DiffType;
  text: string;
}

interface CompareCell {
  resourceId: string;
  version: string;
  isBase: boolean;
  diffPercentage: number;
  text: string;
  tokens: DiffToken[];
}

interface CompareRow {
  verseNumber: number;
  columns: CompareCell[];
}

interface BibleResource {
  id: string;
  title: string;
  abbreviation: string;
}

interface BookItem {
  number: number;
  name: string;
}

interface VerseData {
  verse: number;
  html: string;
}

interface PassageData {
  book: { name: string };
  chapter: number;
  verses: VerseData[];
}

interface CompareWorkspaceProps {
  bibles: BibleResource[];
  books: BookItem[];
  initialBook: number;
  initialChapter: number;
  initialVerse?: number;
  onClose: () => void;
  onOpenCustomization?: () => void;
}

function textFromHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  return (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

function normalized(token: string): string {
  return token
    .trim()
    .toLocaleLowerCase("es")
    .replace(/[.,;:!?¡¿"'«»“”‘’()\[\]]/g, "");
}

function diffTokens(baseText: string, otherText: string): {
  tokens: DiffToken[];
  percentage: number;
} {
  const base = tokenize(baseText);
  const other = tokenize(otherText);
  if (other.length === 0) {
    return {
      tokens: base.map((text) => ({ type: "deleted", text })),
      percentage: base.length > 0 ? 100 : 0,
    };
  }
  if (base.length === 0) {
    return {
      tokens: other.map((text) => ({ type: "added", text })),
      percentage: other.length > 0 ? 100 : 0,
    };
  }

  const rows = base.length + 1;
  const cols = other.length + 1;
  const lcs = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = base.length - 1; i >= 0; i -= 1) {
    for (let j = other.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        normalized(base[i]) === normalized(other[j])
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let deleted = 0;
  let added = 0;
  let i = 0;
  let j = 0;
  while (i < base.length && j < other.length) {
    if (normalized(base[i]) === normalized(other[j])) {
      tokens.push({ type: "unchanged", text: base[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      tokens.push({ type: "deleted", text: base[i] });
      deleted += 1;
      i += 1;
    } else {
      tokens.push({ type: "added", text: other[j] });
      added += 1;
      j += 1;
    }
  }
  while (i < base.length) {
    tokens.push({ type: "deleted", text: base[i] });
    deleted += 1;
    i += 1;
  }
  while (j < other.length) {
    tokens.push({ type: "added", text: other[j] });
    added += 1;
    j += 1;
  }
  const total = base.length + other.length;
  const edits = total - 2 * lcs[0][0];
  const percentage = Math.min(
    100,
    Math.round((edits / Math.max(total, 1)) * 100),
  );
  void deleted;
  void added;
  return { tokens, percentage };
}

export default function CompareWorkspace({
  bibles,
  books,
  initialBook,
  initialChapter,
  initialVerse = 0,
  onClose,
  onOpenCustomization,
}: CompareWorkspaceProps) {
  const [book, setBook] = useState(initialBook);
  const [chapter, setChapter] = useState(initialChapter);
  const [startVerse, setStartVerse] = useState(
    initialVerse > 0 ? initialVerse : 0,
  );
  const [compareScale, setCompareScale] = useState<number>(() => {
    const saved = Number(localStorage.getItem("teoamoxtli.compare.scale"));
    return saved >= 0.85 && saved <= 1.7 ? saved : 1;
  });

  function adjustCompareScale(delta: number) {
    setCompareScale((prev) => {
      const next = Math.min(1.7, Math.max(0.85, Number((prev + delta).toFixed(2))));
      localStorage.setItem("teoamoxtli.compare.scale", String(next));
      return next;
    });
  }
  const [columns, setColumns] = useState<string[]>(() =>
    bibles.slice(0, Math.min(5, bibles.length)).map((item) => item.id),
  );
  const [passages, setPassages] = useState<Record<string, PassageData>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeVerse, setActiveVerse] = useState(0);
  const [showDiff, setShowDiff] = useState(
    () => localStorage.getItem("teoamoxtli.compare-diff") !== "false",
  );
  const [showPercentages, setShowPercentages] = useState(
    () => localStorage.getItem("teoamoxtli.compare-percentages") !== "false",
  );

  useEffect(() => {
    localStorage.setItem("teoamoxtli.compare-diff", String(showDiff));
    localStorage.setItem(
      "teoamoxtli.compare-percentages",
      String(showPercentages),
    );
  }, [showDiff, showPercentages]);

  const baseId = columns[0];
  const base = bibles.find((item) => item.id === baseId);
  const available = bibles.filter((item) => !columns.includes(item.id));

  useEffect(() => {
    let cancelled = false;
    if (columns.length === 0) return;
    setLoading(true);
    setError("");
    Promise.all(
      columns.map(async (resourceId) => {
        const passage = await invoke<PassageData>("get_passage", {
          resourceId,
          book,
          chapter,
        });
        return [resourceId, passage] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        setPassages(Object.fromEntries(entries));
      })
      .catch((value) => {
        if (!cancelled) setError(String(value));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [book, chapter, columns]);

  const verseOptions = useMemo(() => {
    const basePassage = passages[baseId];
    return [
      { value: "0", label: "Todos" },
      ...(basePassage?.verses ?? []).map((verse) => ({
        value: String(verse.verse),
        label: `Versículo ${verse.verse}`,
      })),
    ];
  }, [baseId, passages]);

  useEffect(() => {
    const basePassage = passages[baseId];
    if (!basePassage || startVerse === 0) return;
    if (!basePassage.verses.some((verse) => verse.verse === startVerse)) {
      setStartVerse(0);
    }
  }, [baseId, passages, startVerse]);

  const rows = useMemo<CompareRow[]>(() => {
    const basePassage = passages[baseId];
    if (!basePassage) return [];
    return basePassage.verses
      .filter((baseVerse) => startVerse === 0 || baseVerse.verse >= startVerse)
      .map((baseVerse) => {
      const baseText = textFromHtml(baseVerse.html);
      return {
        verseNumber: baseVerse.verse,
        columns: columns.map((resourceId, index) => {
          const resource = bibles.find((item) => item.id === resourceId);
          const passage = passages[resourceId];
          const verse = passage?.verses.find(
            (item) => item.verse === baseVerse.verse,
          );
          const text = verse ? textFromHtml(verse.html) : "";
          if (index === 0) {
            return {
              resourceId,
              version: resource?.abbreviation || resource?.title || "—",
              isBase: true,
              diffPercentage: 0,
              text,
              tokens: [{ type: "unchanged" as const, text }],
            };
          }
          const diff = diffTokens(baseText, text);
          return {
            resourceId,
            version: resource?.abbreviation || resource?.title || "—",
            isBase: false,
            diffPercentage: diff.percentage,
            text,
            tokens: diff.tokens,
          };
        }),
      };
    });
  }, [baseId, bibles, columns, passages, startVerse]);

  function setColumn(index: number, resourceId: string) {
    setColumns((current) => {
      const existingIndex = current.indexOf(resourceId);
      if (existingIndex !== -1 && existingIndex !== index) {
        const next = [...current];
        const previousAtTarget = next[index];
        next[index] = resourceId;
        next[existingIndex] = previousAtTarget;
        return next;
      }
      return current.map((item, position) => (position === index ? resourceId : item));
    });
  }

  function makeColumnBase(index: number) {
    if (index <= 0) return;
    setColumns((current) => {
      const target = current[index];
      if (!target) return current;
      const rest = current.filter((_, position) => position !== index);
      return [target, ...rest];
    });
  }

  function addColumn() {
    if (available.length === 0) return;
    setColumns((current) => [...current, available[0].id]);
  }

  function removeColumn(index: number) {
    if (columns.length <= 2) return;
    setColumns((current) => current.filter((_, position) => position !== index));
  }

  const gridStyle = {
    "--col-count": columns.length,
    "--col-width": columns.length > 4 ? "210px" : "minmax(0, 1fr)",
  } as CSSProperties;

  return (
    <div
      className="compare-overlay"
      style={{ "--compare-scale": compareScale } as CSSProperties}
    >
      <header className="compare-toolbar">
        <div className="compare-title">
          <span className="eyebrow">Estudio comparado</span>
          <h1>Comparador de versiones</h1>
          <p>
            {base?.title ?? "Biblia"} · {passages[baseId]?.book.name ?? ""}{" "}
            {chapter} · {columns.length} versiones
          </p>
        </div>

        <div className="compare-passage">
          <SelectMenu
            className="compare-book-select"
            value={String(book)}
            onChange={(value) => {
              setBook(Number(value));
              setChapter(1);
              setStartVerse(0);
            }}
            ariaLabel="Libro para comparar"
            options={books.map((item) => ({
              value: String(item.number),
              label: item.name,
            }))}
          />
          <input
            type="number"
            min={1}
            value={chapter}
            onChange={(event) => {
              setChapter(Math.max(1, Number(event.target.value) || 1));
              setStartVerse(0);
            }}
            aria-label="Capítulo para comparar"
          />
          <SelectMenu
            className="compare-verse-select"
            value={String(startVerse)}
            onChange={(value) => setStartVerse(Number(value))}
            ariaLabel="Versículo inicial para comparar"
            options={verseOptions}
          />
          <div className="compare-toggles">
            <button
              className={showDiff ? "compare-toggle active" : "compare-toggle"}
              onClick={() => setShowDiff((current) => !current)}
              aria-pressed={showDiff}
              title="Marcar palabras eliminadas y añadidas"
            >
              <span className="compare-toggle-box">{showDiff ? "✓" : ""}</span>
              Mostrar diferencias
            </button>
            <button
              className={showPercentages ? "compare-toggle active" : "compare-toggle"}
              onClick={() => setShowPercentages((current) => !current)}
              aria-pressed={showPercentages}
              title="Mostrar porcentaje de diferencia"
            >
              <span className="compare-toggle-box">{showPercentages ? "✓" : ""}</span>
              Mostrar %
            </button>
          </div>
          <div className="module-scale-group" title="Tamaño de letra en el Comparador">
            <span>Texto</span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => adjustCompareScale(-0.08)}
              title="Reducir tamaño de texto"
            >
              A−
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => adjustCompareScale(0.08)}
              title="Aumentar tamaño de texto"
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
          <button className="primary-button" onClick={addColumn} disabled={available.length === 0}>
            + Versión
          </button>
          <button className="secondary-button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </header>

      {error && <div className="compare-error">{error}</div>}

      <div className="compare-scroll">
        <div className="compare-header" style={gridStyle}>
          <div className="compare-gutter">Versículo</div>
          {columns.map((resourceId, index) => {
            const resource = bibles.find((item) => item.id === resourceId);
            return (
              <div className="compare-column-head" key={resourceId}>
                <div className="compare-column-top">
                  <SelectMenu
                    className="compare-version-select"
                    value={resourceId}
                    onChange={(value) => setColumn(index, value)}
                    ariaLabel={`Versión de la columna ${index + 1}`}
                    options={bibles.map((item) => ({
                      value: item.id,
                      label: item.abbreviation
                        ? `${item.abbreviation} · ${item.title}`
                        : item.title,
                    }))}
                  />
                  {index === 0 ? (
                    <span className="compare-base-badge" title="Versión base contra la que se calculan las diferencias">
                      ★ Base
                    </span>
                  ) : (
                    <div className="compare-col-actions">
                      <button
                        type="button"
                        className="compare-make-base-button"
                        onClick={() => makeColumnBase(index)}
                        title="Usar esta Biblia como versión Base de comparación"
                      >
                        ★ Hacer base
                      </button>
                      {columns.length > 2 && (
                        <button
                          type="button"
                          className="compare-remove-button"
                          onClick={() => removeColumn(index)}
                          title="Quitar versión"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <span className="compare-version-name">
                  {resource?.title ?? resourceId}
                </span>
              </div>
            );
          })}
        </div>

        {loading && rows.length === 0 ? (
          <div className="compare-empty">Cargando versiones…</div>
        ) : rows.length === 0 ? (
          <div className="compare-empty">No hay versículos para este pasaje.</div>
        ) : (
          <div className="compare-rows">
            {rows.map((row, rowIndex) => (
              <div
                className={`compare-row ${rowIndex % 2 ? "alternate" : ""}`}
                style={gridStyle}
                key={row.verseNumber}
                onClick={() => setActiveVerse(row.verseNumber)}
              >
                <div className="compare-verse-number">{row.verseNumber}</div>
                {row.columns.map((cell) => (
                  <div
                    className={`compare-cell ${cell.isBase ? "base" : ""} ${
                      activeVerse === row.verseNumber ? "active" : ""
                    }`}
                    key={`${cell.resourceId}-${row.verseNumber}`}
                  >
                    <div className="compare-verse-text">
                      {showDiff
                        ? cell.tokens.map((token, index) => (
                            <span
                              className={`diff-${token.type}`}
                              key={`${token.type}-${index}`}
                            >
                              {token.text}
                            </span>
                          ))
                        : cell.text}
                    </div>
                    {!cell.isBase && showPercentages && (
                      <span className="compare-diff-percentage">
                        {cell.diffPercentage}% de diferencia
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="compare-footer">
        <span>{rows.length} versículos comparados</span>
        <span>
          Scroll único · filas alineadas · diff contra{" "}
          {base?.abbreviation || base?.title || "la base"}
        </span>
      </footer>
    </div>
  );
}
