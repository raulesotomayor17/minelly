import { Cite, plugins } from "@citation-js/core";
import "@citation-js/plugin-csl";
import apaXml from "./csl/apa.csl?raw";
import sblXml from "./csl/society-of-biblical-literature-fullnote-bibliography.csl?raw";
import chicagoXml from "./csl/chicago-author-date.csl?raw";

export type CitationStyle = "apa" | "sbl" | "chicago";
export type CitationSourceKind = "bible" | "commentary" | "dictionary" | "book";

export interface CitationMetadata {
  author?: string;
  year?: string;
  publisher?: string;
  series?: string;
  edition?: string;
  translator?: string;
}

export interface CitationResource {
  id: string;
  kind: CitationSourceKind;
  title: string;
  abbreviation?: string;
  language?: string;
  metadata?: Record<string, unknown>;
  pbb?: {
    author?: string;
    copyright?: string;
    publisher?: string;
    publicationDate?: string;
    series?: string;
    customAttributes?: Array<{ key: string; value: string }>;
  };
}

export interface CitationLocation {
  bookName?: string;
  chapter?: number;
  verse?: number;
  page?: string;
  lemma?: string;
  label?: string;
}

export interface CitationResult {
  quote: string;
  parenthetical: string;
  reference: string;
  plain: string;
  html: string;
}

const STYLE_IDS: Record<CitationStyle, string> = {
  apa: "teoamoxtli-apa",
  sbl: "teoamoxtli-sbl",
  chicago: "teoamoxtli-chicago",
};

let stylesRegistered = false;
function registerStyles() {
  if (stylesRegistered) return;
  const config = plugins.config.get("@csl");
  config.styles.add(STYLE_IDS.apa, apaXml);
  config.styles.add(STYLE_IDS.sbl, sblXml);
  config.styles.add(STYLE_IDS.chicago, chicagoXml);
  stylesRegistered = true;
}

function metadataValue(
  resource: CitationResource,
  keys: string[],
): string | undefined {
  const custom = Object.fromEntries(
    (resource.pbb?.customAttributes ?? []).map((item) => [item.key, item.value]),
  );
  const sources: Array<Record<string, unknown>> = [
    (resource.pbb ?? {}) as Record<string, unknown>,
    custom,
    resource.metadata ?? {},
  ];
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

export function citationMetadata(resource: CitationResource): CitationMetadata {
  const yearSource =
    metadataValue(resource, ["publicationDate", "publication_date", "year", "copyright", "versionDate"]) ||
    "";
  const yearMatch = yearSource.match(/(?:1[5-9]|20)\d{2}/);
  return {
    author: metadataValue(resource, ["author", "creator", "byline"]),
    year: yearMatch?.[0] ?? "",
    publisher: metadataValue(resource, ["publisher", "editorial", "publisher_name"]),
    series: metadataValue(resource, ["series", "seriesTitle", "series_title"]),
    edition: metadataValue(resource, ["edition", "edición"]),
    translator: metadataValue(resource, ["translator", "traductor"]),
  };
}

function parseAuthors(author?: string) {
  if (!author?.trim()) return [];
  return author
    .split(/\s*;\s*|\s+y\s+|\s+and\s+/i)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      if (name.includes(",")) {
        const [family, ...given] = name.split(",");
        return { family: family.trim(), given: given.join(",").trim() };
      }
      const parts = name.split(/\s+/);
      if (parts.length === 1) return { family: parts[0] };
      const family = parts.pop() as string;
      return { family, given: parts.join(" ") };
    });
}

function cslItem(resource: CitationResource) {
  const meta = citationMetadata(resource);
  const authors = parseAuthors(meta.author);
  return {
    id: resource.id,
    type:
      resource.kind === "dictionary"
        ? "entry-dictionary"
        : resource.kind === "commentary"
          ? "book"
          : "book",
    title: resource.title,
    author: authors,
    issued: meta.year ? { "date-parts": [[Number(meta.year)]] } : undefined,
    publisher: meta.publisher,
    "collection-title": meta.series,
    edition: meta.edition,
    translator: parseAuthors(meta.translator),
    language: resource.language,
    "citation-key": resource.abbreviation || resource.title,
  };
}

function plainText(html: string) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatReference(resource: CitationResource, style: CitationStyle) {
  registerStyles();
  try {
    const cite = new Cite([cslItem(resource)]);
    const html = cite.format("bibliography", {
      style: STYLE_IDS[style],
      format: "html",
      lang: "en-US",
    }) as string;
    return {
      text: plainText(html),
      html: html.replace(/^<div class="csl-entry">/, "").replace(/<\/div>\s*$/, ""),
    };
  } catch {
    const meta = citationMetadata(resource);
    return {
      text: `${meta.author ? `${meta.author}. ` : ""}${meta.year ? `(${meta.year}). ` : ""}${resource.title}.${meta.publisher ? ` ${meta.publisher}.` : ""}`,
      html: "",
    };
  }
}

function parenthetical(
  resource: CitationResource,
  location: CitationLocation,
  style: CitationStyle,
): string {
  const meta = citationMetadata(resource);
  const locator = location.label?.trim()
    ? location.label.trim()
    : location.lemma
      ? `s.v. "${location.lemma}"`
      : location.page
        ? `p. ${location.page}`
        : location.bookName && location.chapter
          ? `${location.bookName} ${location.chapter}${location.verse ? `:${location.verse}` : ""}`
          : location.chapter
            ? `cap. ${location.chapter}`
            : "";
  if (resource.kind === "bible") {
    const label = resource.abbreviation || resource.title;
    const year = meta.year || "s.f.";
    return `(${label}, ${year}${locator ? `, ${locator}` : ""})`;
  }
  const authors = parseAuthors(meta.author);
  const authorLabel =
    authors.length === 0
      ? resource.abbreviation || resource.title
      : authors.length === 1
        ? authors[0].family
        : authors.length === 2
          ? `${authors[0].family} & ${authors[1].family}`
          : `${authors[0].family} et al.`;
  const year = meta.year || "s.f.";
  if (style === "sbl") {
    return `(${authorLabel} ${year}${locator ? `, ${locator}` : ""})`;
  }
  return `(${authorLabel}, ${year}${locator ? `, ${locator}` : ""})`;
}

export function buildCitation(
  resource: CitationResource,
  text: string,
  location: CitationLocation,
  style: CitationStyle,
  includeBibleEntry = false,
): CitationResult {
  const quote = `“${text.trim().replace(/^["“]|["”]$/g, "")}”`;
  const cite = parenthetical(resource, location, style);
  const bibleEntry = resource.kind === "bible" && !includeBibleEntry;
  const formatted = bibleEntry ? { text: "", html: "" } : formatReference(resource, style);
  const reference = formatted.text;
  const plain = [quote, cite, reference].filter(Boolean).join("\n\n");
  const safeQuote = quote
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeCite = cite.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = [
    `<p>${safeQuote} <span class="citation-parenthetical">${safeCite}</span></p>`,
    reference ? `<p class="citation-reference">${formatted.html || reference}</p>` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { quote, parenthetical: cite, reference, plain, html };
}

export function citationStyleLabel(style: CitationStyle) {
  return style === "apa" ? "APA 7ª ed." : style === "sbl" ? "SBL (Bíblico)" : "Chicago";
}
