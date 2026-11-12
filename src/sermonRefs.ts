export interface SermonBookInfo {
  number: number;
  name: string;
  abbreviation: string;
}

export interface ParsedSermonReference {
  book: number;
  bookName: string;
  chapter: number;
  verse: number;
  endVerse: number;
  label: string;
  raw: string;
}

const MANUAL_ALIASES: Record<string, string[]> = {
  Génesis: ["gn", "gen", "génesis", "genesis"],
  Éxodo: ["ex", "éx", "exo", "éxodo", "exodo"],
  Levítico: ["lv", "lev", "levítico", "levitico"],
  Números: ["nm", "núm", "num", "números", "numeros"],
  Deuteronomio: ["dt", "deut", "deuteronomio"],
  Josué: ["jos", "josué", "josue"],
  Jueces: ["jc", "jue", "jueces"],
  Rut: ["rt", "rut"],
  "1 Samuel": ["1s", "1 sam", "1 samuel"],
  "2 Samuel": ["2s", "2 sam", "2 samuel"],
  "1 Reyes": ["1r", "1 rey", "1 reyes"],
  "2 Reyes": ["2r", "2 rey", "2 reyes"],
  "1 Crónicas": ["1cr", "1 crónicas", "1 cronicas"],
  "2 Crónicas": ["2cr", "2 crónicas", "2 cronicas"],
  Esdras: ["esd", "esdras"],
  Nehemías: ["neh", "nehemías", "nehemias"],
  Ester: ["est", "ester"],
  Job: ["job"],
  Salmos: ["sal", "salmo", "salmos", "ps"],
  Proverbios: ["pr", "prov", "proverbios"],
  Eclesiastés: ["ec", "ecl", "eclesiastés", "eclesiastes"],
  Cantares: ["cnt", "cant", "cantares"],
  Isaías: ["is", "isa", "isaías", "isaias"],
  Jeremías: ["jer", "jeremías", "jeremias"],
  Lamentaciones: ["lam", "lamentaciones"],
  Ezequiel: ["ez", "eze", "ezequiel"],
  Daniel: ["dn", "dan", "daniel"],
  Oseas: ["os", "oseas"],
  Joel: ["jl", "joel"],
  Amós: ["am", "amós", "amos"],
  Abdías: ["abd", "abdías", "abdias"],
  Jonás: ["jon", "jonás", "jonas"],
  Miqueas: ["miq", "miqueas"],
  Nahúm: ["nah", "nahúm", "nahum"],
  Habacuc: ["hab", "habacuc"],
  Sofonías: ["sof", "sofonías", "sofonias"],
  Hageo: ["hag", "hageo"],
  Zacarías: ["zac", "zacarías", "zacarias"],
  Malaquías: ["mal", "malaquías", "malaquias"],
  Mateo: ["mt", "mat", "mateo"],
  Marcos: ["mr", "mc", "mar", "marcos"],
  Lucas: ["lc", "luc", "lucas"],
  Juan: ["jn", "juan"],
  Hechos: ["hch", "hec", "hechos"],
  Romanos: ["ro", "rom", "romanos"],
  "1 Corintios": ["1co", "1 cor", "1 corintios"],
  "2 Corintios": ["2co", "2 cor", "2 corintios"],
  Gálatas: ["ga", "gál", "gal", "gálatas", "galatas"],
  Efesios: ["ef", "efe", "efesios"],
  Filipenses: ["fil", "flp", "filipenses"],
  Colosenses: ["col", "colosenses"],
  "1 Tesalonicenses": ["1ts", "1 tes", "1 tesalonicenses"],
  "2 Tesalonicenses": ["2ts", "2 tes", "2 tesalonicenses"],
  "1 Timoteo": ["1ti", "1 tim", "1 timoteo"],
  "2 Timoteo": ["2ti", "2 tim", "2 timoteo"],
  Tito: ["tit", "tito"],
  Filemón: ["flm", "filemón", "filemon"],
  Hebreos: ["he", "heb", "hebreos"],
  Santiago: ["stg", "sant", "santiago"],
  "1 Pedro": ["1p", "1 ped", "1 pedro"],
  "2 Pedro": ["2p", "2 ped", "2 pedro"],
  "1 Juan": ["1jn", "1 juan"],
  "2 Juan": ["2jn", "2 juan"],
  "3 Juan": ["3jn", "3 juan"],
  Judas: ["jud", "judas"],
  Apocalipsis: ["ap", "apoc", "apocalipsis", "rv", "rev"],
};

export function normalizeReference(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSermonBookLookup(
  books: SermonBookInfo[],
): Map<string, SermonBookInfo> {
  const lookup = new Map<string, SermonBookInfo>();
  for (const book of books) {
    lookup.set(normalizeReference(book.name), book);
    if (book.abbreviation) {
      lookup.set(normalizeReference(book.abbreviation), book);
    }
  }
  for (const [name, aliases] of Object.entries(MANUAL_ALIASES)) {
    const book = books.find(
      (item) => normalizeReference(item.name) === normalizeReference(name),
    );
    if (!book) continue;
    for (const alias of aliases) {
      lookup.set(normalizeReference(alias), book);
    }
  }
  return lookup;
}

const REFERENCE_PATTERN =
  /([1-3]?\s*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)?)\.?\s+(\d{1,3})\s*[:.,]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?/u;

export function parseSermonReference(
  raw: string,
  books: SermonBookInfo[],
): ParsedSermonReference | null {
  const match = REFERENCE_PATTERN.exec(raw.trim());
  if (!match) return null;
  const lookup = buildSermonBookLookup(books);
  const candidate = normalizeReference(match[1]);
  const book = lookup.get(candidate);
  if (!book) return null;
  const chapter = Number(match[2]);
  const verse = Number(match[3]);
  const endVerse = match[4] ? Number(match[4]) : verse;
  if (!chapter || !verse) return null;
  return {
    book: book.number,
    bookName: book.name,
    chapter,
    verse,
    endVerse: Math.max(verse, endVerse),
    label:
      endVerse > verse
        ? `${book.name} ${chapter}:${verse}-${endVerse}`
        : `${book.name} ${chapter}:${verse}`,
    raw: match[0],
  };
}

export function findReferenceInText(
  text: string,
  books: SermonBookInfo[],
): ParsedSermonReference | null {
  const pattern = new RegExp(REFERENCE_PATTERN.source, "gu");
  let match: RegExpExecArray | null = null;
  let last: ParsedSermonReference | null = null;
  while ((match = pattern.exec(text)) !== null) {
    const parsed = parseSermonReference(match[0], books);
    if (parsed) last = parsed;
  }
  return last;
}

export function htmlToPlainText(html: string): string {
  if (!html) return "";
  const document = new DOMParser().parseFromString(html, "text/html");
  return (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
}
