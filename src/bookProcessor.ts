export interface BookHeadingItem {
  id: string;
  level: number;
  text: string;
  tocSpine?: number;
  tocAnchor?: string;
}

export interface DetectedScriptureRef {
  id: string;
  book: number;
  bookName: string;
  chapter: number;
  verse: number;
  endVerse: number;
  label: string;
  contextSnippet: string;
}

export interface ProcessedBookChapter {
  html: string;
  outline: BookHeadingItem[];
  scriptureRefs: DetectedScriptureRef[];
  wordCount: number;
  readingMinutes: number;
}

export interface BookTypesettingOptions {
  columns: 1 | 2 | 3;
  justify: boolean;
  firstLineIndent: boolean;
  dropCap: boolean;
  lineHeight: number; // 1.4 .. 2.1
  maxWidth: number;   // 560 .. 1200 px
  paragraphSpacing: number; // 0.5 .. 1.6 em
  columnRule: boolean; // regla vertical entre columnas
}

export const DEFAULT_BOOK_TYPESETTING: BookTypesettingOptions = {
  columns: 1,
  justify: true,
  firstLineIndent: true,
  dropCap: true,
  lineHeight: 1.78,
  maxWidth: 780,
  paragraphSpacing: 0.95,
  columnRule: true,
};

const BOOK_ALIASES: { book: number; canonical: string; aliases: string[] }[] = [
  { book: 1, canonical: "Génesis", aliases: ["génesis", "genesis", "gén", "gen", "gn"] },
  { book: 2, canonical: "Éxodo", aliases: ["éxodo", "exodo", "éx", "ex", "éxo", "exo"] },
  { book: 3, canonical: "Levítico", aliases: ["levítico", "levitico", "lev", "lv"] },
  { book: 4, canonical: "Números", aliases: ["números", "numeros", "núm", "num", "nm"] },
  { book: 5, canonical: "Deuteronomio", aliases: ["deuteronomio", "deut", "dt"] },
  { book: 6, canonical: "Josué", aliases: ["josué", "josue", "jos"] },
  { book: 7, canonical: "Jueces", aliases: ["jueces", "jue", "jc"] },
  { book: 8, canonical: "Rut", aliases: ["rut", "rt"] },
  { book: 9, canonical: "1 Samuel", aliases: ["1 samuel", "1samuel", "1 sam", "1sam", "1 s", "1s"] },
  { book: 10, canonical: "2 Samuel", aliases: ["2 samuel", "2samuel", "2 sam", "2sam", "2 s", "2s"] },
  { book: 11, canonical: "1 Reyes", aliases: ["1 reyes", "1reyes", "1 rey", "1rey", "1 r", "1r"] },
  { book: 12, canonical: "2 Reyes", aliases: ["2 reyes", "2reyes", "2 rey", "2rey", "2 r", "2r"] },
  { book: 13, canonical: "1 Crónicas", aliases: ["1 crónicas", "1 cronicas", "1 cró", "1 cro", "1 cr", "1cr"] },
  { book: 14, canonical: "2 Crónicas", aliases: ["2 crónicas", "2 cronicas", "2 cró", "2 cro", "2 cr", "2cr"] },
  { book: 15, canonical: "Esdras", aliases: ["esdras", "esd", "ezr"] },
  { book: 16, canonical: "Nehemías", aliases: ["nehemías", "nehemias", "neh", "ne"] },
  { book: 17, canonical: "Ester", aliases: ["ester", "est", "et"] },
  { book: 18, canonical: "Job", aliases: ["job", "jb"] },
  { book: 19, canonical: "Salmos", aliases: ["salmos", "salmo", "sal", "sl", "ps"] },
  { book: 20, canonical: "Proverbios", aliases: ["proverbios", "prov", "pr", "prv"] },
  { book: 21, canonical: "Eclesiastés", aliases: ["eclesiastés", "eclesiastes", "ecl", "ec", "qoh"] },
  { book: 22, canonical: "Cantares", aliases: ["cantares", "cantar de los cantares", "cant", "cnt", "ct"] },
  { book: 23, canonical: "Isaías", aliases: ["isaías", "isaias", "isa", "is"] },
  { book: 24, canonical: "Jeremías", aliases: ["jeremías", "jeremias", "jer", "jr"] },
  { book: 25, canonical: "Lamentaciones", aliases: ["lamentaciones", "lam", "lm"] },
  { book: 26, canonical: "Ezequiel", aliases: ["ezequiel", "eze", "ez"] },
  { book: 27, canonical: "Daniel", aliases: ["daniel", "dan", "dn"] },
  { book: 28, canonical: "Oseas", aliases: ["oseas", "os", "hos"] },
  { book: 29, canonical: "Joel", aliases: ["joel", "jl"] },
  { book: 30, canonical: "Amós", aliases: ["amós", "amos", "am"] },
  { book: 31, canonical: "Abdías", aliases: ["abdías", "abdias", "abd", "ab"] },
  { book: 32, canonical: "Jonás", aliases: ["jonás", "jonas", "jon", "jn."] },
  { book: 33, canonical: "Miqueas", aliases: ["miqueas", "miq", "mi"] },
  { book: 34, canonical: "Nahúm", aliases: ["nahúm", "nahum", "nah", "na"] },
  { book: 35, canonical: "Habacuc", aliases: ["habacuc", "hab", "hb"] },
  { book: 36, canonical: "Sofonías", aliases: ["sofonías", "sofonias", "sof", "so"] },
  { book: 37, canonical: "Hageo", aliases: ["hageo", "hag", "hg"] },
  { book: 38, canonical: "Zacarías", aliases: ["zacarías", "zacarias", "zac", "zc"] },
  { book: 39, canonical: "Malaquías", aliases: ["malaquías", "malaquias", "mal", "ml"] },
  { book: 40, canonical: "Mateo", aliases: ["mateo", "mat", "mt"] },
  { book: 41, canonical: "Marcos", aliases: ["marcos", "mar", "mr", "mc", "mk"] },
  { book: 42, canonical: "Lucas", aliases: ["lucas", "luc", "lc", "lk"] },
  { book: 43, canonical: "Juan", aliases: ["juan", "jn", "jhn"] },
  { book: 44, canonical: "Hechos", aliases: ["hechos", "hch", "hec", "act"] },
  { book: 45, canonical: "Romanos", aliases: ["romanos", "rom", "ro", "rm"] },
  { book: 46, canonical: "1 Corintios", aliases: ["1 corintios", "1corintios", "1 cor", "1cor", "1 co", "1co"] },
  { book: 47, canonical: "2 Corintios", aliases: ["2 corintios", "2corintios", "2 cor", "2cor", "2 co", "2co"] },
  { book: 48, canonical: "Gálatas", aliases: ["gálatas", "galatas", "gál", "gal", "gá", "ga"] },
  { book: 49, canonical: "Efesios", aliases: ["efesios", "efe", "ef", "eph"] },
  { book: 50, canonical: "Filipenses", aliases: ["filipenses", "fil", "flp", "php"] },
  { book: 51, canonical: "Colosenses", aliases: ["colosenses", "col"] },
  { book: 52, canonical: "1 Tesalonicenses", aliases: ["1 tesalonicenses", "1tesalonicenses", "1 tes", "1tes", "1 ts", "1ts"] },
  { book: 53, canonical: "2 Tesalonicenses", aliases: ["2 tesalonicenses", "2tesalonicenses", "2 tes", "2tes", "2 ts", "2ts"] },
  { book: 54, canonical: "1 Timoteo", aliases: ["1 timoteo", "1timoteo", "1 tim", "1tim", "1 ti", "1ti"] },
  { book: 55, canonical: "2 Timoteo", aliases: ["2 timoteo", "2timoteo", "2 tim", "2tim", "2 ti", "2ti"] },
  { book: 56, canonical: "Tito", aliases: ["tito", "tit", "ti"] },
  { book: 57, canonical: "Filemón", aliases: ["filemón", "filemon", "flm", "flmn", "phm"] },
  { book: 58, canonical: "Hebreos", aliases: ["hebreos", "heb", "he"] },
  { book: 59, canonical: "Santiago", aliases: ["santiago", "stg", "st", " sant", "jas"] },
  { book: 60, canonical: "1 Pedro", aliases: ["1 pedro", "1pedro", "1 ped", "1ped", "1 pe", "1pe", "1 p", "1p"] },
  { book: 61, canonical: "2 Pedro", aliases: ["2 pedro", "2pedro", "2 ped", "2ped", "2 pe", "2pe", "2 p", "2p"] },
  { book: 62, canonical: "1 Juan", aliases: ["1 juan", "1juan", "1 jn", "1jn"] },
  { book: 63, canonical: "2 Juan", aliases: ["2 juan", "2juan", "2 jn", "2jn"] },
  { book: 64, canonical: "3 Juan", aliases: ["3 juan", "3juan", "3 jn", "3jn"] },
  { book: 65, canonical: "Judas", aliases: ["judas", "jud", "jd"] },
  { book: 66, canonical: "Apocalipsis", aliases: ["apocalipsis", "apoc", "ap", "rv", "rev"] },
];


