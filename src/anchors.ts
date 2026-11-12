export const OSIS_BOOKS = [
  "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA",
  "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO",
  "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO",
  "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL", "MAT",
  "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP",
  "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE",
  "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
];

export type ParsedAnchor =
  | {
      kind: "bible";
      book: number;
      chapter: number;
      verse: number;
      osis: string;
    }
  | {
      kind: "resource";
      resourceId: string;
      selector: string;
    }
  | null;

export function osisForBook(book: number) {
  return OSIS_BOOKS[book - 1] ?? "";
}

export function bookForOsis(osis: string) {
  const index = OSIS_BOOKS.indexOf(osis.toUpperCase());
  return index >= 0 ? index + 1 : 0;
}

export function bibleAnchor(book: number, chapter: number, verse: number) {
  return `bible:${osisForBook(book)}:${chapter}:${verse}`;
}

export function resourceAnchor(resourceId: string, selector: string) {
  return `res:${resourceId}#${selector}`;
}

export function parseAnchor(uri: string): ParsedAnchor {
  const bible = /^bible:([A-Z0-9]{3}):(\d+):(\d+)$/i.exec(uri.trim());
  if (bible) {
    const book = bookForOsis(bible[1]);
    if (!book) return null;
    return {
      kind: "bible",
      book,
      chapter: Number(bible[2]),
      verse: Number(bible[3]),
      osis: bible[1].toUpperCase(),
    };
  }
  if (uri.startsWith("res:")) {
    const [resourceId, selector = ""] = uri.slice(4).split("#");
    if (resourceId) {
      return { kind: "resource", resourceId, selector };
    }
  }
  return null;
}

export function anchorLabel(uri: string, bookName?: (book: number) => string) {
  const parsed = parseAnchor(uri);
  if (parsed?.kind === "bible") {
    return `${bookName?.(parsed.book) ?? parsed.osis} ${parsed.chapter}:${parsed.verse}`;
  }
  if (parsed?.kind === "resource") {
    return parsed.selector || parsed.resourceId;
  }
  return uri;
}
