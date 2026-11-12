import { useState } from "react";
import RibbonIcon from "./RibbonIcon";

export interface BookmarkEntry {
  id: string;
  resourceId: string;
  spine: number;
  label: string;
  createdAt: number;
  snippet?: string;
  note?: string;
  color?: string;
  isPrimaryRibbon?: boolean;
}

export interface JumpEntry {
  id: string;
  label: string;
  resourceId: string;
  spine: number;
  visitedAt: number;
}

interface Props {
  ribbon: BookmarkEntry | null;
  bookmarks: BookmarkEntry[];
  history: JumpEntry[];
  currentLabel: string;
  progress: number;
  onClose: () => void;
  onGoRibbon: () => void;
  onPlaceRibbon: () => void;
  onRemoveRibbon: () => void;
  onSaveBookmark: (label: string, note: string, color: string) => void;
  onGoBookmark: (bookmark: BookmarkEntry) => void;
  onDeleteBookmark: (id: string) => void;
  onBack: (entry: JumpEntry) => void;
  onComplete: () => void;
}

export default function BookmarksDrawer({
  ribbon, bookmarks, history, currentLabel, progress,
  onClose, onGoRibbon, onPlaceRibbon, onRemoveRibbon,
  onSaveBookmark, onGoBookmark, onDeleteBookmark, onBack, onComplete,
}: Props) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [color, setColor] = useState("#d97706");
  return (
    <aside className="bookmarks-drawer" role="dialog" aria-label="Bitácora de marcadores y saltos">
      <header>
        <div>
          <span className="eyebrow">Bitácora de lectura</span>
          <h2>Marcadores y saltos</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar">×</button>
      </header>

      <section className="bookmarks-section">
        <h3><RibbonIcon size={15} color="#d97706" /> Separador principal</h3>
        {ribbon ? (
          <div className="bookmark-ribbon-card">
            <strong>{ribbon.label}</strong>
            <small>{new Date(ribbon.createdAt * 1000).toLocaleString("es-MX")}</small>
            <div className="bookmark-progress"><span style={{ width: `${progress}%` }} /></div>
            <small>{Math.round(progress)}% completado · {currentLabel}</small>
            <div className="bookmark-actions">
              <button type="button" onClick={onGoRibbon}>Ir al punto de lectura</button>
              <button type="button" onClick={onPlaceRibbon}>Mover separador aquí</button>
              <button type="button" onClick={onRemoveRibbon}>Quitar separador</button>
              <button type="button" onClick={onComplete}>✓ Capítulo completado</button>
            </div>
          </div>
        ) : (
          <div className="bookmark-ribbon-card empty">
            <p>Sin separador principal.</p>
            <button type="button" onClick={onPlaceRibbon}>Colocar separador aquí</button>
          </div>
        )}
      </section>

      <section className="bookmarks-section">
        <h3>Marcadores guardados</h3>
        <div className="bookmark-save-row">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Título o motivo…" />
          <button type="button" onClick={() => { onSaveBookmark(draft, note, color); setDraft(""); setNote(""); }}>+ Guardar marcador</button>
        </div>
        <div className="bookmark-save-row">
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Nota del marcador…" />
          <select value={color} onChange={(event) => setColor(event.target.value)} aria-label="Color del listón">
            <option value="#d97706">Ámbar</option>
            <option value="#2563eb">Azul</option>
            <option value="#10b981">Esmeralda</option>
            <option value="#dc2626">Carmesí</option>
            <option value="#8b5cf6">Violeta</option>
          </select>
        </div>
        <div className="bookmark-list">
          {bookmarks.filter((item) => !item.isPrimaryRibbon).map((bookmark) => (
            <div className="bookmark-row" key={bookmark.id}>
              <RibbonIcon size={14} color="#d97706" />
              <button type="button" onClick={() => onGoBookmark(bookmark)}>
                <strong>{bookmark.label}</strong>
                <small>{bookmark.snippet || new Date(bookmark.createdAt * 1000).toLocaleDateString("es-MX")}</small>
              </button>
              <button type="button" className="bookmark-delete" onClick={() => onDeleteBookmark(bookmark.id)} aria-label="Eliminar marcador">×</button>
            </div>
          ))}
          {bookmarks.filter((item) => !item.isPrimaryRibbon).length === 0 && <p className="empty-hint">No hay marcadores secundarios.</p>}
        </div>
      </section>

      <section className="bookmarks-section">
        <h3>Recientes / Saltos</h3>
        <div className="bookmark-list">
          {history.slice(0, 8).map((entry) => (
            <div className="bookmark-row" key={entry.id}>
              <button type="button" onClick={() => onBack(entry)}>
                <strong>↩ Regresar a {entry.label}</strong>
                <small>{new Date(entry.visitedAt * 1000).toLocaleString("es-MX")}</small>
              </button>
            </div>
          ))}
          {history.length === 0 && <p className="empty-hint">Aún no hay saltos registrados.</p>}
        </div>
      </section>
    </aside>
  );
}