const ENGLISH_ALIASES: Record<number, string[]> = {
  1:["gen","ge","genesis"],2:["exod","exo","exodus"],3:["lev","le","leviticus"],4:["num","nu","numb","numbers"],5:["deut","de","deuteronomy"],
  6:["josh","jsh","joshua"],7:["judg","jdg","jg","jdgs","judges"],8:["ruth","ru","rth"],9:["1 sam","1 sm","1 sa","1 s","i sam","1 samuel"],10:["2 sam","2 sm","2 sa","2 s","ii sam","2 samuel"],
  11:["1 kgs","1 ki","1 k","1 kings","i kgs","i kings"],12:["2 kgs","2 ki","2 k","2 kings","ii kgs","ii kings"],13:["1 chr","1 ch","1 chron","1 chronicles"],14:["2 chr","2 ch","2 chron","2 chronicles"],
  15:["ezra","ezr"],16:["neh","ne","nehemiah"],17:["esth","est","es","esther"],18:["job","jb"],19:["ps","pss","psa","psalm","psalms"],20:["prov","prv","proverbs"],21:["eccl","ecc","qoh","qo","ecclesiastes"],22:["song","sos","sg","canticles","song of songs"],
  23:["isa","is","isaiah"],24:["jer","je","jr","jeremiah"],25:["lam","la","lamentations"],26:["ezek","eze","ezk","ezekiel"],27:["dan","da","dn","daniel"],28:["hos","ho","hosea"],29:["joel","jl"],30:["amos","am"],31:["obad","ob","oba","obadiah"],32:["jonah","jon","jnh"],33:["mic","mi","micah"],34:["nah","na","nahum"],35:["hab","hb","habakkuk"],36:["zeph","zep","zp","zephaniah"],37:["hag","hg","haggai"],38:["zech","zec","zc","zechariah"],39:["mal","ml","malachi"],
  40:["matt","mat","matthew"],41:["mark","mk","mrk","mr"],42:["luke","lk","lu"],43:["john","jhn"],44:["acts","ac","act"],45:["rom","ro","rm","romans"],46:["1 cor","1 co","1 corinthians"],47:["2 cor","2 co","2 corinthians"],48:["gal","ga","galatians"],49:["eph","ep","ephesians"],50:["phil","php","pp","philippians"],51:["col","colossians"],52:["1 thess","1 th","1 thessalonians"],53:["2 thess","2 th","2 thessalonians"],54:["1 tim","1 ti","1 timothy"],55:["2 tim","2 ti","2 timothy"],56:["titus","tit","ti"],57:["phlm","phm","philemon"],58:["heb","he","hebrews"],59:["jas","jm","james"],60:["1 pet","1 pe","1 pt","1 p","1 peter"],61:["2 pet","2 pe","2 pt","2 p","2 peter"],62:["1 john","1 jn","1 jhn"],63:["2 john","2 jn","2 jhn"],64:["3 john","3 jn","3 jhn"],65:["jude","jud"],66:["rev","rv","apoc","revelation"],
};
for (const entry of BOOK_ALIASES) {
  entry.aliases.push(...(ENGLISH_ALIASES[entry.book] ?? []));
}

