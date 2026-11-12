export interface GlobalSearchHit {
  resourceId: string;
  moduleType: "bible" | "commentary" | "dictionary" | "book" | string;
  referenceKey: string;
  fragment: string;
  score: number;
}

export interface PendingIndexResource {
  id: string;
  title: string;
  kind: string;
  indexed: boolean;
}

export interface GlobalIndexStatus {
  totalResources: number;
  indexedResources: number;
  pendingResources: number;
  totalRows: number;
  pending: PendingIndexResource[];
}

export interface IndexReport {
  resourceId: string;
  moduleType: string;
  rows: number;
}

export interface ParsedGlobalReference {
  book?: number;
  chapter?: number;
  verse?: number;
  spine?: number;
  topic?: string;
}

const OSIS_TO_BOOK: Record<string, number> = {
  Gen: 1, Exod: 2, Lev: 3, Num: 4, Deut: 5, Josh: 6, Judg: 7, Ruth: 8,
  "1Sam": 9, "2Sam": 10, "1Kgs": 11, "2Kgs": 12, "1Chr": 13, "2Chr": 14,
  Ezra: 15, Neh: 16, Esth: 17, Job: 18, Ps: 19, Prov: 20, Eccl: 21, Song: 22,
  Isa: 23, Jer: 24, Lam: 25, Ezek: 26, Dan: 27, Hos: 28, Joel: 29, Amos: 30,
  Obad: 31, Jonah: 32, Mic: 33, Nah: 34, Hab: 35, Zeph: 36, Hag: 37, Zech: 38,
  Mal: 39, Matt: 40, Mark: 41, Luke: 42, John: 43, Acts: 44, Rom: 45,
  "1Cor": 46, "2Cor": 47, Gal: 48, Eph: 49, Phil: 50, Col: 51, "1Thess": 52,
  "2Thess": 53, "1Tim": 54, "2Tim": 55, Titus: 56, Phlm: 57, Heb: 58,
  Jas: 59, "1Pet": 60, "2Pet": 61, "1John": 62, "2John": 63, "3John": 64,
  Jude: 65, Rev: 66,
};

export const MODULE_LABELS: Record<string, string> = {
  bible: "Biblias",
  commentary: "Comentarios",
  dictionary: "Diccionarios",
  book: "Libros",
};

export function parseGlobalReference(
  hit: GlobalSearchHit,
): ParsedGlobalReference {
  if (hit.referenceKey.startsWith("dict:")) {
    return { topic: hit.referenceKey.slice("dict:".length) };
  }
  if (hit.referenceKey.startsWith("book:")) {
    return { spine: Number(hit.referenceKey.slice("book:".length)) || 0 };
  }
  const parts = hit.referenceKey.split(":");
  if (parts.length >= 3) {
    return {
      book: OSIS_TO_BOOK[parts[0]] ?? 0,
      chapter: Number(parts[1]) || 1,
      verse: Number(parts[2]) || 1,
    };
  }
  return {};
}

export function globalReferenceLabel(
  hit: GlobalSearchHit,
  bookName?: (book: number) => string,
): string {
  const parsed = parseGlobalReference(hit);
  if (parsed.topic) return parsed.topic;
  if (parsed.spine !== undefined) return `Sección ${parsed.spine + 1}`;
  if (parsed.book) {
    const name = bookName ? bookName(parsed.book) : hit.referenceKey.split(":")[0];
    return `${name} ${parsed.chapter}:${parsed.verse}`;
  }
  return hit.referenceKey;
}

export function snippetHtml(fragment: string): string {
  return fragment
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;b&gt;/g, "<b>")
    .replace(/&lt;\/b&gt;/g, "</b>");
}

export type UnifiedSourceType =
  | "bible"
  | "commentary"
  | "dictionary"
  | "pbb_book"
  | "book"
  | "user_note"
  | string;

export interface UnifiedSearchResult {
  sourceType: UnifiedSourceType;
  resourceId: string;
  title: string;
  reference: string;
  snippet: string;
  book: number | null;
  chapter: number | null;
  verse: number | null;
  spine: number | null;
  noteId: string | null;
  priority: number;
}

export const UNIFIED_LABELS: Record<string, string> = {
  bible: "Biblias",
  commentary: "Comentarios",
  dictionary: "Diccionarios",
  pbb_book: "Libros Personales",
  book: "Libros",
  user_note: "Notas de estudio",
};

export const UNIFIED_ORDER = [
  "bible",
  "commentary",
  "dictionary",
  "pbb_book",
  "book",
  "user_note",
];

export function unifiedReferenceLabel(
  hit: UnifiedSearchResult,
  bookName?: (book: number) => string,
): string {
  if (hit.sourceType === "user_note") return hit.title || "Nota de estudio";
  if (hit.sourceType === "pbb_book") return hit.reference;
  if (hit.sourceType === "dictionary") {
    return hit.reference.startsWith("dict:")
      ? hit.reference.slice("dict:".length)
      : hit.reference;
  }
  if (hit.book && hit.chapter && hit.verse) {
    const name = bookName ? bookName(hit.book) : hit.reference.split(":")[0];
    return `${name} ${hit.chapter}:${hit.verse}`;
  }
  if (hit.spine !== null) return `Sección ${hit.spine + 1}`;
  return hit.reference;
}
