import { useState } from "react";
import type { Resource } from "./ModularWorkspace";
import { citationMetadata } from "./citationEngine";

interface Props {
  resource: Resource & { metadata?: Record<string, unknown> };
  onClose: () => void;
  onSave: (resourceId: string, metadata: Record<string, unknown>) => Promise<void>;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export default function CitationInfoModal({ resource, onClose, onSave }: Props) {
  const initial = citationMetadata({
    id: resource.id,
    kind: resource.kind as "bible" | "commentary" | "dictionary" | "book",
    title: resource.title,
    metadata: resource.metadata,
  });
  const [author, setAuthor] = useState(initial.author ?? "");
  const [year, setYear] = useState(initial.year ?? "");
  const [publisher, setPublisher] = useState(initial.publisher ?? "");
  const [series, setSeries] = useState(initial.series ?? "");
  const [translator, setTranslator] = useState(initial.translator ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(resource.id, {
        ...resource.metadata,
        author: author.trim() || null,
        publication_date: year.trim() || null,
        publisher: publisher.trim() || null,
        series_title: series.trim() || null,
        translator: translator.trim() || null,
        title: stringValue(resource.metadata?.title) || resource.title,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="citation-modal-backdrop" role="dialog" aria-modal="true">
      <section className="citation-modal">
        <header>
          <div>
            <span className="eyebrow">Información bibliográfica</span>
            <h2>{resource.title}</h2>
            <p>Estos datos se usan para generar citas APA, SBL y Chicago.</p>
          </div>
          <button type="button" className="word-study-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className="citation-form">
          <label><span>Autor</span><input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Apellido, Nombre; segundo autor" /></label>
          <label><span>Año</span><input value={year} onChange={(event) => setYear(event.target.value)} placeholder="2020" inputMode="numeric" /></label>
          <label><span>Editorial</span><input value={publisher} onChange={(event) => setPublisher(event.target.value)} placeholder="Editorial" /></label>
          <label><span>Serie</span><input value={series} onChange={(event) => setSeries(event.target.value)} placeholder="Serie o colección" /></label>
          <label><span>Traductor</span><input value={translator} onChange={(event) => setTranslator(event.target.value)} placeholder="Traductor" /></label>
        </div>
        <footer>
          <small>Los campos vacíos no se inventan: la cita usará los datos disponibles.</small>
          <div>
            <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
            <button type="button" className="home-primary" onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar metadatos"}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
