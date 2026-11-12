import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PixabayImage, PixabaySearchResult } from "./sermonTypes";

const KEY_STORAGE = "teoamoxtli.pixabay.api-key";

interface PixabayPickerProps {
  open: boolean;
  title?: string;
  defaultQuery?: string;
  onClose: () => void;
  onSelect: (image: PixabayImage) => void;
}

export default function PixabayPicker({
  open,
  title = "Buscar imagen en Pixabay",
  defaultQuery = "",
  onClose,
  onSelect,
}: PixabayPickerProps) {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(KEY_STORAGE) ?? "",
  );
  const [query, setQuery] = useState(defaultQuery);
  const [images, setImages] = useState<PixabayImage[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery(defaultQuery);
    setPage(1);
    setError("");
  }, [open, defaultQuery]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function chooseLocalImage() {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "Elegir imagen local",
        filters: [
          {
            name: "Imágenes",
            extensions: ["png", "jpg", "jpeg", "webp", "gif"],
          },
        ],
      });
      if (typeof selected !== "string") return;
      const dataUrl = await invoke<string>("read_image_data_url", {
        path: selected,
      });
      onSelect({
        id: 0,
        previewUrl: dataUrl,
        webformatUrl: dataUrl,
        largeImageUrl: dataUrl,
        tags: "Imagen local",
        user: "Archivo local",
        pageUrl: "",
      });
    } catch (issue) {
      setError(String(issue));
    }
  }

  async function search(nextPage = 1) {
    if (!apiKey.trim()) {
      setError("Escribe tu clave de API de Pixabay para buscar imágenes.");
      setShowKey(true);
      return;
    }
    if (!query.trim()) {
      setError("Escribe qué imagen quieres buscar.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      localStorage.setItem(KEY_STORAGE, apiKey.trim());
      const result = await invoke<PixabaySearchResult>("pixabay_search", {
        apiKey: apiKey.trim(),
        query: query.trim(),
        page: nextPage,
        perPage: 24,
      });
      setImages(result.images);
      setTotal(result.totalHits || result.total);
      setPage(nextPage);
    } catch (issue) {
      setError(String(issue));
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="pixabay-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="pixabay-panel">
        <header className="pixabay-header">
          <div>
            <span className="eyebrow">Pixabay</span>
            <h2>{title}</h2>
            <p>Fotos gratuitas para ilustraciones, diapositivas y hojas informativas.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className="pixabay-controls">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search(1);
            }}
            placeholder="Ej. viña, camino, Jerusalén, luz…"
            aria-label="Buscar imágenes"
          />
          <button type="button" className="primary-button" onClick={() => void search(1)}>
            {loading ? "Buscando…" : "Buscar"}
          </button>
          <button type="button" className="secondary-button" onClick={() => setShowKey((value) => !value)}>
            {showKey ? "Ocultar clave" : "Clave API"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void chooseLocalImage()}
            title="Usar una imagen de tu equipo, sin clave ni conexión"
          >
            Imagen local
          </button>
        </div>

        {showKey && (
          <div className="pixabay-key-row">
            <label>
              Clave de API de Pixabay
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                onBlur={() => {
                  if (apiKey.trim()) localStorage.setItem(KEY_STORAGE, apiKey.trim());
                }}
                placeholder="12345678-abcdef…"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                void openUrl("https://pixabay.com/api/docs/").catch(
                  () => undefined,
                );
              }}
            >
              Obtener una clave gratuita ↗
            </button>
            <small>
              La clave se guarda solo en este equipo y no se incluye en el sermón.
            </small>
          </div>
        )}

        {error && <div className="pixabay-error">{error}</div>}
        <div className="pixabay-local-hint">
          También puedes usar una imagen local sin clave ni conexión.
        </div>

        <div className="pixabay-results">
          {images.length === 0 && !loading && !error && (
            <div className="pixabay-empty">
              <strong>Busca una imagen para empezar</strong>
              <span>Puedes usar la misma foto como ilustración o como fondo de diapositiva.</span>
            </div>
          )}
          {images.map((image) => (
            <button
              type="button"
              key={image.id}
              className="pixabay-card"
              onClick={() => onSelect(image)}
              title={`Usar imagen de ${image.user}`}
            >
              <img src={image.previewUrl} alt={image.tags} loading="lazy" />
              <span className="pixabay-card-meta">
                <strong>{image.tags.split(",").slice(0, 3).join(", ")}</strong>
                <small>© {image.user}</small>
              </span>
            </button>
          ))}
        </div>

        <footer className="pixabay-footer">
          <span>{total.toLocaleString("es")} resultados</span>
          <div>
            <button
              type="button"
              className="secondary-button"
              disabled={page <= 1 || loading}
              onClick={() => void search(page - 1)}
            >
              ‹ Anterior
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={images.length < 24 || loading}
              onClick={() => void search(page + 1)}
            >
              Siguiente ›
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
