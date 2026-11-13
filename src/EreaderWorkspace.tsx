import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { processBookChapterHtml } from "./bookProcessor";
import { flattenToc } from "./vendor/foliate-js/toc.js";
import { Overlayer } from "./vendor/foliate-js/overlayer.js";

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

interface Props {
  embedded?: boolean;
  initialPath?: string;
  initialTitle?: string;
  onClose: () => void;
  onOpenScripture?: (book: number, chapter: number, verse: number, label: string, x: number, y: number) => void;
}

interface StoredLocation { cfi?: string; fraction?: number; title?: string }

export default function EreaderWorkspace({ embedded = false, initialPath, initialTitle, onClose, onOpenScripture }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<any>(null);
  const [title, setTitle] = useState(initialTitle ?? "eReader");
  const [currentPath, setCurrentPath] = useState(initialPath ?? "");
  const [toc, setToc] = useState<Array<{ label: string; href: string; depth: number }>>([]);
  const [tocOpen, setTocOpen] = useState(true);
  const [fraction, setFraction] = useState(0);
  const [theme, setTheme] = useState<string>("inherit");
  const [font, setFont] = useState("Literata");
  const [fontSize, setFontSize] = useState(1);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"toc" | "notes" | "bookmarks" | "highlights">("toc");
  const [highlightColor, setHighlightColor] = useState("#f5d36b");
  const HIGHLIGHT_COLORS = ["#f5d36b", "#86efac", "#93c5fd", "#f9a8d4", "#fdba74"];
  const [bookmarks, setBookmarks] = useState<Array<{ cfi: string; label: string; fraction: number }>>([]);
  const [notes, setNotes] = useState<Array<{ title: string; text: string }>>([]);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const currentLocationRef = useRef<{ cfi?: string; fraction?: number }>({});
  const [fullscreen, setFullscreen] = useState(false);
  const [highlights, setHighlights] = useState<Array<{ cfi: string; color: string }>>([]);

  const storedLocations = useMemo<Record<string, StoredLocation>>(() => {
    try { return JSON.parse(localStorage.getItem("minelly.ereader-locations.v1") ?? "{}"); } catch { return {}; }
  }, []);

  function applyReaderStyle(doc: Document) {
    const chosen = EREADER_THEMES.find((item) => item.id === theme) ?? EREADER_THEMES[0];
    const root = getComputedStyle(document.documentElement);
    const bg = chosen.bg || root.getPropertyValue("--bg-card").trim() || "#ffffff";
    const fg = chosen.fg || root.getPropertyValue("--text-primary").trim() || "#111827";
    let style = doc.getElementById("minelly-ereader-style") as HTMLStyleElement | null;
    if (!style) { style = doc.createElement("style"); style.id = "minelly-ereader-style"; doc.head.appendChild(style); }
    style.textContent = `html,body{background:${bg}!important;color:${fg}!important;} body{font-family:${getComputedStyle(document.documentElement).getPropertyValue("--ereader-font") || "Georgia, serif"}!important;font-size:${fontSize}em!important;line-height:1.65!important;} a{color:inherit!important;}`;
    doc.documentElement.style.background = bg;
    doc.body.style.color = fg;
  }

  async function loadFile(filePath: string, displayTitle?: string) {
    setError("");
    try {
      await invoke("import_folder", { path: filePath }).catch(() => undefined);
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
        } catch { /* conservar el DOM original */ }
        applyReaderStyle(doc);
        doc.addEventListener("mouseup", () => {
          const sel = doc.getSelection();
          if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelection(null); return; }
          const text = sel.toString().trim();
          if (!text) { setSelection(null); return; }
          selectionRangeRef.current = sel.getRangeAt(0).cloneRange();
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          const host = hostRef.current?.getBoundingClientRect();
          setSelection({ text, x: (host?.left ?? 0) + rect.left, y: (host?.top ?? 0) + rect.bottom + 6 });
        });
        doc.addEventListener("click", (clickEvent: MouseEvent) => {
          const target = clickEvent.target as HTMLElement | null;
          const link = target?.closest?.("a.scripture-ref-link") as HTMLElement | null;
          if (!link) return;
          clickEvent.preventDefault();
          clickEvent.stopImmediatePropagation();
          onOpenScripture?.(
            Number(link.dataset.book || 0), Number(link.dataset.chapter || 1),
            Number(link.dataset.verse || 1), link.dataset.label || link.textContent || "",
            clickEvent.clientX + (hostRef.current?.getBoundingClientRect().left ?? 0),
            clickEvent.clientY + (hostRef.current?.getBoundingClientRect().top ?? 0),
          );
        }, true);
      });
      view.addEventListener("relocate", (event: any) => {
        const detail = event.detail ?? {};
        currentLocationRef.current = { cfi: detail.cfi, fraction: Number(detail.fraction ?? 0) };
        setFraction(Number(detail.fraction ?? 0));
        setTocOpen(false);
        const stored = JSON.parse(localStorage.getItem("minelly.ereader-locations.v1") ?? "{}");
        stored[filePath] = { cfi: detail.cfi, fraction: detail.fraction, title: displayTitle || name };
        localStorage.setItem("minelly.ereader-locations.v1", JSON.stringify(stored));
      });
      view.addEventListener("create-overlay", (event: any) => {
        const index = Number(event.detail?.index ?? -1);
        const all = JSON.parse(localStorage.getItem("minelly.ereader-highlights.v1") ?? "{}");
        const visual = all[filePath] ?? [];
        for (const highlight of visual) {
          const resolved = view.resolveCFI?.(highlight.cfi);
          if (resolved?.index === index) void view.addAnnotation({ value: highlight.cfi, color: highlight.color });
        }
      });
      view.addEventListener("draw-annotation", (event: any) => {
        event.detail.draw(Overlayer.highlight, { color: event.detail.annotation?.color ?? "#f5d36b" });
      });
      await view.open(book);
      document.title = displayTitle || book.metadata?.title || name;
      setTitle(displayTitle || book.metadata?.title || name);
      setCurrentPath(filePath);
      setToc(flattenToc(book.toc ?? []));
      try {
        const all = JSON.parse(localStorage.getItem("minelly.ereader-bookmarks.v1") ?? "{}");
        setBookmarks(all[filePath] ?? []);
        const allNotes = JSON.parse(localStorage.getItem("minelly.ereader-notes.v1") ?? "{}");
        setNotes(allNotes[filePath] ?? []);
        const allHighlights = JSON.parse(localStorage.getItem("minelly.ereader-highlights.v1") ?? "{}");
        setHighlights(allHighlights[filePath] ?? []);
      } catch { setBookmarks([]); setNotes([]); }
      const saved = storedLocations[filePath];
      if (saved?.cfi) await view.goTo(saved.cfi);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    const contents = viewRef.current?.renderer?.getContents?.() ?? [];
    for (const item of contents) if (item.doc) applyReaderStyle(item.doc);
  }, [theme, font, fontSize]);

  useEffect(() => {
    if (initialPath) void loadFile(initialPath, initialTitle);
    return () => { try { viewRef.current?.close?.(); } catch { /* noop */ } };
  }, [initialPath]);

  function addBookmark() {
    const cfi = currentLocationRef.current.cfi;
    if (!cfi) return;
    const entry = { cfi, label: `${Math.round(fraction * 100)}% · ${title}`, fraction };
    const next = [...bookmarks, entry];
    setBookmarks(next);
    const all = JSON.parse(localStorage.getItem("minelly.ereader-bookmarks.v1") ?? "{}");
    all[currentPath || "externo"] = next;
    localStorage.setItem("minelly.ereader-bookmarks.v1", JSON.stringify(all));
  }

  async function addNote() {
    const text = selection?.text || "";
    if (!text) return;
    const body = window.prompt("Nota sobre la selección", text);
    if (!body) return;
    try {
      await invoke("note_create", { input: {
        notebookId: null, title: body.slice(0, 80),
        contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] },
        tags: ["eReader"], anchors: [{ anchorUri: `minelly://ereader?cfi=${encodeURIComponent(currentLocationRef.current.cfi ?? "")}&text=${encodeURIComponent(text.slice(0, 120))}`, exactText: text, startOffset: 0, endOffset: text.length }],
      }});
      const next = [...notes, { title: body.slice(0, 60), text }];
      setNotes(next);
      const all = JSON.parse(localStorage.getItem("minelly.ereader-notes.v1") ?? "{}");
      all[currentPath || "externo"] = next;
      localStorage.setItem("minelly.ereader-notes.v1", JSON.stringify(all));
      setSelection(null);
    } catch (err) { setError(String(err)); }
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
      const all = JSON.parse(localStorage.getItem("minelly.ereader-highlights.v1") ?? "{}");
      all[currentPath || "externo"] = next;
      localStorage.setItem("minelly.ereader-highlights.v1", JSON.stringify(all));
      void view.addAnnotation({ value: cfi, color: highlight.color });
      setSelection(null);
    } catch (error) { setError(String(error)); }
  }

  function deleteHighlight(cfi: string) {
    setHighlights((current) => {
      const next = current.filter((item) => item.cfi !== cfi);
      const all = JSON.parse(localStorage.getItem("minelly.ereader-highlights.v1") ?? "{}");
      all[currentPath || "externo"] = next;
      localStorage.setItem("minelly.ereader-highlights.v1", JSON.stringify(next ? all : all));
      return next;
    });
    void viewRef.current?.deleteAnnotation?.({ value: cfi });
  }

  async function toggleFullscreen() {
    await getCurrentWindow().setFullscreen(!fullscreen);
    setFullscreen((value) => !value);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag ?? "")) return;
      if (event.key === "ArrowRight") { event.preventDefault(); void viewRef.current?.next(); }
      if (event.key === "ArrowLeft") { event.preventDefault(); void viewRef.current?.prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function pickFile() {
    const selected = await open({ multiple: false, filters: [{ name: "eBooks", extensions: ["epub", "mobi", "azw3", "fb2"] }] });
    if (typeof selected === "string") await loadFile(selected);
  }

  return (
    <section className={`ereader-workspace${embedded ? " embedded" : ""}`} style={{ "--ereader-font": `"${font}", Georgia, serif`, "--ereader-scale": fontSize } as React.CSSProperties}>
      <header className="ereader-toolbar">
        <div><span className="eyebrow">Lector independiente</span><h1>eReader · {title}</h1></div>
        <div className="ereader-actions">
          <button type="button" onClick={() => void pickFile()}>+ Abrir archivo eBook</button>
          <button type="button" onClick={() => setTocOpen((value) => !value)}>Índice</button>
          <button type="button" onClick={addBookmark}>Marcador</button>
          <button type="button" onClick={() => void addNote()}>Nota</button>
          <button type="button" onClick={() => void toggleFullscreen()}>Pantalla completa</button>
          <select value={theme} onChange={(event) => setTheme(event.target.value)} aria-label="Color del lienzo de lectura">
            {EREADER_THEMES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select value={font} onChange={(event) => setFont(event.target.value)} aria-label="Tipografía">
            <option>Literata</option><option>Crimson Pro</option><option>Georgia</option><option>Inter</option>
          </select>
          <button type="button" onClick={() => setFontSize((value) => Math.max(0.75, value - 0.1))}>A−</button>
          <button type="button" onClick={() => setFontSize((value) => Math.min(1.8, value + 0.1))}>A+</button>
          <button type="button" onClick={() => void viewRef.current?.prev()}>←</button>
          <button type="button" onClick={() => void viewRef.current?.next()}>→</button>
          {!embedded && <button type="button" onClick={onClose}>Cerrar</button>}
        </div>
      </header>
      <div className={`ereader-body theme-${theme === "inherit" ? "inherit" : "custom"}`}>
        {tocOpen && <aside className="ereader-toc">
          <div className="ereader-toc-tabs">
            <button type="button" className={panel === "toc" ? "active" : ""} onClick={() => setPanel("toc")}>Índice</button>
            <button type="button" className={panel === "notes" ? "active" : ""} onClick={() => setPanel("notes")}>Notas ({notes.length})</button>
            <button type="button" className={panel === "bookmarks" ? "active" : ""} onClick={() => setPanel("bookmarks")}>Marcadores ({bookmarks.length})</button>
            <button type="button" className={panel === "highlights" ? "active" : ""} onClick={() => setPanel("highlights")}>Resaltados ({highlights.length})</button>
          </div>
          {panel === "toc" && toc.map((item, index) => (
            <button key={`${item.href}-${index}`} type="button" style={{ paddingLeft: 8 + item.depth * 12 }} onClick={() => void viewRef.current?.goTo(item.href)}>{item.label}</button>
          ))}
          {panel === "notes" && notes.map((note, index) => <div key={index} className="ereader-note"><strong>{note.title}</strong><small>{note.text.slice(0, 90)}</small></div>)}
          {panel === "bookmarks" && bookmarks.map((bookmark, index) => <button key={index} type="button" onClick={() => void viewRef.current?.goTo(bookmark.cfi)}>{bookmark.label}</button>)}
          {panel === "highlights" && highlights.map((highlight, index) => (
            <div key={index} className="ereader-highlight-row">
              <i style={{ background: highlight.color }} />
              <button type="button" onClick={() => void viewRef.current?.goTo(highlight.cfi)}>Ir al resaltado</button>
              <button type="button" onClick={() => deleteHighlight(highlight.cfi)}>×</button>
            </div>
          ))}
        </aside>}
        <div ref={hostRef} className="ereader-view" />
      </div>
      {selection && (
        <div className="ereader-selection-toolbar" style={{ left: selection.x, top: selection.y }}>
          <span className="ereader-color-row">{HIGHLIGHT_COLORS.map((color) => (
            <button key={color} type="button" className={highlightColor === color ? "active" : ""} style={{ background: color }} onClick={() => setHighlightColor(color)} aria-label={`Color ${color}`} />
          ))}</span>
          <button type="button" onClick={highlightSelection}>Resaltar</button>
          <button type="button" onClick={() => void addNote()}>Nota</button>
          <button type="button" onClick={addBookmark}>Marcador</button>
          <button type="button" onClick={() => setSelection(null)}>×</button>
        </div>
      )}

      <footer className="ereader-footer"><span>{Math.round(fraction * 100)}%</span><progress value={fraction} max={1} />{error && <span className="ereader-error">{error}</span>}</footer>
    </section>
  );
}