const ALIAS_TO_BOOK = new Map<string, { book: number; canonical: string }>();
const SORTED_ALIASES: string[] = [];

for (const entry of BOOK_ALIASES) {
  for (const alias of entry.aliases) {
    const clean = alias.trim().toLowerCase();
    ALIAS_TO_BOOK.set(clean, { book: entry.book, canonical: entry.canonical });
    SORTED_ALIASES.push(clean);
  }
}

SORTED_ALIASES.sort((a, b) => b.length - a.length);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BOOK_PATTERN = SORTED_ALIASES.map(escapeRegex).join("|");
const SCRIPTURE_REGEX = new RegExp(
  `(^|[^\\p{L}\\p{N}])((?:${BOOK_PATTERN})\\.?\\s+(\\d{1,3})(?:\\s*[:.,]\\s*(\\d{1,3}))?(?:\\s*[-–—]\\s*(\\d{1,3}))?(?:\\s*(?:f{1,2}\\.?|[ab]))?(?:\\s*\\([^)]{0,24}\\))?)(?![\\p{L}\\p{N}])`,
  "giu",
);

export function processBookChapterHtml(rawHtml: string): ProcessedBookChapter {
  const parser = new DOMParser();
  const cleaned = (rawHtml || "")
    .replace(/(?:^|[\s>])[a-zA-Z0-9_:-]*?(?:definition|graph|class|style|epub|type|span|div|para)[a-zA-Z0-9_:-]*(?:&gt;|>)\s*/gi, " ")
    .replace(/\s+/g, " ");
  const doc = parser.parseFromString(cleaned, "text/html");
  const body = doc.body;
  let baseBook = 0;
  let baseChapter = 1;
  const titleText = `${body.querySelector("h1,h2,h3")?.textContent ?? ""} ${(body.textContent ?? "").slice(0, 800)}`.toLowerCase();
  for (const alias of SORTED_ALIASES) {
    if (alias.length < 3) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(alias)}(?![\\p{L}\\p{N}])`, "iu");
    if (pattern.test(titleText)) {
      const info = ALIAS_TO_BOOK.get(alias);
      if (info && (!baseBook || alias.length > 3)) { baseBook = info.book; }
    }
  }
  const chapterHint = /\((\d{1,3})[:.]\d{1,3}/.exec(titleText);
  if (chapterHint) baseChapter = Number(chapterHint[1]);

  // 1a. Neutralize ghost anchors and promote bullet paragraphs.
  body.querySelectorAll<HTMLAnchorElement>("a").forEach((anchor) => {
    const href = anchor.getAttribute("href")?.trim() ?? "";
    if (!href || href === "#" || href.startsWith("javascript:")) {
      anchor.replaceWith(...Array.from(anchor.childNodes));
    } else {
      anchor.classList.add("book-inline-anchor");
    }
  });
  body.querySelectorAll<HTMLParagraphElement>("p").forEach((paragraph) => {
    const text = (paragraph.textContent ?? "").trim();
    if (!/^[•●▪◦]/.test(text)) return;
    const list = doc.createElement("ul");
    list.className = "editorial-list";
    const item = doc.createElement("li");
    item.innerHTML = paragraph.innerHTML.replace(/^\s*[•●▪◦]\s*/, "");
    list.appendChild(item);
    paragraph.replaceWith(list);
  });

  // 1b. Sentence stitching for fragmented glossary lines.
  const blocks = Array.from(body.querySelectorAll<HTMLElement>("p, li"));
  for (let index = 0; index < blocks.length - 2; index += 1) {
    const first = blocks[index];
    const second = blocks[index + 1];
    const third = blocks[index + 2];
    if (!first.parentElement) continue;
    const firstText = (first.textContent ?? "").trim();
    const secondText = (second.textContent ?? "").trim();
    const thirdText = (third.textContent ?? "").trim();
    if (!/(?:\b(?:la|el|los|las|de|un|una|del))$/i.test(firstText)) continue;
    if (!/^[\p{L}]{2,24}$/u.test(secondText)) continue;
    if (!/^[\(a-záéíóúñ]/.test(thirdText)) continue;
    const em = doc.createElement("em");
    em.textContent = secondText;
    first.innerHTML = `${first.innerHTML.trim()} ${em.outerHTML} ${third.innerHTML}`;
    second.remove();
    third.remove();
    index -= 1;
  }

  // 1c. Infer blockquotes and poetry from classes/styles or context.
  const blocksForQuote = Array.from(body.querySelectorAll<HTMLElement>("p, div"));
  for (const block of blocksForQuote) {
    const text = (block.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const signature = `${block.className} ${block.getAttribute("style") ?? ""}`.toLowerCase();
    const explicit = /(quote|blockquote|extract|cita|sangr|indent|poetry|poem|verse|epigraph|lyric|salmo)/.test(signature);
    if (explicit && !block.closest("blockquote")) {
      const quote = doc.createElement("blockquote");
      quote.className = /poetry|poem|verse|lyric/.test(signature) ? "editorial-poetry" : "editorial-blockquote";
      quote.innerHTML = block.innerHTML;
      block.replaceWith(quote);
    }
  }
  const paragraphBlocks = Array.from(body.querySelectorAll<HTMLElement>("p"));
  for (let i = 0; i < paragraphBlocks.length - 1; i += 1) {
    const first = paragraphBlocks[i];
    const second = paragraphBlocks[i + 1];
    const firstText = (first.textContent ?? "").trim();
    const secondText = (second.textContent ?? "").trim();
    if (!firstText.endsWith(":") || secondText.length < 25 || secondText.length > 650) continue;
    const declarative = /(dice|escribe|leemos|así|sigue|declara|afirma|texto|versículo)\s*:?$/i.test(firstText);
    const italic = second.querySelector("em, i") !== null;
    const quoted = /^["“«].*["”»]$/.test(secondText);
    if (declarative && (italic || quoted)) {
      const quote = doc.createElement("blockquote");
      quote.className = "editorial-blockquote";
      quote.innerHTML = second.innerHTML;
      second.replaceWith(quote);
    }
  }

  // 1. Clean broken inline styles from imported EPUBs while preserving semantic structure
  const styledNodes = body.querySelectorAll<HTMLElement>("[style]");
  styledNodes.forEach((el) => {
    el.style.removeProperty("font-family");
    el.style.removeProperty("font-size");
    el.style.removeProperty("line-height");
    el.style.removeProperty("color");
    el.style.removeProperty("background");
    el.style.removeProperty("background-color");
    el.style.removeProperty("width");
    el.style.removeProperty("max-width");
    if (!el.getAttribute("style")?.trim()) {
      el.removeAttribute("style");
    }
  });

  // 2. Promote unstyled structural paragraphs (<p>I. ...</p>, <p>A. ...</p>, <p>1. ...</p>) to headings if not links
  const romanHeadingRe = /^[IVXLCDM]{1,6}\.\s+\S/;
  const alphaHeadingRe = /^[A-ZÑ]\.\s+\S/;
  const decimalHeadingRe = /^\d+\.\d+(?:\.\d+)*\.?\s+\S/;
  const numberedHeadingRe = /^\d{1,2}\.\s+[A-ZÁÉÍÓÚÑ]/;

  body.querySelectorAll<HTMLParagraphElement>("p").forEach((p) => {
    if (p.querySelector("a.book-toc-link")) return;
    const txt = (p.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!txt || txt.length > 125) return;
    let targetTag: string | null = null;
    if (romanHeadingRe.test(txt) && !txt.endsWith(".")) {
      targetTag = "h2";
    } else if (alphaHeadingRe.test(txt) && !txt.endsWith(".")) {
      targetTag = "h3";
    } else if (
      (decimalHeadingRe.test(txt) || numberedHeadingRe.test(txt)) &&
      txt.length <= 95 &&
      !txt.endsWith(".")
    ) {
      targetTag = "h4";
    }
    if (targetTag) {
      const h = doc.createElement(targetTag);
      h.innerHTML = p.innerHTML;
      if (p.id) h.id = p.id;
      p.replaceWith(h);
    }
  });

  // 2b. Build chapter section outline (H1..H4) and preserve existing bookmark anchor IDs
  const outline: BookHeadingItem[] = [];
  const headings = body.querySelectorAll<HTMLElement>("h1, h2, h3, h4");
  headings.forEach((heading, index) => {
    const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const id = heading.id || `book-sec-${index + 1}`;
    heading.id = id;
    heading.classList.add("book-editorial-heading");
    const level = Number(heading.tagName.slice(1)) || 2;
    outline.push({ id, level, text });
  });

  // If this chapter is a Table of Contents / Índice with .book-toc-link items and no H1..H4 headings,
  // populate the outline from the TOC entries themselves so Secciones is never empty!
  if (outline.length === 0) {
    const tocLinks = body.querySelectorAll<HTMLAnchorElement>("a.book-toc-link");
    tocLinks.forEach((link, index) => {
      const text = (link.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) return;
      const id = link.id || `toc-item-${index + 1}`;
      link.id = id;
      let level = 2;
      if (romanHeadingRe.test(text)) level = 2;
      else if (alphaHeadingRe.test(text)) level = 3;
      else if (decimalHeadingRe.test(text) || numberedHeadingRe.test(text)) level = 4;
      const rawSpine = link.getAttribute("data-toc-spine");
      const rawAnchor = link.getAttribute("data-toc-anchor") || link.getAttribute("href")?.replace(/^#/, "");
      outline.push({
        id,
        level,
        text,
        tocSpine: rawSpine !== null && rawSpine !== "" ? Number(rawSpine) : undefined,
        tocAnchor: rawAnchor || undefined,
      });
    });
  }

  // 3. Mark lead paragraph for optional drop-cap styling
  const firstParagraph = Array.from(body.querySelectorAll<HTMLParagraphElement>("p")).find(
    (p) => !p.querySelector("a.book-toc-link") && (p.textContent ?? "").trim().length > 60,
  );
  if (firstParagraph) {
    firstParagraph.classList.add("book-lead-paragraph", "book-opening-paragraph");
  }

  // Convierte spans generados por Rust/PBB sin atributos interactivos.
  body.querySelectorAll<HTMLElement>("span.scripture-ref").forEach((span) => {
    const text = (span.textContent ?? "").trim();
    SCRIPTURE_REGEX.lastIndex = 0;
    const match = SCRIPTURE_REGEX.exec(text);
    if (!match || !span.parentNode) return;
    const alias = (match[2].match(/^(.*?)\.?\s+\d/u)?.[1] ?? "").toLowerCase().replace(/\.$/, "");
    const info = ALIAS_TO_BOOK.get(alias);
    if (!info) return;
    const chapter = Number(match[3] || 1);
    const verse = Number(match[4] || 1);
    const link = doc.createElement("a");
    link.className = "scripture-ref-link";
    link.href = "#";
    link.dataset.book = String(info.book);
    link.dataset.bookName = info.canonical;
    link.dataset.chapter = String(chapter);
    link.dataset.verse = String(verse);
    link.dataset.endVerse = String(match[5] ? Number(match[5]) : verse);
    link.dataset.label = `${info.canonical} ${chapter}:${verse}`;
    link.textContent = text;
    span.replaceWith(link);
  });

  // 4. Detect and linkify Scripture references across text nodes
  const scriptureRefs: DetectedScriptureRef[] = [];
  const seenKeys = new Set<string>();

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      if (tag === "a" || tag === "code" || tag === "pre" || tag === "script" || tag === "style") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  let refCounter = 0;
  for (const textNode of textNodes) {
    const content = textNode.nodeValue ?? "";
    if (!/\d/.test(content)) continue;

    SCRIPTURE_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    let lastIndex = 0;
    let fragment: DocumentFragment | null = null;

    while ((match = SCRIPTURE_REGEX.exec(content)) !== null) {
      const prefix = match[1] ?? "";
      const fullRef = match[2] ?? "";
      const chapterNum = Number(match[3]);
      const verseNum = Number(match[4] ?? 1);
      const endVerseNum = match[5] ? Number(match[5]) : verseNum;

      // Extract book alias part before chapter number
      const bookPartMatch = /^(.*?)\.?\s+\d{1,3}/u.exec(fullRef);
      const rawAlias = (bookPartMatch?.[1] ?? "").trim().toLowerCase().replace(/\.$/, "");
      const bookInfo = ALIAS_TO_BOOK.get(rawAlias) ?? ALIAS_TO_BOOK.get(`${rawAlias}.`);
      if (!bookInfo || !chapterNum || !verseNum) continue;

      if (!fragment) {
        fragment = doc.createDocumentFragment();
      }

      const matchStart = match.index + prefix.length;
      if (matchStart > lastIndex) {
        fragment.appendChild(doc.createTextNode(content.slice(lastIndex, matchStart)));
      }

      refCounter += 1;
      const refId = `scripture-ref-${refCounter}`;
      const canonicalLabel =
        endVerseNum > verseNum
          ? `${bookInfo.canonical} ${chapterNum}:${verseNum}-${endVerseNum}`
          : `${bookInfo.canonical} ${chapterNum}:${verseNum}`;

      const link = doc.createElement("a");
      link.href = `#${refId}`;
      link.id = refId;
      link.className = "scripture-ref-link";
      link.dataset.book = String(bookInfo.book);
      link.dataset.bookName = bookInfo.canonical;
      link.dataset.chapter = String(chapterNum);
      link.dataset.verse = String(verseNum);
      link.dataset.endVerse = String(endVerseNum);
      link.dataset.label = canonicalLabel;
      link.title = `Ver ${canonicalLabel} en la Biblia / Enviar a Entorno`;
      link.textContent = fullRef;

      fragment.appendChild(link);
      lastIndex = matchStart + fullRef.length;

      const dedupKey = `${bookInfo.book}:${chapterNum}:${verseNum}-${endVerseNum}`;
      if (!seenKeys.has(dedupKey)) {
        seenKeys.add(dedupKey);
        const snippetStart = Math.max(0, matchStart - 45);
        const snippetEnd = Math.min(content.length, lastIndex + 55);
        scriptureRefs.push({
          id: refId,
          book: bookInfo.book,
          bookName: bookInfo.canonical,
          chapter: chapterNum,
          verse: verseNum,
          endVerse: endVerseNum,
          label: canonicalLabel,
          contextSnippet: content.slice(snippetStart, snippetEnd).replace(/\s+/g, " ").trim(),
        });
      }
    }

    if (fragment && textNode.parentNode) {
      if (lastIndex < content.length) {
        fragment.appendChild(doc.createTextNode(content.slice(lastIndex)));
      }
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }

  // 5. Resolve implicit verse references (v. 21, vv. 20-22) against the
  // nearest preceding explicit Scripture reference in the chapter.
  const explicitLinks = Array.from(body.querySelectorAll<HTMLAnchorElement>("a.scripture-ref-link"));
  const implicitRegex = /\b(vv?\.|vers(?:ículo)?\.?)\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?/giu;
  const implicitTexts: Text[] = [];
  const implicitWalker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let implicitNode = implicitWalker.nextNode();
  while (implicitNode) {
    const parent = implicitNode.parentElement;
    if (parent && !parent.closest("a") && implicitRegex.test(implicitNode.nodeValue ?? "")) {
      implicitTexts.push(implicitNode as Text);
    }
    implicitRegex.lastIndex = 0;
    implicitNode = implicitWalker.nextNode();
  }
  for (const node of implicitTexts) {
    const preceding = explicitLinks
      .filter((link) => node.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_PRECEDING)
      .pop();
    const book = Number(preceding?.dataset.book ?? baseBook ?? 0);
    const chapter = Number(preceding?.dataset.chapter ?? baseChapter ?? 0);
    if (!book || !chapter) continue;
    const raw = node.nodeValue ?? "";
    implicitRegex.lastIndex = 0;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = implicitRegex.exec(raw))) {
      if (match.index > cursor) fragment.appendChild(doc.createTextNode(raw.slice(cursor, match.index)));
      const verse = Number(match[2]);
      const endVerse = match[3] ? Number(match[3]) : verse;
      const link = doc.createElement("a");
      link.className = "scripture-ref-link";
      link.href = "#";
      link.dataset.book = String(book);
      link.dataset.chapter = String(chapter);
      link.dataset.verse = String(verse);
      link.dataset.endVerse = String(endVerse);
      link.dataset.label = `${preceding?.dataset.bookName ?? "Biblia"} ${chapter}:${verse}`;
      link.textContent = match[0];
      fragment.appendChild(link);
      cursor = match.index + match[0].length;
    }
    if (cursor === 0) continue;
    if (cursor < raw.length) fragment.appendChild(doc.createTextNode(raw.slice(cursor)));
    node.parentNode?.replaceChild(fragment, node);
  }

  // 6. Polyglot script wrappers.
  const polyglotWalker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const polyglotNodes: Text[] = [];
  let polyNode = polyglotWalker.nextNode();
  while (polyNode) {
    const parent = polyNode.parentElement;
    if (parent && !parent.closest("a, script, style, code, pre")) polyglotNodes.push(polyNode as Text);
    polyNode = polyglotWalker.nextNode();
  }
  for (const node of polyglotNodes) {
    const raw = node.nodeValue ?? "";
    const pattern = /([\u0590-\u05FF\uFB1D-\uFB4F]+|[\u0370-\u03FF\u1F00-\u1FFF]+)/u;
    if (!pattern.test(raw)) continue;
    const parts = raw.split(pattern);
    const fragment = doc.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      if (/^[\u0590-\u05FF\uFB1D-\uFB4F]+$/u.test(part)) {
        const span = doc.createElement("span");
        span.className = "editorial-hebrew";
        span.dir = "rtl";
        span.title = "Clic para consultar en léxicos";
        span.textContent = part;
        fragment.appendChild(span);
      } else if (/^[\u0370-\u03FF\u1F00-\u1FFF]+$/u.test(part)) {
        const span = doc.createElement("span");
        span.className = "editorial-greek";
        span.title = "Clic para consultar en léxicos";
        span.textContent = part;
        fragment.appendChild(span);
      } else fragment.appendChild(doc.createTextNode(part));
    }
    node.parentNode?.replaceChild(fragment, node);
  }

  const plainText = (body.textContent ?? "").replace(/\s+/g, " ").trim();
  const wordCount = plainText ? plainText.split(" ").length : 0;
  const readingMinutes = Math.max(1, Math.round(wordCount / 210));

  return {
    html: body.innerHTML,
    outline,
    scriptureRefs,
    wordCount,
    readingMinutes,
  };
}
