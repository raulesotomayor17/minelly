import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { processBookChapterHtml } from "./bookProcessor";
import { flattenToc } from "./vendor/foliate-js/toc.js";
import { Overlayer } from "./vendor/foliate-js/overlayer.js";
import ModuleEmblem from "./ModuleEmblem";

const EREADER_THEMES = [
  { id: "inherit", label: "Tema actual", bg: "", fg: "" },
  { id: "white", label: "Blanco papel", bg: "#ffffff", fg: "#111827" },
  { id: "cream", label: "Crema editorial", bg: "#fbf7ee", fg: "#251f1a" },
  { id: "sepia", label: "Sepia clásico", bg: "#f4ecd8", fg: "#2b2118" },
  { id: "sand", label: "Arena papel", bg: "#f4efe6", fg: "#231b18" },
  { id: "sage", label: "Verde salvia", bg: "#eff5f1", fg: "#11221a" },
  { id: "blue", label: "Azul sereno", bg: "#eef2f6", fg: "#0f172a" },
  { id: "slate", label: "Pizarra noche", bg: "#1c1c1f", fg: "#f4f4f5" },
  { id: "oled", label: "Negro OLED", bg: "#000000", fg: "#f5f5f5" },
] as const;

const EREADER_FONTS = [
  { value: "Literata", label: "Literata" },
  { value: "Crimson Pro", label: "Crimson Pro" },
  { value: "Cormorant Garamond", label: "Cormorant" },
  { value: "Libre Baskerville", label: "Baskerville" },
  { value: "Georgia", label: "Georgia" },
  { value: "Inter", label: "Inter" },
] as const;

const PREFS_KEY = "minelly.ereader-prefs.v1";
const LOCATIONS_KEY = "minelly.ereader-locations.v1";
const BOOKMARKS_KEY = "minelly.ereader-bookmarks.v1";
const NOTES_KEY = "minelly.ereader-notes.v1";
const HIGHLIGHTS_KEY = "minelly.ereader-highlights.v1";

const HIGHLIGHT_COLORS = ["#f5d36b", "#86efac", "#93c5fd", "#f9a8d4", "#fdba74"];

type EreaderPanel = "library" | "toc" | "search" | "notes" | "bookmarks" | "highlights";

const PANEL_LABEL: Record<EreaderPanel, string> = {
  library: "Biblioteca",
  toc: "Índice",
  search: "Buscar",
  notes: "Notas",
  bookmarks: "Marcadores",
  highlights: "Resaltados",
};

const PANEL_ORDER: EreaderPanel[] = [
  "library",
  "toc",
  "search",
  "notes",
  "bookmarks",
  "highlights",
];

interface EreaderContext {
  path: string;
  title: string;
  spine: number;
  resourceId?: string;
  fraction?: number;
}

interface Props {
  embedded?: boolean;
  initialPath?: string;
  initialTitle?: string;
  resources?: Array<{ id: string; title: string; kind: string; sourceFormat?: string; sourcePath?: string }>;
  onClose: () => void;
  onOpenScripture?: (book: number, chapter: number, verse: number, label: string, x: number, y: number) => void;
  onContextChange?: (context: EreaderContext) => void;
}

interface SearchExcerpt {
  pre: string;
  match: string;
  post: string;
}

interface SearchGroup {
  label: string;
  items: Array<{ cfi: string; excerpt: SearchExcerpt }>;
}

interface StoredLocation {
  cfi?: string;
  fraction?: number;
  title?: string;
}

interface EreaderPrefs {
  theme: string;
  font: string;
  fontSize: number;
}

interface SelectionState {
  text: string;
  x: number;
  y: number;
  bottom: number;
}

function loadPrefs(): EreaderPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<EreaderPrefs>;
    const theme = EREADER_THEMES.some((item) => item.id === parsed.theme)
      ? String(parsed.theme)
      : "inherit";
    const font = EREADER_FONTS.some((item) => item.value === parsed.font)
      ? String(parsed.font)
      : "Literata";
    const size = Number(parsed.fontSize);
    return {
      theme,
      font,
      fontSize: Number.isFinite(size) ? Math.min(1.8, Math.max(0.75, size)) : 1,
    };
  } catch {
    return { theme: "inherit", font: "Literata", fontSize: 1 };
  }
}

function loadStoredLocations(): Record<string, StoredLocation> {
  try {
    return JSON.parse(localStorage.getItem(LOCATIONS_KEY) ?? "{}") as Record<string, StoredLocation>;
  } catch {
    return {};
  }
}

function readCollection<T>(key: string): Record<string, T[]> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, T[]>;
  } catch {
    return {};
  }
}

/** Resuelve el brillo de un color hex/rgb para elegir enlaces legibles. */
function isDarkColor(color: string): boolean {
  const value = color.trim();
  let r = 0;
  let g = 0;
  let b = 0;
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3
      ? hex[1].split("").map((char) => char + char).join("")
      : hex[1];
    r = parseInt(digits.slice(0, 2), 16);
    g = parseInt(digits.slice(2, 4), 16);
    b = parseInt(digits.slice(4, 6), 16);
  } else {
    const numbers = value.match(/[\d.]+/g);
    if (!numbers || numbers.length < 3) return true;
    [r, g, b] = numbers.slice(0, 3).map(Number);
  }
  const linear = (channel: number) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) < 0.42;
}

