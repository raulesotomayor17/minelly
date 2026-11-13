import { useEffect, useRef, useState } from "react";

interface BibleOption { id: string; title: string; abbreviation: string; language?: string; verseCount?: number }

export default function BibleVersionPicker({ bibles, value, onChange }: { bibles: BibleOption[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = bibles.find((bible) => bible.id === value) ?? bibles[0];
  const filtered = bibles.filter((bible) => !query || `${bible.title} ${bible.abbreviation} ${bible.language ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [open]);

  return (
    <div className="bible-version-picker" ref={rootRef}>
      <button type="button" className="bible-version-trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-haspopup="listbox" title={selected?.title ?? "Versión de la Biblia"}>
        <span className="bible-version-icon" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 4.5A2.5 2.5 0 0 1 8.5 2H20v18H8.5A2.5 2.5 0 0 0 6 22.5zM12 6v9M9.5 8.5h5M9.5 12h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span className="bible-version-copy">
          <strong>{selected?.abbreviation || selected?.title || "Biblia"}</strong>
          <small>{selected?.title || "Selecciona una versión"}</small>
        </span>
        <span className={`bible-version-chevron${open ? " open" : ""}`} aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="bible-version-menu" role="listbox" aria-label="Versiones de la Biblia">
          <div className="bible-version-menu-head">
            <span>Biblioteca de versiones</span>
            <small>{bibles.length}</small>
          </div>
          <input autoFocus className="bible-version-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar versión o idioma…" aria-label="Buscar versión" />
          <div className="bible-version-list">
            {filtered.map((bible) => (
              <button key={bible.id} type="button" role="option" aria-selected={bible.id === value} className={`bible-version-option${bible.id === value ? " active" : ""}`} onClick={() => { onChange(bible.id); setOpen(false); setQuery(""); }}>
                <span className="bible-version-icon small" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 4.5A2.5 2.5 0 0 1 8.5 2H20v18H8.5A2.5 2.5 0 0 0 6 22.5z" stroke="currentColor" strokeWidth="1.6" /></svg>
                </span>
                <span><strong>{bible.title}</strong><small>{bible.abbreviation || "Biblia"}{bible.language ? ` · ${bible.language}` : ""}{bible.verseCount ? ` · ${bible.verseCount.toLocaleString("es")} versículos` : ""}</small></span>
                {bible.id === value && <span className="bible-version-check">✓</span>}
              </button>
            ))}
            {filtered.length === 0 && <p className="bible-version-empty">Sin versiones coincidentes.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
