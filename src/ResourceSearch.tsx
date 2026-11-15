import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./ResourceSearch.css";

export interface ResourceMatch {
  kind: string;
  title: string;
  snippet: string;
  book?: number | null;
  chapter?: number | null;
  verse?: number | null;
  spine?: number | null;
  occurrences: number;
}

interface ResourceSearchProps {
  resourceId: string;
  resourceTitle: string;
  scopeLabel: string;
  onClose: () => void;
  onSelect: (match: ResourceMatch, query: string) => void;
}

export default function ResourceSearch({
  resourceId,
  resourceTitle,
  scopeLabel,
  onClose,
  onSelect,
}: ResourceSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResourceMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched("");
      setError("");
      return;
    }
    const timer = window.setTimeout(() => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      setLoading(true);
      setError("");
      invoke<ResourceMatch[]>("search_in_resource", {
        resourceId,
        query: trimmed,
        limit: 150,
      })
        .then((matches) => {
          if (requestRef.current !== requestId) return;
          setResults(matches);
          setSearched(trimmed);
        })
        .catch((issue) => {
          if (requestRef.current !== requestId) return;
          setError(String(issue));
          setResults([]);
        })
        .finally(() => {
          if (requestRef.current === requestId) setLoading(false);
        });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, resourceId]);

  const totalOccurrences = results.reduce((sum, item) => sum + item.occurrences, 0);

  return (
    <aside className="rsearch-panel" aria-label={`Buscar en ${resourceTitle}`}>
      <header className="rsearch-head">
        <div>
          <span className="eyebrow">{scopeLabel}</span>
          <h2>Buscar en este {scopeLabel === "Biblia" ? "Biblia" : "libro"}</h2>
          <p title={resourceTitle}>{resourceTitle}</p>
        </div>
        <button type="button" className="rsearch-close" onClick={onClose} aria-label="Cerrar búsqueda">
          ✕
        </button>
      </header>

      <div className="rsearch-input">
        <span aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Palabra o frase…"
          aria-label="Texto a buscar en este recurso"
          spellCheck={false}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Borrar búsqueda">
            ×
          </button>
        )}
      </div>

      <div className="rsearch-meta">
        {loading
          ? "Buscando…"
          : searched
            ? `${results.length} ${results.length === 1 ? "resultado" : "resultados"} · ${totalOccurrences} coincidencias`
            : "Escribe al menos dos letras. No distingue mayúsculas ni acentos."}
      </div>

      {error && <div className="rsearch-error">{error}</div>}

      <div className="rsearch-results">
        {results.map((match, index) => (
          <button
            type="button"
            key={`${match.kind}-${match.title}-${index}`}
            className="rsearch-hit"
            onClick={() => onSelect(match, searched)}
          >
            <span className="rsearch-hit-head">
              <strong>{match.title}</strong>
              {match.occurrences > 1 && <em>{match.occurrences}×</em>}
            </span>
            <span className="rsearch-snippet">{match.snippet}</span>
          </button>
        ))}
        {!loading && searched && results.length === 0 && !error && (
          <p className="rsearch-empty">Sin coincidencias en este recurso.</p>
        )}
      </div>
    </aside>
  );
}
