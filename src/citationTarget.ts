/**
 * Biblia destino de las citas.
 *
 * En el Lienzo puede haber varias Biblias abiertas. Una de ellas se marca como
 * «destino» y recibe los clics en citas bíblicas de libros, EPUB y comentarios,
 * aunque esos paneles pertenezcan a otro grupo de enlace.
 *
 * El estado vive fuera de React porque el motor dockview monta cada panel en su
 * propia raíz: el aviso viaja por eventos de ventana y se persiste en
 * `localStorage` para sobrevivir a la reconstrucción del diseño.
 */

export const CITATION_TARGET_KEY = "teoamoxtli.citation-target.v1";
export const CITATION_TARGET_EVENT = "teo-citation-target-change";
export const CITATION_ROUTE_EVENT = "teo-citation-route";

export interface CitationReference {
  book: number;
  chapter: number;
  verse: number;
}

export interface CitationRouteDetail {
  targetPaneId: string;
  sourcePaneId: string;
  reference: CitationReference;
}

let cached: string | null | undefined;

/** Id del panel marcado como destino, o `null` si las citas siguen al enlace. */
export function readCitationTarget(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = window.localStorage.getItem(CITATION_TARGET_KEY) || null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Marca (o limpia, con `null`) la Biblia que recibe las citas. */
export function setCitationTarget(paneId: string | null): void {
  const next = paneId || null;
  if (readCitationTarget() === next) return;
  cached = next;
  try {
    if (next) window.localStorage.setItem(CITATION_TARGET_KEY, next);
    else window.localStorage.removeItem(CITATION_TARGET_KEY);
  } catch {
    /* almacenamiento no disponible: la selección vive solo en memoria */
  }
  window.dispatchEvent(
    new CustomEvent(CITATION_TARGET_EVENT, { detail: { paneId: next } }),
  );
}

/** Quita el destino solo si el panel indicado era el marcado. */
export function clearCitationTarget(paneId: string): void {
  if (readCitationTarget() === paneId) setCitationTarget(null);
}

export function subscribeCitationTarget(listener: () => void): () => void {
  window.addEventListener(CITATION_TARGET_EVENT, listener);
  return () => window.removeEventListener(CITATION_TARGET_EVENT, listener);
}

/** Envía una cita al panel destino sin pasar por el grupo de enlace. */
export function routeCitation(detail: CitationRouteDetail): void {
  window.dispatchEvent(new CustomEvent(CITATION_ROUTE_EVENT, { detail }));
}

export function onCitationRouted(
  listener: (detail: CitationRouteDetail) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<CitationRouteDetail>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(CITATION_ROUTE_EVENT, handler);
  return () => window.removeEventListener(CITATION_ROUTE_EVENT, handler);
}
