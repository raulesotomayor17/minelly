import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StrongEntry, WordOccurrence, WordStudyCount, WordStudyResult } from "./wordStudy";
import { WORD_STUDY_SOURCE_LABELS } from "./wordStudy";

interface BookOption {
  number: number;
  name: string;
}

interface WordReference {
  book: number;
  chapter: number;
  verse: number;
}

interface WordStudyPanelProps {
  strong?: string;
  query?: string;
  reference?: WordReference | null;
  books: BookOption[];
  onClose: () => void;
  onOpenDictionary: (strong: string) => void;
  onOpenReference: (book: number, chapter: number, verse: number) => void;
  onAskAssistant: (question: string) => void;
}

export default function WordStudyPanel({
  strong = "",
  query = "",
  reference = null,
  books,
  onClose,
  onOpenDictionary,
  onOpenReference,
  onAskAssistant,
}: WordStudyPanelProps) {
  const [search, setSearch] = useState(strong || query);
  const [result, setResult] = useState<WordStudyResult | null>(null);
  const [matches, setMatches] = useState<StrongEntry[]>([]);
  const [referenceTokens, setReferenceTokens] = useState<WordOccurrence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSearch(strong || query);
  }, [strong, query]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setResult(null);
      setMatches([]);
      try {
        if (strong.trim()) {
          const data = await invoke<WordStudyResult>("word_study", {
            strong: strong.trim(),
            limit: 120,
          });
          if (!cancelled) setResult(data);
        } else if (query.trim()) {
          const found = await invoke<StrongEntry[]>("word_study_search", {
            query: query.trim(),
            limit: 30,
          });
          if (!cancelled) setMatches(found);
        }
      } catch (issue) {
        if (!cancelled) setError(String(issue));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [strong, query]);

  useEffect(() => {
    let cancelled = false;
    if (!reference) {
      setReferenceTokens([]);
      return;
    }
    void invoke<WordOccurrence[]>("word_study_reference", {
      book: reference.book,
      chapter: reference.chapter,
      verse: reference.verse,
    })
      .then((tokens) => {
        if (!cancelled) setReferenceTokens(tokens);
      })
      .catch(() => {
        if (!cancelled) setReferenceTokens([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reference]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof result extends null ? never : NonNullable<typeof result>["occurrences"]>();
    if (!result) return [];
    for (const occurrence of result.occurrences) {
      const key = occurrence.source;
      const list = map.get(key) ?? [];
      list.push(occurrence);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [result]);

  async function runSearch() {
    const term = search.trim();
    if (!term) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const found = await invoke<StrongEntry[]>("word_study_search", {
        query: term,
        limit: 30,
      });
      setMatches(found);
    } catch (issue) {
      setError(String(issue));
    } finally {
      setLoading(false);
    }
  }

  async function selectStrong(id: string) {
    setLoading(true);
    setError("");
    try {
      const data = await invoke<WordStudyResult>("word_study", {
        strong: id,
        limit: 120,
      });
      setResult(data);
      setMatches([]);
      setSearch(id);
    } catch (issue) {
      setError(String(issue));
    } finally {
      setLoading(false);
    }
  }

  function bookName(number: number) {
    return books.find((book) => book.number === number)?.name ?? `Libro ${number}`;
  }

  function copyEntry() {
    if (!result?.entry) return;
    const entry = result.entry;
    void navigator.clipboard.writeText(
      `${entry.id} ${entry.lemma} (${entry.transliteration})\n${entry.definition}`,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="word-study-backdrop" role="dialog" aria-modal="true" aria-labelledby="word-study-title">
      <section className="word-study-panel">
        <header className="word-study-head">
          <div>
            <span className="eyebrow">Estudio de palabra</span>
            <h2 id="word-study-title">Diccionario y ocurrencias</h2>
          </div>
          <button type="button" className="word-study-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <form
          className="word-study-search"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Strong, lema, transliteración o definición…"
            autoFocus
          />
          <button type="submit" className="primary-button">Buscar</button>
        </form>

        {loading && <p className="word-study-muted">Consultando la biblioteca…</p>}
        {error && <div className="word-study-error">{error}</div>}

        {!result && matches.length > 0 && (
          <div className="word-study-matches">
            {matches.map((entry) => (
              <button key={entry.id} type="button" onClick={() => void selectStrong(entry.id)}>
                <strong>{entry.id}</strong>
                <span lang={entry.language === "greek" ? "grc" : "he"}>{entry.lemma}</span>
                <small>{entry.transliteration} · {entry.definition.slice(0, 90)}</small>
              </button>
            ))}
          </div>
        )}

        {result?.entry && (
          <>
            <div className="word-study-entry">
              <div className="word-study-entry-title">
                <span className={`word-study-lang ${result.entry.language}`}>
                  {result.entry.language === "greek" ? "GRIEGO" : "HEBREO"}
                </span>
                <strong>{result.entry.id}</strong>
                <span className="word-study-lemma" lang={result.entry.language === "greek" ? "grc" : "he"}>
                  {result.entry.lemma}
                </span>
                <em>{result.entry.transliteration}</em>
              </div>
              {result.entry.pronunciation && (
                <p className="word-study-pron">Pronunciación: {result.entry.pronunciation}</p>
              )}
              <div
                className="word-study-definition"
                dangerouslySetInnerHTML={{ __html: result.entry.html }}
              />
              <small className="word-study-source">{result.entry.source}</small>
            </div>

            <div className="word-study-actions">
              <button type="button" className="secondary-button" onClick={() => onOpenDictionary(result.entry!.id)}>
                Abrir en diccionario
              </button>
              <button type="button" className="secondary-button" onClick={copyEntry}>
                {copied ? "Copiado" : "Copiar"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  onAskAssistant(
                    `Explícame el uso de ${result.entry!.id} (${result.entry!.lemma}, ${result.entry!.transliteration}) en la Biblia y cómo se traduce en las versiones de mi biblioteca.`,
                  )
                }
              >
                Preguntar al Asistente
              </button>
            </div>

            <div className="word-study-counts">
              {(result.counts as WordStudyCount[]).map((count) => (
                <span key={count.source}>
                  <strong>{count.count.toLocaleString("es")}</strong>
                  {WORD_STUDY_SOURCE_LABELS[count.source] ?? count.source}
                </span>
              ))}
              {result.counts.length === 0 && (
                <span className="word-study-muted">Sin ocurrencias indexadas para este Strong.</span>
              )}
            </div>

            {result.lexicons.length > 0 && (
              <div className="word-study-lexicons">
                <h3>Léxicos en español</h3>
                {result.lexicons.map((lexicon) => (
                  <details key={lexicon.resourceId}>
                    <summary>{lexicon.resourceTitle}</summary>
                    <div
                      className="word-study-lexicon-body"
                      dangerouslySetInnerHTML={{ __html: lexicon.html }}
                    />
                  </details>
                ))}
              </div>
            )}

            <div className="word-study-occurrences">
              {grouped.map(([source, occurrences]) => (
                <section key={source}>
                  <h3>{WORD_STUDY_SOURCE_LABELS[source] ?? source}</h3>
                  {occurrences.map((occurrence) => (
                    <button
                      key={`${source}-${occurrence.book}-${occurrence.chapter}-${occurrence.verse}-${occurrence.wordOrder}`}
                      type="button"
                      onClick={() => onOpenReference(occurrence.book, occurrence.chapter, occurrence.verse)}
                      title="Abrir esta referencia en la Biblia preferida"
                    >
                      <span>{bookName(occurrence.book)} {occurrence.chapter}:{occurrence.verse}</span>
                      <strong lang={occurrence.source === "bhs" ? "he" : "grc"}>{occurrence.word}</strong>
                      <small>{occurrence.lemma} · {occurrence.morphology}</small>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </>
        )}

        {!result && referenceTokens.length > 0 && (
          <div className="word-study-reference-words">
            <h3>
              Palabras originales de{" "}
              {reference
                ? `${bookName(reference.book)} ${reference.chapter}:${reference.verse}`
                : ""}
            </h3>
            <p>Selecciona una palabra para abrir su ficha Strong.</p>
            <div>
              {referenceTokens.map((token, index) => (
                <button
                  key={`${token.source}-${token.wordOrder}-${index}`}
                  type="button"
                  disabled={!token.strongNumber}
                  onClick={() => void selectStrong(token.strongNumber)}
                  title={
                    token.strongNumber
                      ? `${token.strongNumber} · ${token.morphology}`
                      : "Sin número Strong"
                  }
                >
                  <strong lang={token.source === "bhs" ? "he" : "grc"}>
                    {token.word}
                  </strong>
                  <span>{token.strongNumber || "—"}</span>
                  <small>{token.lemma || token.transliteration}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && !error && !result && matches.length === 0 && (
          <p className="word-study-muted">
            Busca un número Strong (por ejemplo G26 o H430), un lema o una transliteración.
          </p>
        )}
      </section>
    </div>
  );
}
