import { useEffect, useMemo, useState } from "react";
import SelectMenu from "./SelectMenu";
import {
  formatEpoch,
  formatSermonDate,
  joinList,
  splitList,
  type Sermon,
} from "./sermonTypes";
import { textOf } from "./sermonStore";

interface SermonManagerProps {
  sermons: Sermon[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSave: (sermon: Sermon) => void;
}

function toLocalInput(value: string): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function countWords(sermon: Sermon): number {
  const text = textOf(sermon.contentJson);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

export default function SermonManager({
  sermons,
  selectedId,
  busy,
  onSelect,
  onOpen,
  onNew,
  onDelete,
  onSave,
}: SermonManagerProps) {
  const [query, setQuery] = useState("");
  const [seriesFilter, setSeriesFilter] = useState("");
  const [venueFilter, setVenueFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [bookFilter, setBookFilter] = useState("");
  const [draft, setDraft] = useState<Sermon | null>(null);
  const [savedNotice, setSavedNotice] = useState("");

  const selected = sermons.find((sermon) => sermon.id === selectedId) ?? null;

  useEffect(() => {
    setDraft(selected ? { ...selected } : null);
    setSavedNotice("");
  }, [selected]);

  useEffect(() => {
    if (!selectedId && sermons.length > 0) {
      onSelect(sermons[0].id);
    }
  }, [selectedId, sermons, onSelect]);

  const seriesOptions = useMemo(
    () => [...new Set(sermons.map((sermon) => sermon.series).filter(Boolean))].sort(),
    [sermons],
  );
  const venueOptions = useMemo(
    () => [...new Set(sermons.map((sermon) => sermon.venue).filter(Boolean))].sort(),
    [sermons],
  );
  const serviceOptions = useMemo(
    () => [...new Set(sermons.map((sermon) => sermon.service).filter(Boolean))].sort(),
    [sermons],
  );
  const topicOptions = useMemo(
    () =>
      [...new Set(sermons.flatMap((sermon) => sermon.topics).filter(Boolean))].sort(),
    [sermons],
  );
  const bookOptions = useMemo(
    () =>
      [
        ...new Set(
          sermons
            .flatMap((sermon) => sermon.passages)
            .map((passage) => passage.replace(/\s+\d.*$/, "").trim())
            .filter(Boolean),
        ),
      ].sort(),
    [sermons],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sermons.filter((sermon) => {
      if (seriesFilter && sermon.series !== seriesFilter) return false;
      if (venueFilter && sermon.venue !== venueFilter) return false;
      if (serviceFilter && sermon.service !== serviceFilter) return false;
      if (topicFilter && !sermon.topics.includes(topicFilter)) return false;
      if (
        bookFilter &&
        !sermon.passages.some((passage) =>
          passage.toLowerCase().startsWith(bookFilter.toLowerCase()),
        )
      ) {
        return false;
      }
      if (!needle) return true;
      return [
        sermon.title,
        sermon.series,
        sermon.speaker,
        sermon.venue,
        sermon.service,
        sermon.audience,
        sermon.description,
        sermon.topics.join(" "),
        sermon.tags.join(" "),
        sermon.passages.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [sermons, seriesFilter, venueFilter, serviceFilter, topicFilter, bookFilter, query]);

  const activeFilters = [
    seriesFilter,
    venueFilter,
    serviceFilter,
    topicFilter,
    bookFilter,
    query,
  ].filter(Boolean).length;

  function update<K extends keyof Sermon>(key: K, value: Sermon[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setSavedNotice("");
  }

  function save() {
    if (!draft) return;
    onSave({ ...draft, updatedAt: Math.floor(Date.now() / 1000) });
    setSavedNotice("Metadatos guardados");
  }

  return (
    <section className="sermon-manager" aria-label="Administrador de sermones">
      <header className="sermon-manager-head">
        <div>
          <span className="eyebrow">Administrador</span>
          <h1>Sermones</h1>
          <p>
            {sermons.length} sermones · {filtered.length} visibles
            {activeFilters > 0 ? ` · ${activeFilters} filtros activos` : ""}
          </p>
        </div>
        <div className="sermon-manager-actions">
          <button type="button" className="primary-button" onClick={onNew} disabled={busy}>
            + Nuevo sermón
          </button>
          {selected && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => onOpen(selected.id)}
            >
              Abrir preparador
            </button>
          )}
        </div>
      </header>

      <div className="sermon-manager-body">
        <aside className="sermon-filters" aria-label="Filtros de sermones">
          <div className="sermon-filter-head">
            <strong>Filtros</strong>
            {activeFilters > 0 && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setSeriesFilter("");
                  setVenueFilter("");
                  setServiceFilter("");
                  setTopicFilter("");
                  setBookFilter("");
                  setQuery("");
                }}
              >
                Limpiar
              </button>
            )}
          </div>
          <label className="sermon-search">
            <span>Buscar</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Título, orador, tema…"
            />
          </label>
          <div className="sermon-filter-group">
            <span className="sermon-filter-label">Serie</span>
            <SelectMenu
              value={seriesFilter}
              onChange={setSeriesFilter}
              ariaLabel="Filtrar por serie"
              options={[
                { value: "", label: "Todas las series" },
                ...seriesOptions.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
          <div className="sermon-filter-group">
            <span className="sermon-filter-label">Lugar</span>
            <SelectMenu
              value={venueFilter}
              onChange={setVenueFilter}
              ariaLabel="Filtrar por lugar"
              options={[
                { value: "", label: "Todos los lugares" },
                ...venueOptions.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
          <div className="sermon-filter-group">
            <span className="sermon-filter-label">Servicio</span>
            <SelectMenu
              value={serviceFilter}
              onChange={setServiceFilter}
              ariaLabel="Filtrar por servicio"
              options={[
                { value: "", label: "Todos los servicios" },
                ...serviceOptions.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
          <div className="sermon-filter-group">
            <span className="sermon-filter-label">Tema</span>
            <SelectMenu
              value={topicFilter}
              onChange={setTopicFilter}
              ariaLabel="Filtrar por tema"
              options={[
                { value: "", label: "Todos los temas" },
                ...topicOptions.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
          <div className="sermon-filter-group">
            <span className="sermon-filter-label">Libro bíblico</span>
            <SelectMenu
              value={bookFilter}
              onChange={setBookFilter}
              ariaLabel="Filtrar por libro bíblico"
              options={[
                { value: "", label: "Todos los libros" },
                ...bookOptions.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
          <div className="sermon-filter-foot">
            <span>Doble clic en una fila para abrirla en el preparador.</span>
          </div>
        </aside>

        <div className="sermon-grid-wrap">
          <div className="sermon-grid-scroll">
            <table className="sermon-grid">
              <thead>
                <tr>
                  <th>Semana / Fecha</th>
                  <th>Lugar</th>
                  <th>Servicio</th>
                  <th>Título</th>
                  <th>Serie</th>
                  <th>Orador</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sermon) => (
                  <tr
                    key={sermon.id}
                    className={sermon.id === selectedId ? "selected" : ""}
                    onClick={() => onSelect(sermon.id)}
                    onDoubleClick={() => onOpen(sermon.id)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onOpen(sermon.id);
                    }}
                    title="Doble clic para abrir el preparador"
                  >
                    <td className="sermon-date-cell">
                      <strong>{formatSermonDate(sermon.dateTime)}</strong>
                      <small>{sermon.service || "Sin servicio"}</small>
                    </td>
                    <td>{sermon.venue || "—"}</td>
                    <td>{sermon.service || "—"}</td>
                    <td className="sermon-title-cell">
                      <strong>{sermon.title || "Sermón sin título"}</strong>
                      {sermon.tags.length > 0 && (
                        <span className="sermon-tag-row">
                          {sermon.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="sermon-tag">
                              {tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td>{sermon.series || "—"}</td>
                    <td>{sermon.speaker || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="sermon-empty">
                <strong>No hay sermones con estos filtros</strong>
                <span>
                  Crea un sermón nuevo o limpia los filtros para ver toda la colección.
                </span>
                <button type="button" className="primary-button" onClick={onNew}>
                  + Crear sermón
                </button>
              </div>
            )}
          </div>
          <footer className="sermon-grid-foot">
            <span>{filtered.length} resultados</span>
            <span>Ordenados por fecha, del más reciente al más antiguo</span>
          </footer>
        </div>

        <aside className="sermon-metadata" aria-label="Metadatos del sermón">
          {draft ? (
            <>
              <div className="sermon-metadata-head">
                <div>
                  <span className="eyebrow">Metadatos</span>
                  <h2>{draft.title || "Sermón sin título"}</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onOpen(draft.id)}
                  title="Abrir en el preparador"
                  aria-label="Abrir en el preparador"
                >
                  ⤢
                </button>
              </div>

              <div className="sermon-form">
                <label>
                  Título
                  <input
                    value={draft.title}
                    onChange={(event) => update("title", event.target.value)}
                  />
                </label>
                <div className="sermon-form-row">
                  <label>
                    Serie
                    <input
                      value={draft.series}
                      onChange={(event) => update("series", event.target.value)}
                    />
                  </label>
                  <label className="narrow">
                    N.º
                    <input
                      type="number"
                      min={0}
                      value={draft.seriesNumber ?? ""}
                      onChange={(event) =>
                        update(
                          "seriesNumber",
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                        )
                      }
                    />
                  </label>
                </div>
                <div className="sermon-form-row">
                  <label>
                    Orador
                    <input
                      value={draft.speaker}
                      onChange={(event) => update("speaker", event.target.value)}
                    />
                  </label>
                  <label>
                    Audiencia
                    <input
                      value={draft.audience}
                      onChange={(event) => update("audience", event.target.value)}
                    />
                  </label>
                </div>
                <div className="sermon-form-row">
                  <label>
                    Lugar
                    <input
                      value={draft.venue}
                      onChange={(event) => update("venue", event.target.value)}
                    />
                  </label>
                  <label>
                    Servicio
                    <input
                      value={draft.service}
                      onChange={(event) => update("service", event.target.value)}
                      placeholder="18:00"
                    />
                  </label>
                </div>
                <label>
                  Fecha y hora
                  <input
                    type="datetime-local"
                    value={toLocalInput(draft.dateTime)}
                    onChange={(event) => update("dateTime", event.target.value)}
                  />
                </label>
                <label>
                  Temas
                  <input
                    value={joinList(draft.topics)}
                    onChange={(event) => update("topics", splitList(event.target.value))}
                    placeholder="Gracia, fe, esperanza"
                  />
                </label>
                <label>
                  Pasajes bíblicos
                  <input
                    value={joinList(draft.passages)}
                    onChange={(event) =>
                      update("passages", splitList(event.target.value))
                    }
                    placeholder="Juan 3:16, Romanos 8:28"
                  />
                </label>
                <label>
                  Etiquetas
                  <input
                    value={joinList(draft.tags)}
                    onChange={(event) => update("tags", splitList(event.target.value))}
                    placeholder="Navidad, familia"
                  />
                </label>
                <label>
                  Descripción
                  <textarea
                    rows={4}
                    value={draft.description}
                    onChange={(event) => update("description", event.target.value)}
                    placeholder="Resumen del contenido del sermón…"
                  />
                </label>
              </div>

              <div className="sermon-metadata-stats">
                <div>
                  <strong>{countWords(draft).toLocaleString("es")}</strong>
                  <span>palabras</span>
                </div>
                <div>
                  <strong>{Math.max(1, Math.round(countWords(draft) / 130))}</strong>
                  <span>min de predicación</span>
                </div>
                <div>
                  <strong>{formatEpoch(draft.updatedAt)}</strong>
                  <span>última edición</span>
                </div>
              </div>

              <div className="sermon-metadata-actions">
                <button type="button" className="primary-button" onClick={save} disabled={busy}>
                  Guardar metadatos
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onOpen(draft.id)}
                >
                  Preparar sermón
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `¿Eliminar «${draft.title || "Sermón sin título"}»? Esta acción no se puede deshacer.`,
                      )
                    ) {
                      onDelete(draft.id);
                    }
                  }}
                >
                  Eliminar
                </button>
              </div>
              {savedNotice && <div className="sermon-saved-notice">{savedNotice}</div>}
            </>
          ) : (
            <div className="sermon-metadata-empty">
              <strong>Selecciona un sermón</strong>
              <span>Aquí podrás editar serie, lugar, servicio, temas y pasajes.</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
