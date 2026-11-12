import { EN_TRANSLATIONS } from "./i18n.en";

export type Language = "es" | "en";

let currentLanguage: Language = "es";

export function setI18nLanguage(language: Language) {
  currentLanguage = language;
  document.documentElement.lang = language;
}

export function getI18nLanguage() {
  return currentLanguage;
}

export function tr(spanish: string, english: string) {
  return currentLanguage === "es" ? spanish : english;
}

export const LANGUAGE_KEY = "teoamoxtli.ui-language.v1";


const SKIP_UI_SELECTOR = [
  ".verse-text",
  ".book-typeset-surface",
  ".epub-content",
  ".note-editor-content",
  ".slide-design",
  ".panel-content",
  ".assistant-message",
  ".rag-answer",
  ".sermon-editor",
  ".pbb-preview",
  ".search-hit-snippet",
  "[contenteditable='true']",
  "script",
  "style",
  "textarea",
].join(",");

const DYNAMIC_TRANSLATIONS: Array<[RegExp, string]> = [
  [/^(\d[\d.,]*)\s+recursos?$/i, "$1 resources"],
  [/^(\d[\d.,]*)\s+entradas?$/i, "$1 entries"],
  [/^(\d[\d.,]*)\s+versículos?$/i, "$1 verses"],
  [/^(\d[\d.,]*)\s+respondidas?\s*·\s*(\d[\d.,]*)\s+totales?$/i, "$1 answered · $2 total"],
  [/^(\d[\d.,]*)\s+respuestas?$/i, "$1 answers"],
  [/^(\d[\d.,]*)\s+oraciones?$/i, "$1 prayers"],
  [/^(\d[\d.,]*)\s+respondidas$/i, "$1 answered"],
  [/^(\d[\d.,]*)\s+totales$/i, "$1 total"],
  [/^\+ Add sentence$/i, "+ Add prayer"],
  [/^(\d[\d.,]*)\s+libros?$/i, "$1 books"],
  [/^(\d[\d.,]*)\s+resultados?$/i, "$1 results"],
  [/^Copiar con cita (.+)$/i, "Copy with $1 citation"],
  [/^Página (\d+) de (\d+)$/i, "Page $1 of $2"],
];

function lookupTranslation(source: string): string | undefined {
  const normalized = source.replace(/\s+/g, " ").trim();
  const exact = EN_TRANSLATIONS[source] ?? EN_TRANSLATIONS[normalized];
  if (exact) return exact;
  for (const [pattern, replacement] of DYNAMIC_TRANSLATIONS) {
    if (pattern.test(source)) return source.replace(pattern, replacement);
  }
  return undefined;
}

function isSkipped(element: Element | null) {
  return Boolean(element?.closest(SKIP_UI_SELECTOR));
}

function translateTextNode(node: Text) {
  const raw = node.nodeValue;
  if (!raw || !raw.trim()) return;
  if (isSkipped(node.parentElement)) return;
  const leading = raw.match(/^\s*/)?.[0] ?? "";
  const trailing = raw.match(/\s*$/)?.[0] ?? "";
  const body = raw.trim();
  const translated = lookupTranslation(body);
  if (!translated || translated === body) return;
  node.nodeValue = `${leading}${translated}${trailing}`;
}

function translateElementAttributes(element: Element) {
  if (isSkipped(element)) return;
  for (const attribute of ["placeholder", "title", "aria-label", "alt"]) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const translated = lookupTranslation(value);
    if (translated && translated !== value) {
      element.setAttribute(attribute, translated);
    }
  }
  if (
    element instanceof HTMLInputElement &&
    element.type === "text" &&
    element.value &&
    element.value.length < 80 &&
    !element.dataset.userValue
  ) {
    const translated = lookupTranslation(element.value);
    if (translated && translated !== element.value) {
      element.value = translated;
    }
  }
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text);
    return;
  }
  if (!(root instanceof Element) && !(root instanceof DocumentFragment)) return;
  if (root instanceof Element) translateElementAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    translateTextNode(node as Text);
    node = walker.nextNode();
  }
  if (root instanceof Element) {
    root.querySelectorAll("*").forEach(translateElementAttributes);
  }
}

let englishObserver: MutationObserver | null = null;

export function applyEnglishDomTranslations() {
  if (typeof document === "undefined" || currentLanguage !== "en") return;
  translateTree(document.body);
  if (englishObserver) englishObserver.disconnect();
  englishObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) {
        translateTextNode(mutation.target as Text);
      }
      mutation.addedNodes.forEach((added) => translateTree(added));
    }
  });
  englishObserver.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}