/**
 * Las fuentes de la app viven en el documento principal y no entran solas al
 * iframe de foliate. Copiamos sus @font-face al documento del libro.
 */
function collectFontFaces(families: string[]): string {
  const wanted = new Set(families.map((family) => family.toLowerCase()));
  const faces: string[] = [];
  const sheets = Array.from(document.styleSheets);
  for (const sheet of sheets) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const fontFace = rule as CSSFontFaceRule;
      const family = fontFace.style.fontFamily.replace(/["']/g, "").trim().toLowerCase();
      if (!wanted.has(family)) continue;
      const css = fontFace.cssText.replace(
        /url\((['"]?)([^)'"]+)\1\)/g,
        (match, _quote: string, url: string) => {
          if (/^(data:|blob:|https?:)/i.test(url)) return match;
          try {
            return `url("${new URL(url, document.baseURI).href}")`;
          } catch {
            return match;
          }
        },
      );
      faces.push(css);
    }
  }
  return faces.join("\n");
}

export default function EreaderWorkspace({
  embedded = false,
  initialPath,
  initialTitle,
  resources = [],
  onClose,
  onOpenScripture,
  onContextChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<any>(null);
  const [initialPrefs] = useState(loadPrefs);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [currentPath, setCurrentPath] = useState("");
  const [toc, setToc] = useState<Array<{ label: string; href: string; depth: number }>>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panel, setPanel] = useState<EreaderPanel>(initialPath ? "toc" : "library");
  const [fraction, setFraction] = useState(0);
  const [chapterLabel, setChapterLabel] = useState("");
  const [theme, setTheme] = useState(initialPrefs.theme);
  const [font, setFont] = useState(initialPrefs.font);
  const [fontSize, setFontSize] = useState(initialPrefs.fontSize);
  const [loading, setLoading] = useState(Boolean(initialPath));
  const [error, setError] = useState("");
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [bookmarks, setBookmarks] = useState<Array<{ cfi: string; label: string; fraction: number }>>([]);
  const [notes, setNotes] = useState<Array<{ title: string; text: string }>>([]);
  const [highlights, setHighlights] = useState<Array<{ cfi: string; color: string }>>([]);
  const [storedLocations, setStoredLocations] = useState<Record<string, StoredLocation>>(
    loadStoredLocations,
  );
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchGroups, setSearchGroups] = useState<SearchGroup[]>([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [searchError, setSearchError] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTokenRef = useRef(0);
  const contextSpineRef = useRef(-1);
  const importedResourceIdRef = useRef<string | undefined>(undefined);
  const selectionRangeRef = useRef<Range | null>(null);
  const currentLocationRef = useRef<{ cfi?: string; fraction?: number }>({});
  const [fullscreen, setFullscreen] = useState(false);
  const styleRef = useRef({ theme, font, fontSize });
  const fontFacesRef = useRef("");
  const loadingPathRef = useRef("");

  // El listener de `load` de foliate se registra una sola vez; las refs evitan
  // que las secciones nuevas hereden el tema/tipografía iniciales.
  styleRef.current = { theme, font, fontSize };

  function fontFacesCss() {
    if (!fontFacesRef.current) {
      fontFacesRef.current = collectFontFaces(EREADER_FONTS.map((item) => item.value));
    }
    return fontFacesRef.current;
  }

  function applyReaderStyle(doc: Document) {
    if (!doc?.documentElement || !doc.head) return;
    const current = styleRef.current;
    const chosen = EREADER_THEMES.find((item) => item.id === current.theme) ?? EREADER_THEMES[0];
    const root = getComputedStyle(document.documentElement);
    const bg = chosen.bg || root.getPropertyValue("--bg-canvas").trim() || "#ffffff";
    const fg = chosen.fg || root.getPropertyValue("--text-primary").trim() || "#111827";
    const dark = isDarkColor(bg);
    const link = dark ? "#8ab4f8" : "#1d6fd8";
    const basePx = Math.round(17 * current.fontSize);
    let style = doc.getElementById("minelly-ereader-style") as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = "minelly-ereader-style";
      doc.head.appendChild(style);
    }
    style.textContent = `${fontFacesCss()}
      html, body { background: ${bg} !important; color: ${fg} !important; }
      html { font-size: ${basePx}px !important; color-scheme: ${dark ? "dark" : "light"}; }
      body {
        min-height: 100%;
        margin: 0;
        font-family: "${current.font}", Georgia, serif !important;
        font-size: 1rem !important;
        line-height: 1.68 !important;
        padding: 0 3% !important;
      }
      body :is(p, li, blockquote, td, th) {
        font-size: 1rem !important;
        line-height: 1.68 !important;
      }
      h1 { font-size: 1.75rem !important; line-height: 1.25 !important; }
      h2 { font-size: 1.4rem !important; line-height: 1.3 !important; }
      h3 { font-size: 1.18rem !important; }
      h4 { font-size: 1.04rem !important; }
      p { orphans: 2; widows: 2; }
      img, svg { max-width: 100% !important; height: auto !important; }
      a { color: inherit !important; }
      a.scripture-ref-link {
        color: ${link} !important;
        text-decoration: underline !important;
        text-underline-offset: 2px;
        cursor: pointer !important;
      }
      ::selection { background: ${dark ? "rgba(138,180,248,.32)" : "rgba(29,111,216,.18)"}; }
    `;
    doc.documentElement.style.background = bg;
    doc.documentElement.style.color = fg;
    if (doc.body) doc.body.style.color = fg;
  }

  function reportContext(filePath: string, displayName: string) {
    const contents = viewRef.current?.renderer?.getContents?.() ?? [];
    const spine = Number(contents[0]?.index ?? 0);
    if (spine === contextSpineRef.current) return;
    contextSpineRef.current = spine;
    const resource = resources.find((item) => item.sourcePath === filePath);
    onContextChange?.({
      path: filePath,
      title: displayName,
      spine,
      resourceId: resource?.id ?? importedResourceIdRef.current,
      fraction: currentLocationRef.current.fraction ?? 0,
    });
  }

  async function runSearch(rawQuery: string) {
    const view = viewRef.current;
    if (!view?.search) return;
    const query = rawQuery.trim();
    const token = searchTokenRef.current + 1;
    searchTokenRef.current = token;
    setSearching(true);
    setSearchProgress(0);
    setSearchError("");
    setSearchGroups([]);
    try {
      view.clearSearch?.();
      const groups: SearchGroup[] = [];
      for await (const result of view.search({
        query,
        draw: Overlayer.highlight,
        drawOptions: { color: "#f5d36b" },
      })) {
        if (searchTokenRef.current !== token) return;
        if (result === "done") break;
        if (typeof result?.progress === "number") {
          setSearchProgress(result.progress);
          continue;
        }
        if (Array.isArray(result?.subitems)) {
          groups.push({
            label: result.label || "Resultados",
            items: result.subitems.map((item: any) => ({
              cfi: item.cfi,
              excerpt: item.excerpt,
            })),
          });
          setSearchGroups([...groups]);
        }
      }
      setSearchedQuery(query);
    } catch (searchIssue) {
      if (searchTokenRef.current === token) setSearchError(String(searchIssue));
    } finally {
      if (searchTokenRef.current === token) setSearching(false);
    }
  }

  function clearSearch() {
    searchTokenRef.current += 1;
    viewRef.current?.clearSearch?.();
    setSearchQuery("");
    setSearchGroups([]);
    setSearchedQuery("");
    setSearchError("");
    setSearching(false);
    setSearchProgress(0);
  }

  async function loadFile(filePath: string, displayTitle?: string) {
    setError("");
    setLoading(true);
    loadingPathRef.current = filePath;
    setSelection(null);
    selectionRangeRef.current = null;
    contextSpineRef.current = -1;
    importedResourceIdRef.current = undefined;
    setSearchQuery("");
    setSearchGroups([]);
    setSearchedQuery("");
    setSearchError("");
    setSearching(false);
    try {
      try {
        viewRef.current?.close?.();
      } catch {
        /* la vista anterior ya no está disponible */
      }
      viewRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = "";
      const reports = await invoke<Array<{ resource?: { id?: string } }>>("import_folder", {
        path: filePath,
      }).catch(() => []);
      importedResourceIdRef.current = reports?.find((report) => report.resource?.id)?.resource?.id;
      const bytes = await invoke<number[]>("read_file_bytes", { path: filePath });
      const name = filePath.split(/[\\/]/).pop() || "ebook.epub";
      const file = new File([new Uint8Array(bytes)], name);
      const { View, makeBook } = await import("./vendor/foliate-js/view.js");
      const book = await makeBook(file);
      const view = new View();
      viewRef.current = view;
      if (hostRef.current) {
        hostRef.current.innerHTML = "";
        hostRef.current.appendChild(view);
      }
      view.addEventListener("load", (event: any) => {
        const doc = event.detail?.doc as Document | undefined;
        if (!doc) return;
        try {
          const processed = processBookChapterHtml(doc.body.innerHTML);
          doc.body.innerHTML = processed.html;
        } catch {
          /* conservar el DOM original */
        }
        applyReaderStyle(doc);
        doc.addEventListener("mouseup", () => {
          const sel = doc.getSelection();
          if (!sel || sel.isCollapsed || !sel.rangeCount) {
            setSelection(null);
            selectionRangeRef.current = null;
            return;
          }
          const text = sel.toString().trim();
          if (!text) {
            setSelection(null);
            selectionRangeRef.current = null;
            return;
          }
          selectionRangeRef.current = sel.getRangeAt(0).cloneRange();
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          const host = hostRef.current?.getBoundingClientRect();
          setSelection({
            text,
            x: (host?.left ?? 0) + rect.left,
            y: (host?.top ?? 0) + rect.bottom + 6,
            bottom: (host?.top ?? 0) + rect.bottom,
          });
        });
        doc.addEventListener("click", (clickEvent: MouseEvent) => {
          const target = clickEvent.target as HTMLElement | null;
          const link = target?.closest?.("a.scripture-ref-link") as HTMLElement | null;
          if (!link) return;
          clickEvent.preventDefault();
          clickEvent.stopImmediatePropagation();
          setSelection(null);
          selectionRangeRef.current = null;
          onOpenScripture?.(
            Number(link.dataset.book || 0),
            Number(link.dataset.chapter || 1),
            Number(link.dataset.verse || 1),
            link.dataset.label || link.textContent || "",
            clickEvent.clientX + (hostRef.current?.getBoundingClientRect().left ?? 0),
            clickEvent.clientY + (hostRef.current?.getBoundingClientRect().top ?? 0),
          );
        }, true);
      });
      view.addEventListener("relocate", (event: any) => {
        const detail = event.detail ?? {};
        const nextFraction = Number(detail.fraction ?? 0);
        const nextLocation: StoredLocation = {
          cfi: detail.cfi,
          fraction: nextFraction,
          title: displayTitle || name,
        };
        currentLocationRef.current = { cfi: detail.cfi, fraction: nextFraction };
        setFraction(nextFraction);
        setChapterLabel(
          typeof detail.tocItem?.label === "string" ? detail.tocItem.label : "",
        );
        reportContext(filePath, displayTitle || name);
        setStoredLocations((current) => {
          const next = { ...current, [filePath]: nextLocation };
          try {
            localStorage.setItem(LOCATIONS_KEY, JSON.stringify(next));
          } catch {
            /* almacenamiento no disponible */
          }
          return next;
        });
      });
      view.addEventListener("create-overlay", (event: any) => {
        const index = Number(event.detail?.index ?? -1);
        const visual = readCollection<{ cfi: string; color: string }>(HIGHLIGHTS_KEY)[filePath] ?? [];
        for (const highlight of visual) {
          const resolved = view.resolveCFI?.(highlight.cfi);
          if (resolved?.index === index) {
            void view.addAnnotation({ value: highlight.cfi, color: highlight.color });
          }
        }
      });
      view.addEventListener("draw-annotation", (event: any) => {
        event.detail.draw(Overlayer.highlight, {
          color: event.detail.annotation?.color ?? "#f5d36b",
        });
      });
      await view.open(book);
      requestAnimationFrame(() => view.renderer?.expand?.());
      document.title = displayTitle || book.metadata?.title || name;
      setTitle(displayTitle || book.metadata?.title || name);
      setCurrentPath(filePath);
      setToc(flattenToc(book.toc ?? []));
      setPanel("toc");
      setBookmarks(
        readCollection<{ cfi: string; label: string; fraction: number }>(BOOKMARKS_KEY)[filePath] ?? [],
      );
      setNotes(readCollection<{ title: string; text: string }>(NOTES_KEY)[filePath] ?? []);
      setHighlights(
        readCollection<{ cfi: string; color: string }>(HIGHLIGHTS_KEY)[filePath] ?? [],
      );
      const saved = storedLocations[filePath];
      const savedFraction = Number(saved?.fraction ?? 0);
      if (saved?.cfi && savedFraction < 0.95) {
        await view.goTo(saved.cfi);
        const landed = Number(view.lastLocation?.fraction ?? 0);
        if (
          savedFraction > 0.02 &&
          Math.abs(landed - savedFraction) > 0.08 &&
          typeof view.goToFraction === "function"
        ) {
          await view.goToFraction(savedFraction);
        }
      } else if (
        savedFraction > 0.02 &&
        savedFraction < 0.95 &&
        typeof view.goToFraction === "function"
      ) {
        await view.goToFraction(savedFraction);
      } else {
        await view.goToTextStart?.();
      }
      requestAnimationFrame(() => view.renderer?.expand?.());
      reportContext(filePath, displayTitle || name);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const contents = viewRef.current?.renderer?.getContents?.() ?? [];
    for (const item of contents) if (item.doc) applyReaderStyle(item.doc);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ theme, font, fontSize }));
    } catch {
      /* almacenamiento no disponible */
    }
    // `applyReaderStyle` lee los valores actuales de styleRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, font, fontSize]);

  useEffect(() => {
    if (initialPath) void loadFile(initialPath, initialTitle);
    return () => {
      try {
        viewRef.current?.close?.();
      } catch {
        /* noop */
      }
    };
    // El archivo inicial solo se carga al montar o al cambiar de libro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setPanel("search");
        setPanelOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag ?? "")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        turnPage("next");
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        turnPage("prev");
      }
      if (event.key === "Escape") {
        if (selection) setSelection(null);
        else if (panelOpen) setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, selection]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchGroups([]);
      setSearchedQuery("");
      setSearchError("");
      setSearching(false);
      viewRef.current?.clearSearch?.();
      return;
    }
    const timer = window.setTimeout(() => void runSearch(query), 320);
    return () => window.clearTimeout(timer);
    // La búsqueda sigue en segundo plano al cerrar el panel; al reabrirlo se
    // muestran los resultados ya recopilados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, currentPath]);

  useEffect(() => {
    if (panel === "search" && panelOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [panel, panelOpen]);

  function turnPage(direction: "next" | "prev") {
    setSelection(null);
    selectionRangeRef.current = null;
    if (direction === "next") void viewRef.current?.next();
    else void viewRef.current?.prev();
  }

  function togglePanel(next: EreaderPanel) {
    if (panelOpen && panel === next) {
      setPanelOpen(false);
      return;
    }
    setPanel(next);
    setPanelOpen(true);
  }

  function addBookmark() {
    const cfi = currentLocationRef.current.cfi;
    if (!cfi) return;
    const entry = {
      cfi,
      label: `${chapterLabel ? `${chapterLabel} · ` : ""}${Math.round(fraction * 100)}%`,
      fraction,
    };
    const next = [...bookmarks, entry];
    setBookmarks(next);
    const all = readCollection<{ cfi: string; label: string; fraction: number }>(BOOKMARKS_KEY);
    all[currentPath || "externo"] = next;
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(all));
    } catch {
      /* almacenamiento no disponible */
    }
  }

  function deleteBookmark(index: number) {
    setBookmarks((current) => {
      const next = current.filter((_, position) => position !== index);
      const all = readCollection<{ cfi: string; label: string; fraction: number }>(BOOKMARKS_KEY);
      all[currentPath || "externo"] = next;
      try {
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(all));
      } catch {
        /* almacenamiento no disponible */
      }
      return next;
    });
  }

  async function copySelection() {
    const text = selection?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setSelection(null);
    } catch (copyError) {
      setError(String(copyError));
    }
  }

  async function addNote() {
    const text = selection?.text || "";
    if (!text) return;
    const body = window.prompt("Nota sobre la selección", text);
    if (!body) return;
    try {
      await invoke("note_create", {
        input: {
          notebookId: null,
          title: body.slice(0, 80),
          contentJson: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
          },
          tags: ["eReader"],
          anchors: [
            {
              anchorUri: `minelly://ereader?cfi=${encodeURIComponent(currentLocationRef.current.cfi ?? "")}&text=${encodeURIComponent(text.slice(0, 120))}`,
              exactText: text,
              startOffset: 0,
              endOffset: text.length,
            },
          ],
        },
      });
      const next = [...notes, { title: body.slice(0, 60), text }];
      setNotes(next);
      const all = readCollection<{ title: string; text: string }>(NOTES_KEY);
      all[currentPath || "externo"] = next;
      try {
        localStorage.setItem(NOTES_KEY, JSON.stringify(all));
      } catch {
        /* almacenamiento no disponible */
      }
      setSelection(null);
    } catch (noteError) {
      setError(String(noteError));
    }
  }

  function highlightSelection() {
    const range = selectionRangeRef.current;
    const view = viewRef.current;
    if (!range || !view) return;
    try {
      const contents = view.renderer.getContents();
      const content = contents.find((item: any) => item.doc === range.startContainer.ownerDocument) ?? contents[0];
      if (!content) return;
      const cfi = view.getCFI(content.index, range);
      const highlight = { cfi, color: highlightColor };
      const next = [...highlights, highlight];
      setHighlights(next);
      const all = readCollection<{ cfi: string; color: string }>(HIGHLIGHTS_KEY);
      all[currentPath || "externo"] = next;
      try {
        localStorage.setItem(HIGHLIGHTS_KEY, JSON.stringify(all));
      } catch {
        /* almacenamiento no disponible */
      }
      void view.addAnnotation({ value: cfi, color: highlight.color });
      setSelection(null);
    } catch (highlightError) {
      setError(String(highlightError));
    }
  }

  function deleteHighlight(cfi: string) {
    setHighlights((current) => {
      const next = current.filter((item) => item.cfi !== cfi);
      const all = readCollection<{ cfi: string; color: string }>(HIGHLIGHTS_KEY);
      all[currentPath || "externo"] = next;
      try {
        localStorage.setItem(HIGHLIGHTS_KEY, JSON.stringify(all));
      } catch {
        /* almacenamiento no disponible */
      }
      return next;
    });
    void viewRef.current?.deleteAnnotation?.({ value: cfi });
  }

  async function toggleFullscreen() {
    try {
      await getCurrentWindow().setFullscreen(!fullscreen);
      setFullscreen((value) => !value);
    } catch (fullscreenError) {
      setError(String(fullscreenError));
    }
  }

  async function pickFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "eBooks", extensions: ["epub", "mobi", "azw3", "fb2"] }],
    });
    if (typeof selected === "string") await loadFile(selected);
  }

  const libraryBooks = useMemo(
    () =>
      resources.filter(
        (resource) =>
          resource.kind === "book" &&
          resource.sourcePath &&
          !["esword", "mysword", "pbb"].includes((resource.sourceFormat ?? "").toLowerCase()) &&
          /\.(epub|mobi|azw3|fb2|pdf)$/i.test(resource.sourcePath),
      ),
    [resources],
  );

  const currentTheme = EREADER_THEMES.find((item) => item.id === theme) ?? EREADER_THEMES[0];
  const pageBackground = currentTheme.bg || "var(--bg-canvas)";
  const percent = Math.round(fraction * 100);
  const searchCount = searchGroups.reduce((sum, group) => sum + group.items.length, 0);
  const activeCount =
    panel === "search"
      ? searchCount
      : panel === "notes"
      ? notes.length
      : panel === "bookmarks"
        ? bookmarks.length
        : panel === "highlights"
          ? highlights.length
          : panel === "toc"
            ? toc.length
            : libraryBooks.length;
  const selectionLeft = selection
    ? Math.min(Math.max(10, selection.x - 24), Math.max(10, window.innerWidth - 560))
    : 0;
  const selectionTop = selection
    ? (selection.y + 64 > window.innerHeight ? selection.bottom - 68 : selection.y)
    : 0;

  return (
    <section
      className={`ereader-workspace${embedded ? " embedded" : ""}`}
      style={
        {
          "--ereader-font": `"${font}", Georgia, serif`,
          "--ereader-scale": fontSize,
          "--ereader-page-bg": pageBackground,
        } as CSSProperties
      }
    >
      <header className="ereader-toolbar">
        <div className="ereader-title">
          <span className="module-emblem ereader">
            <ModuleEmblem id="ereader" size={20} />
          </span>
          <div className="ereader-title-copy">
            <span className="eyebrow">Lector independiente</span>
            <h1>{currentPath ? `eReader · ${title}` : "eReader"}</h1>
            <span className="ereader-title-meta">
              {currentPath
                ? `${chapterLabel || "Lectura"} · ${percent}%`
                : `${libraryBooks.length} ${libraryBooks.length === 1 ? "eBook" : "eBooks"} en la biblioteca`}
            </span>
          </div>
        </div>

        <div className="ereader-actions">
          <div className="ereader-action-group">
            <button
              type="button"
              onClick={() => void pickFile()}
              disabled={loading}
              title="Abrir un archivo eBook (EPUB, MOBI, AZW3, FB2)"
            >
              Abrir
            </button>
            <button
              type="button"
              className={panelOpen && panel === "library" ? "active" : ""}
              aria-pressed={panelOpen && panel === "library"}
              onClick={() => togglePanel("library")}
              disabled={!currentPath}
              title="Biblioteca de eBooks"
            >
              Biblioteca
            </button>
            <button
              type="button"
              className={panelOpen && panel === "toc" ? "active" : ""}
              aria-pressed={panelOpen && panel === "toc"}
              onClick={() => togglePanel("toc")}
              disabled={!currentPath}
              title="Índice del libro"
            >
              Índice
            </button>
            <button
              type="button"
              className={panelOpen && panel === "search" ? "active" : ""}
              aria-pressed={panelOpen && panel === "search"}
              onClick={() => togglePanel("search")}
              disabled={!currentPath}
              title="Buscar en el libro (Ctrl+F)"
              aria-label="Buscar en el libro"
            >
              Buscar
            </button>
          </div>

          <div className="ereader-action-group" role="group" aria-label="Navegación de páginas">
            <button
              type="button"
              onClick={() => turnPage("prev")}
              aria-label="Página anterior"
              title="Página anterior (←)"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => turnPage("next")}
              aria-label="Página siguiente"
              title="Página siguiente (→)"
            >
              ›
            </button>
          </div>

          <div className="ereader-action-group ereader-typography">
            <label className="ereader-select" title="Tema de lectura">
              <span className="ereader-select-label">Tema</span>
              <select
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
                aria-label="Tema de lectura"
              >
                {EREADER_THEMES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ereader-select" title="Tipografía de lectura">
              <span className="ereader-select-label">Fuente</span>
              <select
                value={font}
                onChange={(event) => setFont(event.target.value)}
                aria-label="Tipografía de lectura"
              >
                {EREADER_FONTS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setFontSize((value) => Math.max(0.75, value - 0.1))}
              aria-label="Reducir tamaño de letra"
              title="Reducir letra"
            >
              A−
            </button>
            <button
              type="button"
              onClick={() => setFontSize((value) => Math.min(1.8, value + 0.1))}
              aria-label="Aumentar tamaño de letra"
              title="Aumentar letra"
            >
              A+
            </button>
            <span className="ereader-font-value" aria-hidden="true">
              {Math.round(fontSize * 100)}%
            </span>
          </div>

          <div className="ereader-action-group">
            <button
              type="button"
              onClick={addBookmark}
              disabled={!currentPath}
              title="Marcar esta página"
              aria-label="Marcar esta página"
            >
              Marcador
            </button>
            <button
              type="button"
              onClick={() => void addNote()}
              disabled={!selection}
              title={selection ? "Crear una nota con la selección" : "Selecciona texto para crear una nota"}
            >
              Nota
            </button>
            {!embedded && (
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                title="Pantalla completa"
                aria-label="Pantalla completa"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            {!embedded && (
              <button
                type="button"
                className="ereader-close"
                onClick={onClose}
                title="Cerrar el eReader"
              >
                Cerrar
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="ereader-body">
        {panelOpen && currentPath && (
          <aside className="ereader-panel" aria-label="Panel del eReader">
            <div className="ereader-panel-head">
              <div>
                <span className="eyebrow">Navegación</span>
                <strong>{PANEL_LABEL[panel]}</strong>
              </div>
              <button
                type="button"
                className="ereader-panel-close"
                onClick={() => setPanelOpen(false)}
                aria-label="Cerrar el panel"
                title="Cerrar el panel"
              >
                ×
              </button>
            </div>

            <div className="ereader-panel-tabs" role="group" aria-label="Secciones del panel">
              {PANEL_ORDER.map((item) => {
                const count =
                  item === "search"
                    ? searchCount
                    : item === "notes"
                      ? notes.length
                      : item === "bookmarks"
                        ? bookmarks.length
                        : item === "highlights"
                          ? highlights.length
                          : item === "toc"
                            ? toc.length
                            : libraryBooks.length;
                return (
                  <button
                    key={item}
                    type="button"
                    className={panel === item ? "active" : ""}
                    aria-pressed={panel === item}
                    onClick={() => setPanel(item)}
                  >
                    {PANEL_LABEL[item]}
                    <span className="ereader-tab-count">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="ereader-panel-body" aria-live="polite">
              {panel !== "search" && (
                <div className="ereader-panel-summary">
                  {activeCount} {activeCount === 1 ? "elemento" : "elementos"}
                </div>
              )}

              {panel === "search" && (
                <div className="ereader-search-panel">
                  <label className="ereader-search-box">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Buscar en el libro…"
                      aria-label="Buscar en el libro"
                      spellCheck={false}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={clearSearch}
                        aria-label="Limpiar la búsqueda"
                        title="Limpiar la búsqueda"
                      >
                        ×
                      </button>
                    )}
                  </label>
                  <div className="ereader-search-meta">
                    {searching
                      ? `Buscando… ${Math.round(searchProgress * 100)}%`
                      : searchedQuery
                        ? `${searchCount} ${searchCount === 1 ? "resultado" : "resultados"} · «${searchedQuery}»`
                        : "Escribe al menos dos letras. No distingue mayúsculas ni acentos."}
                  </div>
                  {searching && (
                    <div className="ereader-search-progress" aria-hidden="true">
                      <span style={{ width: `${Math.round(searchProgress * 100)}%` }} />
                    </div>
                  )}
                  {searchError && <div className="ereader-search-error">{searchError}</div>}
                  {searchGroups.map((group, groupIndex) => (
                    <div className="ereader-search-group" key={`${group.label}-${groupIndex}`}>
                      {group.label && (
                        <div className="ereader-search-group-label" title={group.label}>
                          {group.label}
                        </div>
                      )}
                      {group.items.map((item, itemIndex) => (
                        <button
                          key={`${item.cfi}-${itemIndex}`}
                          type="button"
                          className="ereader-search-hit"
                          onClick={() => {
                            void viewRef.current?.goTo(item.cfi);
                            setPanelOpen(false);
                          }}
                          title={item.excerpt.match}
                        >
                          <span className="ereader-search-excerpt">
                            {item.excerpt.pre}
                            <mark>{item.excerpt.match}</mark>
                            {item.excerpt.post}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {!searching && searchedQuery && searchCount === 0 && !searchError && (
                    <p className="ereader-panel-empty">Sin coincidencias en este libro.</p>
                  )}
                </div>
              )}

              {panel === "library" && (
                <div className="ereader-library">
                  {libraryBooks.map((resource) => {
                    const saved = resource.sourcePath
                      ? storedLocations[resource.sourcePath]
                      : undefined;
                    const progress = saved?.fraction ? Math.round(saved.fraction * 100) : 0;
                    return (
                      <button
                        key={resource.id}
                        type="button"
                        className={`ereader-library-item${currentPath === resource.sourcePath ? " active" : ""}`}
                        onClick={() => {
                          setPanelOpen(false);
                          if (resource.sourcePath) {
                            void loadFile(resource.sourcePath, resource.title);
                          }
                        }}
                        title={resource.title}
                      >
                        <span className="ereader-library-item-title">{resource.title}</span>
                        <span className="ereader-library-item-meta">
                          <span className="ereader-library-format">
                            {resource.sourceFormat ?? "eBook"}
                          </span>
                          <span>{progress > 0 ? `${progress}% leído` : "Sin comenzar"}</span>
                        </span>
                      </button>
                    );
                  })}
                  {libraryBooks.length === 0 && (
                    <p className="ereader-panel-empty">
                      No hay eBooks importados compatibles. Abre un EPUB, MOBI, AZW3 o FB2.
                    </p>
                  )}
                </div>
              )}

              {panel === "toc" &&
                (toc.length > 0 ? (
                  <div className="ereader-toc-list">
                    {toc.map((item, index) => (
                      <button
                        key={`${item.href}-${index}`}
                        type="button"
                        className={`ereader-toc-item${chapterLabel === item.label ? " active" : ""}`}
                        style={{ paddingLeft: 8 + item.depth * 12 }}
                        onClick={() => {
                          setPanelOpen(false);
                          void viewRef.current?.goTo(item.href);
                        }}
                        aria-current={chapterLabel === item.label ? "location" : undefined}
                        title={item.label}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="ereader-panel-empty">Este libro no trae un índice navegable.</p>
                ))}

              {panel === "notes" &&
                (notes.length > 0 ? (
                  <div className="ereader-note-list">
                    {notes.map((note, index) => (
                      <article key={`${note.title}-${index}`} className="ereader-note">
                        <strong>{note.title}</strong>
                        <small>{note.text.slice(0, 140)}</small>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="ereader-panel-empty">
                    Aún no hay notas en este libro. Selecciona un fragmento y pulsa Nota.
                  </p>
                ))}

              {panel === "bookmarks" &&
                (bookmarks.length > 0 ? (
                  <div className="ereader-bookmark-list">
                    {bookmarks.map((bookmark, index) => (
                      <div key={`${bookmark.cfi}-${index}`} className="ereader-bookmark-row">
                        <button
                          type="button"
                          className="ereader-bookmark-main"
                          onClick={() => {
                            setPanelOpen(false);
                            void viewRef.current?.goTo(bookmark.cfi);
                          }}
                        >
                          <span className="ereader-bookmark-mark" aria-hidden="true">
                            ⚑
                          </span>
                          <span>{bookmark.label}</span>
                        </button>
                        <button
                          type="button"
                          className="ereader-row-delete"
                          onClick={() => deleteBookmark(index)}
                          aria-label={`Eliminar marcador ${bookmark.label}`}
                          title="Eliminar marcador"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="ereader-panel-empty">
                    Sin marcadores todavía. Pulsa Marcador para guardar la página actual.
                  </p>
                ))}

              {panel === "highlights" &&
                (highlights.length > 0 ? (
                  <div className="ereader-highlight-list">
                    {highlights.map((highlight, index) => (
                      <div key={`${highlight.cfi}-${index}`} className="ereader-highlight-row">
                        <i style={{ background: highlight.color }} aria-hidden="true" />
                        <button
                          type="button"
                          className="ereader-highlight-main"
                          onClick={() => {
                            setPanelOpen(false);
                            void viewRef.current?.goTo(highlight.cfi);
                          }}
                        >
                          Ir al resaltado
                        </button>
                        <button
                          type="button"
                          className="ereader-row-delete"
                          onClick={() => deleteHighlight(highlight.cfi)}
                          aria-label="Eliminar resaltado"
                          title="Eliminar resaltado"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="ereader-panel-empty">
                    Sin resaltados. Selecciona texto y elige un color para subrayarlo.
                  </p>
                ))}
            </div>
          </aside>
        )}

        <div ref={hostRef} className="ereader-view" />

        {!currentPath && !loading && (
          <div className="ereader-empty-library">
            <span className="module-emblem ereader ereader-empty-emblem">
              <ModuleEmblem id="ereader" size={34} />
            </span>
            <span className="eyebrow">Biblioteca local</span>
            <h2>Tu biblioteca de eBooks</h2>
            <p>
              {libraryBooks.length > 0
                ? "Elige un libro importado o abre un archivo nuevo para empezar a leer."
                : "Abre un EPUB, MOBI, AZW3 o FB2, o importa libros desde la biblioteca."}
            </p>
            {libraryBooks.length > 0 && (
              <div className="ereader-empty-grid">
                {libraryBooks.map((resource) => {
                  const saved = resource.sourcePath
                    ? storedLocations[resource.sourcePath]
                    : undefined;
                  const progress = saved?.fraction ? Math.round(saved.fraction * 100) : 0;
                  return (
                    <button
                      key={resource.id}
                      type="button"
                      className="ereader-empty-card"
                      onClick={() =>
                        resource.sourcePath && void loadFile(resource.sourcePath, resource.title)
                      }
                    >
                      <span className="ereader-empty-format">
                        {resource.sourceFormat ?? "eBook"}
                      </span>
                      <strong>{resource.title}</strong>
                      <small>{progress > 0 ? `${progress}% leído` : "Sin comenzar"}</small>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="ereader-empty-actions">
              <button type="button" className="ereader-empty-open" onClick={() => void pickFile()}>
                Abrir archivo eBook
              </button>
              <span>EPUB · MOBI · AZW3 · FB2</span>
            </div>
          </div>
        )}

        {loading && (
          <div className="ereader-loading" role="status" aria-live="polite">
            <span className="ereader-spinner" aria-hidden="true" />
            <strong>Preparando la lectura…</strong>
            <small>{loadingPathRef.current.split(/[\\/]/).pop()}</small>
          </div>
        )}

        {error && (
          <div className="ereader-error-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} aria-label="Descartar el aviso">
              ×
            </button>
          </div>
        )}
      </div>

      <footer className="ereader-footer">
        <span className="ereader-footer-chapter" title={chapterLabel || title}>
          {currentPath ? chapterLabel || title || "Lectura" : "Biblioteca"}
        </span>
        <input
          className="ereader-progress"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={Math.min(1, Math.max(0, fraction))}
          onChange={(event) => {
            const value = Number(event.target.value);
            setFraction(value);
            void viewRef.current?.goToFraction?.(value);
          }}
          aria-label="Progreso de lectura"
          disabled={!currentPath}
        />
        <span className="ereader-footer-percent">{percent}%</span>
      </footer>

      {selection && (
        <div
          className="ereader-selection-toolbar"
          style={{ left: selectionLeft, top: selectionTop }}
          role="toolbar"
          aria-label="Acciones sobre la selección"
        >
          <span className="ereader-selection-text" title={selection.text}>
            “{selection.text.slice(0, 48)}”
          </span>
          <span className="ereader-color-row">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={highlightColor === color ? "active" : ""}
                style={{ background: color }}
                onClick={() => setHighlightColor(color)}
                aria-label={`Color de resaltado ${color}`}
                title={`Resaltar en ${color}`}
              />
            ))}
          </span>
          <button type="button" onClick={highlightSelection}>
            Resaltar
          </button>
          <button type="button" onClick={() => void addNote()}>
            Nota
          </button>
          <button type="button" onClick={addBookmark}>
            Marcador
          </button>
          <button type="button" onClick={() => void copySelection()}>
            Copiar
          </button>
          <button
            type="button"
            className="ereader-selection-close"
            onClick={() => setSelection(null)}
            aria-label="Cerrar acciones de selección"
          >
            ×
          </button>
        </div>
      )}
    </section>
  );
}
