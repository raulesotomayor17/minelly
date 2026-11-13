import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { processBookChapterHtml } from "./bookProcessor";
import { flattenToc } from "./vendor/foliate-js/toc.js";

interface Props {
  initialPath?: string;
  initialTitle?: string;
  onClose: () => void;
  onOpenScripture: (book: number, chapter: number, verse: number, label: string, x: number, y: number) => void;
}

interface StoredLocation { cfi?: string; fraction?: number; title?: string }

export default function EreaderWorkspace({ initialPath, initialTitle, onClose, onOpenScripture }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<any>(null);
  const [title, setTitle] = useState(initialTitle ?? "eReader");
  const [currentPath, setCurrentPath] = useState(initialPath ?? "");
  const [toc, setToc] = useState<Array<{ label: string; href: string; depth: number }>>([]);
  const [tocOpen, setTocOpen] = useState(true);
  const [fraction, setFraction] = useState(0);
  const [theme, setTheme] = useState("inherit");
  const [font, setFont] = useState("Literata");
  const [fontSize, setFontSize] = useState(1);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"toc" | "notes" | "bookmarks">("toc");
  const [bookmarks, setBookmarks] = useState<Array<{ cfi: string; label: string; fraction: number }>>([]);
  const [notes, setNotes] = useState<Array<{ title: string; text: string }>>([]);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const currentLocationRef = useRef<{ cfi?: string; fraction?: number }>({});
  const [fullscreen, setFullscreen] = useState(false);

  const storedLocations = useMemo<Record<string, StoredLocation>>(() => {
    try { return JSON.parse(localStorage.getItem("minelly.ereader-locations.v1") ?? "{}"); } catch { return {}; }
  }, []);

  async function loadFile(filePath: string, displayTitle?: string) {
    setError("");
    try {
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
          onOpenScripture(
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
      } catch { setBookmarks([]); setNotes([]); }
      const saved = storedLocations[filePath];
      if (saved?.cfi) await view.goTo(saved.cfi);
    } catch (err) {
      setError(String(err));
    }
  }

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
    if (!range) return;
    try {
      const mark = document.createElement("mark");
      mark.className = "ereader-highlight";
      mark.style.background = "#f5d36b";
      mark.style.color = "inherit";
      range.surroundContents(mark);
      setSelection(null);
    } catch { setError("No se pudo resaltar una selección que cruza varios bloques."); }
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
    <section className="ereader-workspace" style={{ "--ereader-font": `"${font}", Georgia, serif`, "--ereader-scale": fontSize } as React.CSSProperties}>
      <header className="ereader-toolbar">
        <div><span className="eyebrow">Lector independiente</span><h1>eReader · {title}</h1></div>
        <div className="ereader-actions">
          <button type="button" onClick={() => void pickFile()}>+ Abrir archivo eBook</button>
          <button type="button" onClick={() => setTocOpen((value) => !value)}>Índice</button>
          <button type="button" onClick={addBookmark}>Marcador</button>
          <button type="button" onClick={() => void addNote()}>Nota</button>
          <button type="button" onClick={() => void toggleFullscreen()}>Pantalla completa</button>
          <select value={theme} onChange={(event) => setTheme(event.target.value)} aria-label="Tema del eReader">
            <option value="inherit">Tema Minelly</option><option value="light">Claro</option><option value="sepia">Sepia</option><option value="dark">Oscuro</option>
          </select>
          <select value={font} onChange={(event) => setFont(event.target.value)} aria-label="Tipografía">
            <option>Literata</option><option>Crimson Pro</option><option>Georgia</option><option>Inter</option>
          </select>
          <button type="button" onClick={() => setFontSize((value) => Math.max(0.75, value - 0.1))}>A−</button>
          <button type="button" onClick={() => setFontSize((value) => Math.min(1.8, value + 0.1))}>A+</button>
          <button type="button" onClick={() => void viewRef.current?.prev()}>←</button>
          <button type="button" onClick={() => void viewRef.current?.next()}>→</button>
          <button type="button" onClick={onClose}>Cerrar</button>
        </div>
      </header>
      <div className={`ereader-body theme-${theme}`}>
        {tocOpen && <aside className="ereader-toc">
          <div className="ereader-toc-tabs">
            <button type="button" className={panel === "toc" ? "active" : ""} onClick={() => setPanel("toc")}>Índice</button>
            <button type="button" className={panel === "notes" ? "active" : ""} onClick={() => setPanel("notes")}>Notas ({notes.length})</button>
            <button type="button" className={panel === "bookmarks" ? "active" : ""} onClick={() => setPanel("bookmarks")}>Marcadores ({bookmarks.length})</button>
          </div>
          {panel === "toc" && toc.map((item, index) => (
            <button key={`${item.href}-${index}`} type="button" style={{ paddingLeft: 8 + item.depth * 12 }} onClick={() => void viewRef.current?.goTo(item.href)}>{item.label}</button>
          ))}
          {panel === "notes" && notes.map((note, index) => <div key={index} className="ereader-note"><strong>{note.title}</strong><small>{note.text.slice(0, 90)}</small></div>)}
          {panel === "bookmarks" && bookmarks.map((bookmark, index) => <button key={index} type="button" onClick={() => void viewRef.current?.goTo(bookmark.cfi)}>{bookmark.label}</button>)}
        </aside>}
        <div ref={hostRef} className="ereader-view" />
      </div>
      {selection && (
        <div className="ereader-selection-toolbar" style={{ left: selection.x, top: selection.y }}>
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
