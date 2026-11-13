import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import ModularWorkspace from "./ModularWorkspace";
import PersonalBookBuilder from "./PersonalBookBuilder";
import NotesWorkspace from "./NotesWorkspace";
import StudyAssistant, { type RagContext } from "./StudyAssistant";
import WordStudyPanel from "./WordStudyPanel";
import Dashboard from "./Dashboard";
import FormationWorkspace, { type FormationTab } from "./FormationWorkspace";
import DocumentsWorkspace from "./DocumentsWorkspace";
import HermeneuticsWorkspace from "./HermeneuticsWorkspace";
import { LANGUAGE_KEY, applyEnglishDomTranslations, setI18nLanguage, tr, type Language } from "./i18n";
import CitationInfoModal from "./CitationInfoModal";
import {
  buildCitation,
  citationStyleLabel,
  type CitationLocation,
  type CitationResource,
  type CitationStyle,
} from "./citationEngine";
import DockWorkspaceCore from "./lienzo/DockWorkspaceCore";
import InterlinearVerse, {
  type InterlinearVerseData,
} from "./InterlinearVerse";
import SelectMenu from "./SelectMenu";
import TtsPanel from "./TtsPanel";
import CompareWorkspace from "./CompareWorkspace";
import CustomizationModal, { PaperModePicker } from "./CustomizationModal";
import SermonWorkspace from "./SermonWorkspace";
import {
  globalReferenceLabel,
  MODULE_LABELS,
  parseGlobalReference,
  snippetHtml,
  UNIFIED_LABELS,
  UNIFIED_ORDER,
  unifiedReferenceLabel,
  type GlobalIndexStatus,
  type GlobalSearchHit,
  type IndexReport,
  type UnifiedSearchResult,
} from "./globalSearch";
import {
  DEFAULT_BOOK_TYPESETTING,
  processBookChapterHtml,
  type BookTypesettingOptions,
} from "./bookProcessor";
import { useBibleFormatStore } from "./bibleFormatStore";
import { useInterlinearStore } from "./interlinearStore";
import { useUiCustomizationStore } from "./uiCustomizationStore";
import { bibleAnchor, osisForBook, parseAnchor, resourceAnchor } from "./anchors";
import { rangeFromOffsets, selectionOffsets, wordRangeAtPoint } from "./textRanges";
import minellyMark from "./assets/minelly-mark.svg";
import { openExternalUrl } from "./externalLinks";
import RibbonIcon from "./RibbonIcon";
import BookmarksDrawer, { type BookmarkEntry, type JumpEntry } from "./BookmarksDrawer";
import "./App.css";

type Kind = "bible" | "commentary" | "dictionary" | "reference" | "map" | "book";
type View = "library" | "reader" | "search" | "book";
type ReaderMode = "verse" | "page" | "book" | "interlinear";
type ReaderWidth = "compact" | "normal" | "wide" | "full";

function fileLabel(path: string) {
  if (!path) return "";
  return path.split(/[\\/]/).pop() ?? path;
}
type SidebarPosition = "left" | "right" | "top" | "bottom";

interface SidebarSettings {
  position: SidebarPosition;
  collapsed: boolean;
  autoHide: boolean;
}

const SIDEBAR_KEY = "teoamoxtli.sidebar.v1";
const LAST_LOCATION_KEY = "teoamoxtli.last-location.v1";

interface LastLocation {
  view: View;
  bibleId: string;
  bookId: string;
  bookSpine: number;
  book: number;
  chapter: number;
  activeVerse: number;
  readerMode: ReaderMode;
  fontScale: number;
}

const LAST_SEARCH_KEY = "teoamoxtli.last-search.v1";

interface SavedSearch {
  query: string;
  mode: "unified" | "global" | "classic" | "advanced";
}

function loadSavedSearch(): SavedSearch | null {
  try {
    const raw = localStorage.getItem(LAST_SEARCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedSearch>;
    if (!parsed.query?.trim()) return null;
    return {
      query: parsed.query.trim(),
      mode:
        parsed.mode === "classic"
          ? "classic"
          : parsed.mode === "global"
            ? "global"
            : parsed.mode === "advanced"
              ? "advanced"
              : "unified",
    };
  } catch {
    return null;
  }
}

function loadLastLocation(): Partial<LastLocation> {
  try {
    const raw = localStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<LastLocation>;
    const view: View = ["library", "reader", "search", "book"].includes(
      parsed.view ?? "",
    )
      ? (parsed.view as View)
      : "reader";
    return {
      view,
      bibleId: typeof parsed.bibleId === "string" ? parsed.bibleId : "",
      bookId: typeof parsed.bookId === "string" ? parsed.bookId : "",
      bookSpine: Number(parsed.bookSpine) || 0,
      book: Number(parsed.book) || 43,
      chapter: Number(parsed.chapter) || 3,
      activeVerse: Number(parsed.activeVerse) || 16,
      readerMode: ["verse", "page", "book", "interlinear"].includes(
        parsed.readerMode ?? "",
      )
        ? (parsed.readerMode as ReaderMode)
        : "verse",
      fontScale: Math.min(
        1.8,
        Math.max(0.8, Number(parsed.fontScale) || 1),
      ),
    };
  } catch {
    return {};
  }
}

function plainTextFromHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");

  return (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function loadSidebarSettings(): SidebarSettings {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (!raw) return { position: "left", collapsed: false, autoHide: false };
    const parsed = JSON.parse(raw) as Partial<SidebarSettings>;
    const position: SidebarPosition = ["left", "right", "top", "bottom"].includes(
      parsed.position ?? "",
    )
      ? (parsed.position as SidebarPosition)
      : "left";
    return {
      position,
      collapsed: Boolean(parsed.collapsed),
      autoHide: Boolean(parsed.autoHide),
    };
  } catch {
    return { position: "left", collapsed: false, autoHide: false };
  }
}

interface InterlinearStatus {
  tokens: number;
  books: number;
  verses: number;
}

interface InterlinearImportReport {
  tokens: number;
  books: number;
  verses: number;
  source: string;
}
type PanelTab = "commentary" | "dictionary" | "notes";

interface FloatingNoteState {
  x: number;
  y: number;
  anchor: NoteSeed;
  noteId: string | null;
  title: string;
  body: string;
  chooserOnly?: boolean;
}

function textToTipTapDoc(text: string): string {
  const paragraphs = text.split(/\r?\n/).map((line) =>
    line.trim()
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph" },
  );
  return JSON.stringify({
    type: "doc",
    content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }],
  });
}

function tipTapDocToText(docInput: unknown, fallback = ""): string {
  let doc = docInput;
  if (typeof docInput === "string") {
    try {
      doc = JSON.parse(docInput);
    } catch {
      return fallback || docInput;
    }
  }
  if (!doc || typeof doc !== "object") return fallback;
  const root = doc as { content?: unknown[]; text?: string };
  if (!Array.isArray(root.content)) return fallback;
  const walk = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const record = node as { text?: string; content?: unknown[] };
    if (typeof record.text === "string") return record.text;
    if (Array.isArray(record.content)) return record.content.map(walk).join("");
    return "";
  };
  const lines = root.content.map(walk);
  return lines.join("\n").trim() || fallback;
}
import { THEME_META, THEME_OPTIONS, type ThemeMode } from "./themes";
type Theme = ThemeMode;

interface Resource {
  id: string;
  kind: Kind;
  title: string;
  abbreviation: string;
  language: string;
  sourceFormat: string;
  sourcePath: string;
  verseCount: number;
  entryCount: number;
  importedAt: number;
  metadata: Record<string, unknown>;
  searchPriority: number;
  cloudSynced: boolean;
}

interface BookInfo {
  number: number;
  name: string;
  abbreviation: string;
}

interface Verse {
  book: number;
  chapter: number;
  verse: number;
  html: string;
}

interface Passage {
  resource: Resource;
  book: BookInfo;
  chapter: number;
  verses: Verse[];
}

interface BookText {
  resource: Resource;
  book: BookInfo;
  verses: Verse[];
}

interface CommentaryEntry {
  book: number;
  chapterStart: number;
  verseStart: number;
  chapterEnd: number;
  verseEnd: number;
  html: string;
}

interface DictionaryEntry {
  topic: string;
  html: string;
}

interface EpubChapterSummary {
  spine: number;
  title: string;
}

interface EpubChapter {
  spine: number;
  title: string;
  href: string;
  html: string;
}

interface SearchHit {
  kind: string;
  resourceId: string;
  resourceTitle: string;
  label: string;
  book: number;
  chapter: number;
  verse: number;
  html: string;
}

interface ImportReport {
  resource: Resource;
  warnings: string[];
}

interface AnchorHighlight {
  id: string;
  styleId: string;
  anchorUri: string;
  exactText: string;
  startOffset: number;
  endOffset: number;
  createdAt: number;
}

interface AnchoredNote {
  id: string;
  title: string;
  excerpt: string;
  anchors: {
    anchorUri: string;
    exactText: string;
    startOffset: number;
    endOffset: number;
  }[];
}

interface AnnotationBundle {
  notes: AnchoredNote[];
  highlights: AnchorHighlight[];
}

interface NoteSeed {
  anchorUri: string;
  exactText: string;
  startOffset: number;
  endOffset: number;
  label?: string;
}

interface SelectionMenu {
  x: number;
  y: number;
  text: string;
  anchorUri: string;
  label: string;
  startOffset: number;
  endOffset: number;
}

interface ContextMenu {
  x: number;
  y: number;
  text: string;
  anchorUri: string;
  label: string;
  startOffset: number;
  endOffset: number;
  highlightIds: string[];
  noteIds: string[];
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "rgba(214, 179, 106, 0.28)",
  green: "rgba(91, 184, 132, 0.24)",
  blue: "rgba(91, 149, 255, 0.24)",
  pink: "rgba(224, 108, 177, 0.24)",
  orange: "rgba(226, 145, 80, 0.25)",
};

interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  view: View;
  bibleId: string;
  commentaryId: string;
  dictionaryId: string;
  bookId: string;
  book: number;
  chapter: number;
  activeVerse: number;
  readerMode: ReaderMode;
  showNumbers: boolean;
  panelOpen: boolean;
  panelWidth: number;
  fontScale: number;
  focusMode: boolean;
  resourcesOpen: boolean;
  readerFont?: string;
  studyFont?: string;
  studyFontScale?: number;
}

const KIND_LABEL: Record<Kind, string> = {
  bible: "Biblia",
  commentary: "Comentario",
  dictionary: "Diccionario",
  reference: "Referencias",
  map: "Mapas",
  book: "Libro",
};

const KIND_ORDER: Kind[] = [
  "bible",
  "commentary",
  "dictionary",
  "reference",
  "map",
  "book",
];

const WORKSPACE_KEY = "teoamoxtli.workspaces.v1";
const PAGE_SIZE = 8;

const FONT_OPTIONS = [
  { value: "Literata", label: "Literata" },
  { value: "Crimson Pro", label: "Crimson Pro" },
  { value: "Cormorant Garamond", label: "Cormorant" },
  { value: "Libre Baskerville", label: "Baskerville" },
  { value: "Georgia", label: "Georgia" },
  { value: "Inter", label: "Inter" },
];

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function loadWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
    library: "M4 4h5v16H4zM11 4h4v16h-4zM17 5l3 15-2 .4L15 5.4z",
    bible:
      "M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1 2v14m5-11v5m-2.5-2.5h5",
    search: "M10.5 4a6.5 6.5 0 1 0 4.1 11.6L20 21l1-1-5.4-5.4A6.5 6.5 0 0 0 10.5 4z",
    book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm2 0v14m2-11h9m-9 3h9m-9 3h6",
    layers: "M12 3 3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5",
    panel: "M4 4h16v16H4zM14 4v16",
    expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
    collapse: "M8 3v5H3m13-5v5h5M3 16h5v5m13-5h-5v5",
    focus: "M12 5c5 0 8 7 8 7s-3 7-8 7-8-7-8-7 3-7 8-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    close: "M6 6l12 12M18 6 6 18",
    chevron: "M9 6l6 6-6 6",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    workspace: "M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z",
    trash: "M4 7h16M9 7V4h6v3m-8 0 1 14h8l1-14M10 11v6m4-6v6",
    eye: "M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zm9.5-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    eyeOff: "M3 3l18 18M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16.5 16.5 0 0 1-2.4 3.1M6.2 6.2C3.8 8 2.5 12 2.5 12S6 18 12 18c1.4 0 2.6-.3 3.8-.8",
    note: "M5 3h10l4 4v14H5zM15 3v5h4M8 11h8M8 15h6",
    assistant: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
    audio: "M4 10v4h4l5 4V6L8 10H4zM16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11",
    compare: "M4 5h7v14H4zM13 5h7v14h-7zM12 3v18",
    sermon: "M12 6c-2-1.4-4.5-2-7-2v13c2.5 0 5 .6 7 2 2-1.4 4.5-2 7-2V4c-2.5 0-5 .6-7 2zM12 6v13",
    prayer: "M8 21v-6l-3-3 2-2 3 3V5a2 2 0 114 0v8l3-3 2 2-3 3v6",
    course: "M3 6l9-3 9 3-9 3-9-3zm3 4v6l6 3 6-3v-6M12 9v10",
    star: "M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.6l5.8-.8z",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name] ?? paths.book} />
    </svg>
  );
}

function Html({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function App() {
  const [lastLocation] = useState(loadLastLocation);
  const [resources, setResources] = useState<Resource[]>([]);
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [view, setView] = useState<View>(lastLocation.view ?? "reader");
  const [showHome, setShowHome] = useState(
    () => !localStorage.getItem(LAST_LOCATION_KEY),
  );
  const [bibleId, setBibleId] = useState(lastLocation.bibleId ?? "");
  const [commentaryId, setCommentaryId] = useState("");
  const [dictionaryId, setDictionaryId] = useState("");
  const [bookId, setBookId] = useState(lastLocation.bookId ?? "");
  const [book, setBook] = useState(lastLocation.book ?? 43);
  const [chapter, setChapter] = useState(lastLocation.chapter ?? 3);
  const [activeVerse, setActiveVerse] = useState(lastLocation.activeVerse ?? 16);
  const [passage, setPassage] = useState<Passage | null>(null);
  const [bookText, setBookText] = useState<BookText | null>(null);
  const [readerMode, setReaderMode] = useState<ReaderMode>(
    lastLocation.readerMode ?? "verse",
  );
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [interlinearMenuOpen, setInterlinearMenuOpen] = useState(false);
  const [interlinearVerses, setInterlinearVerses] = useState<InterlinearVerseData[]>([]);
  const [interlinearStatus, setInterlinearStatus] = useState<InterlinearStatus>({
    tokens: 0,
    books: 0,
    verses: 0,
  });
  const [interlinearPath, setInterlinearPath] = useState("");
  const [interlinearBusy, setInterlinearBusy] = useState(false);
  const bibleFormat = useBibleFormatStore();
  const interlinearOptions = useInterlinearStore();
  const showNumbers = bibleFormat.enableCustomFormatting
    ? bibleFormat.showChapterVerseNumbers
    : true;
  const bibleFormatClass = [
    "bible-reader",
    bibleFormat.enableCustomFormatting ? "" : "default-formatting",
    bibleFormat.enableCustomFormatting && !bibleFormat.showChapterVerseNumbers
      ? "hide-numbers"
      : "",
    bibleFormat.enableCustomFormatting && !bibleFormat.showFootnoteIndicators
      ? "hide-footnotes"
      : "",
    bibleFormat.enableCustomFormatting && !bibleFormat.showNonBiblicalText
      ? "hide-headings"
      : "",
    bibleFormat.enableCustomFormatting
      ? bibleFormat.oneVersePerLine
        ? "verse-by-verse"
        : "paragraph-mode"
      : "paragraph-mode",
    bibleFormat.enableCustomFormatting && !bibleFormat.showBibleFormatting
      ? "plain-formatting"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const [fontScale, setFontScale] = useState(lastLocation.fontScale ?? 1);
  const [readerWidth, setReaderWidth] = useState<ReaderWidth>(() => {
    const stored = localStorage.getItem("teoamoxtli.reader-width.v1");
    return stored === "compact" || stored === "wide" || stored === "full"
      ? stored
      : "normal";
  });
  const [readerWidthMenuOpen, setReaderWidthMenuOpen] = useState(false);
  const [readerFont, setReaderFont] = useState("Literata");
  const [studyFont, setStudyFont] = useState("Crimson Pro");
  const [studyFontScale, setStudyFontScale] = useState(1);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("teoamoxtli.theme");
    return THEME_META.some((item) => item.id === saved)
      ? (saved as Theme)
      : "glass";
  });
  const [sidebarSettings, setSidebarSettings] = useState<SidebarSettings>(
    loadSidebarSettings,
  );
  const [sidebarSettingsOpen, setSidebarSettingsOpen] = useState(false);
  const [sidebarRevealed, setSidebarRevealed] = useState(
    () => !loadSidebarSettings().autoHide,
  );
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(330);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showWorkspaces, setShowWorkspaces] = useState(false);
  const useDockEngine =
    localStorage.getItem("teoamoxtli.dock-engine") !== "legacy";
  const [showModular, setShowModular] = useState(
    () => localStorage.getItem("teoamoxtli.modular-open.v1") === "1",
  );
  const [showPbb, setShowPbb] = useState(false);
  const [showSermons, setShowSermons] = useState(
    () => localStorage.getItem("teoamoxtli.sermons-open.v1") === "1",
  );
  const [showNotes, setShowNotes] = useState(false);
  const [showCustomization, setShowCustomization] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [language, setLanguage] = useState<Language>(() => {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    return stored === "en" ? "en" : "es";
  });
  const [showSettings, setShowSettings] = useState(false);
  const [assistantProvider, setAssistantProvider] = useState("deepseek");
  const [assistantApiKey, setAssistantApiKey] = useState("");
  const [assistantModel, setAssistantModel] = useState("deepseek-chat");
  const [citationInfoTarget, setCitationInfoTarget] = useState<Resource | null>(null);
  const [readingRibbon, setReadingRibbon] = useState<{
    id: string; resourceId: string; spine: number; label: string; createdAt: number;
    isPrimaryRibbon?: boolean; snippet?: string;
  } | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [jumpHistory, setJumpHistory] = useState<JumpEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem("teoamoxtli.reading-jump-history.v1") || "[]"); } catch { return []; }
  });
  const [returnTarget, setReturnTarget] = useState<JumpEntry | null>(null);
  const [readingProgressMap, setReadingProgressMap] = useState<Record<string, { spine: number; overallPercent: number }>>({});
  const bookContextNodeRef = useRef<HTMLElement | null>(null);
  const [footnotePreview, setFootnotePreview] = useState<{ x: number; y: number; text: string } | null>(null);
  const [pbbCitationMap, setPbbCitationMap] = useState<Record<string, Record<string, unknown>>>({});
  const [showHermeneutics, setShowHermeneutics] = useState(
    () => localStorage.getItem("teoamoxtli.hermeneutics-open.v1") === "1",
  );
  const [showDocuments, setShowDocuments] = useState(
    () => localStorage.getItem("teoamoxtli.documents-open.v1") === "1",
  );
  const [formationTab, setFormationTab] = useState<FormationTab | null>(() => {
    const saved = localStorage.getItem("teoamoxtli.formation-open.v1");
    return saved === "prayer" || saved === "guides" ? saved : null;
  });
  const [assistantSeed, setAssistantSeed] = useState("");
  const [showWordStudy, setShowWordStudy] = useState(
    () => localStorage.getItem("teoamoxtli.word-study.open.v1") === "1",
  );
  const [wordStudyStrong, setWordStudyStrong] = useState(
    () => localStorage.getItem("teoamoxtli.word-study.strong.v1") ?? "",
  );
  const [wordStudyQuery, setWordStudyQuery] = useState("");
  const [wordStudyReference, setWordStudyReference] = useState<{
    book: number;
    chapter: number;
    verse: number;
  } | null>(null);

  useEffect(() => {
    if (showWordStudy) {
      localStorage.setItem("teoamoxtli.word-study.open.v1", "1");
      localStorage.setItem("teoamoxtli.word-study.strong.v1", wordStudyStrong);
    } else {
      localStorage.removeItem("teoamoxtli.word-study.open.v1");
      localStorage.removeItem("teoamoxtli.word-study.strong.v1");
    }
  }, [showWordStudy, wordStudyStrong]);
  const [showCompare, setShowCompare] = useState(false);
  const [showTts, setShowTts] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [noteSeed, setNoteSeed] = useState<NoteSeed | null>(null);
  const [floatingNote, setFloatingNote] = useState<FloatingNoteState | null>(null);
  const [sideNoteId, setSideNoteId] = useState<string | null>(null);
  const [sideNoteTitle, setSideNoteTitle] = useState("");
  const [sideNoteBody, setSideNoteBody] = useState("");
  const [sideNoteAnchor, setSideNoteAnchor] = useState<NoteSeed | null>(null);
  const uiCustomization = useUiCustomizationStore();
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationBundle>({
    notes: [],
    highlights: [],
  });
  const [annotationsVersion, setAnnotationsVersion] = useState(0);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>(loadWorkspaces);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<Kind | "all">("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [commentaries, setCommentaries] = useState<CommentaryEntry[]>([]);
  const [panelTab, setPanelTab] = useState<PanelTab>("commentary");
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [dictionaryEntry, setDictionaryEntry] = useState<DictionaryEntry | null>(null);
  const [bookChapters, setBookChapters] = useState<EpubChapterSummary[]>([]);
  const [bookStructureTick, setBookStructureTick] = useState(0);
  const [bookFullMode, setBookFullMode] = useState(false);
  const [bookFullChapters, setBookFullChapters] = useState<EpubChapter[]>([]);
  const [bookCurationMode, setBookCurationMode] = useState(false);
  const [renamingChapter, setRenamingChapter] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [bookHoveredBlock, setBookHoveredBlock] = useState<{ node: HTMLElement; x: number; y: number } | null>(null);
  const [bookSpine, setBookSpine] = useState(lastLocation.bookSpine ?? 0);
  const [bookChapter, setBookChapter] = useState<EpubChapter | null>(null);
  const [bookTocTab, setBookTocTab] = useState<"chapters" | "outline" | "refs" | "bookmarks">("chapters");
  const [bookTypesetting, setBookTypesetting] = useState<BookTypesettingOptions>(() => {
    try {
      const raw = localStorage.getItem("teoamoxtli.book-typesetting.v1");
      if (!raw) return DEFAULT_BOOK_TYPESETTING;
      return { ...DEFAULT_BOOK_TYPESETTING, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_BOOK_TYPESETTING;
    }
  });
  const [bookTocCollapsed, setBookTocCollapsed] = useState(() => {
    const stored = localStorage.getItem("teoamoxtli.book-toc.v1");
    if (stored === "collapsed") return true;
    if (stored === "expanded") return false;
    // En ventanas estrechas el índice arranca plegado para no comprimir el texto.
    return window.innerWidth < 1500;
  });
  const [bookImmersive, setBookImmersive] = useState(false);
  const [bookViewMenuOpen, setBookViewMenuOpen] = useState(false);
  const [bookProgress, setBookProgress] = useState(0);
  const [modularPreset, setModularPreset] = useState<string | undefined>(undefined);
  const [scripturePreview, setScripturePreview] = useState<{
    x: number;
    y: number;
    label: string;
    book: number;
    chapter: number;
    verse: number;
    endVerse: number;
    text: string;
    loading: boolean;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchMode, setSearchMode] = useState<
    "unified" | "global" | "classic" | "advanced"
  >("unified");
  const [globalHits, setGlobalHits] = useState<GlobalSearchHit[]>([]);
  const [unifiedHits, setUnifiedHits] = useState<UnifiedSearchResult[]>([]);
  const [expandByStrong, setExpandByStrong] = useState(false);
  const [noteFocusId, setNoteFocusId] = useState<string | null>(null);
  const [modularBook, setModularBook] = useState<{
    resourceId: string;
    spine: number;
  } | null>(null);
  const [indexStatus, setIndexStatus] = useState<GlobalIndexStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ done: 0, total: 0, title: "" });
  const [indexError, setIndexError] = useState("");
  const [showIndexPrompt, setShowIndexPrompt] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Resource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState("");
  const readerRef = useRef<HTMLDivElement>(null);
  const bookReaderRef = useRef<HTMLElement>(null);
  const bookViewMenuRef = useRef<HTMLDivElement>(null);

  const bibles = useMemo(
    () => resources.filter((resource) => resource.kind === "bible"),
    [resources],
  );
  const commentaryResources = useMemo(
    () => resources.filter((resource) => resource.kind === "commentary"),
    [resources],
  );
  const dictionaries = useMemo(
    () => resources.filter((resource) => resource.kind === "dictionary"),
    [resources],
  );
  const libraryBooks = useMemo(
    () => resources.filter((resource) => resource.kind === "book"),
    [resources],
  );

  const currentBible = bibles.find((resource) => resource.id === bibleId);
  const currentBook = books.find((item) => item.number === book);
  const currentLibraryBook = libraryBooks.find((resource) => resource.id === bookId);
  const currentDictionary = dictionaries.find((resource) => resource.id === dictionaryId);
  const panelVisible = panelOpen && !focusMode;

  const chapterVerses = passage?.verses ?? [];
  const pageCount = Math.max(1, Math.ceil(chapterVerses.length / PAGE_SIZE));
  const pageVerses = chapterVerses.slice(
    pageIndex * PAGE_SIZE,
    pageIndex * PAGE_SIZE + PAGE_SIZE,
  );

  const bookGroups = useMemo(() => {
    const groups = new Map<number, Verse[]>();
    for (const verse of bookText?.verses ?? []) {
      const list = groups.get(verse.chapter) ?? [];
      list.push(verse);
      groups.set(verse.chapter, list);
    }
    return [...groups.entries()];
  }, [bookText]);

  const highlightsByVerse = useMemo(() => {
    const map = new Map<string, AnchorHighlight[]>();
    if (!showAnnotations) return map;
    for (const highlight of annotations.highlights) {
      const match = /^bible:[A-Z0-9]{3}:(\d+):(\d+)$/i.exec(highlight.anchorUri);
      if (match) {
        const key = `${match[1]}-${match[2]}`;
        const list = map.get(key) ?? [];
        list.push(highlight);
        map.set(key, list);
      }
    }
    return map;
  }, [annotations.highlights, showAnnotations]);

  const highlightByVerse = useMemo(() => {
    const map = new Map<string, string>();
    if (!showAnnotations) return map;
    for (const [key, list] of highlightsByVerse.entries()) {
      if (list.length > 0) {
        map.set(key, list[list.length - 1].styleId);
      }
    }
    return map;
  }, [highlightsByVerse, showAnnotations]);

  const notesByVerse = useMemo(() => {
    const map = new Map<string, AnchoredNote[]>();
    if (!showAnnotations) return map;
    for (const note of annotations.notes) {
      for (const anchor of note.anchors) {
        const match = /^bible:[A-Z0-9]{3}:(\d+):(\d+)$/i.exec(anchor.anchorUri);
        if (match) {
          const key = `${match[1]}-${match[2]}`;
          const list = map.get(key) ?? [];
          if (!list.some((item) => item.id === note.id)) {
            list.push(note);
          }
          map.set(key, list);
        }
      }
    }
    return map;
  }, [annotations.notes, showAnnotations]);

  const filteredResources = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    return resources.filter((resource) => {
      if (libraryFilter !== "all" && resource.kind !== libraryFilter) return false;
      if (!query) return true;
      return [resource.title, resource.abbreviation, resource.sourceFormat, resource.language]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [resources, libraryQuery, libraryFilter]);

  const libraryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: resources.length };
    for (const resource of resources) {
      counts[resource.kind] = (counts[resource.kind] ?? 0) + 1;
    }
    return counts;
  }, [resources]);

  const globalGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        resourceId: string;
        moduleType: string;
        title: string;
        hits: GlobalSearchHit[];
      }
    >();
    for (const hit of globalHits) {
      const existing = groups.get(hit.resourceId);
      if (existing) {
        existing.hits.push(hit);
      } else {
        const resource = resources.find((item) => item.id === hit.resourceId);
        groups.set(hit.resourceId, {
          resourceId: hit.resourceId,
          moduleType: hit.moduleType,
          title: resource?.title ?? hit.resourceId,
          hits: [hit],
        });
      }
    }
    return [...groups.values()];
  }, [globalHits, resources]);

  const unifiedGroups = useMemo(() => {
    const groups = new Map<string, UnifiedSearchResult[]>();
    for (const hit of unifiedHits) {
      const list = groups.get(hit.sourceType) ?? [];
      list.push(hit);
      groups.set(hit.sourceType, list);
    }
    return [...groups.entries()]
      .sort(([left, leftHits], [right, rightHits]) => {
        const leftPriority = Math.max(
          0,
          ...leftHits.map((hit) => hit.priority ?? 0),
        );
        const rightPriority = Math.max(
          0,
          ...rightHits.map((hit) => hit.priority ?? 0),
        );
        if (leftPriority !== rightPriority) {
          return rightPriority - leftPriority;
        }
        return UNIFIED_ORDER.indexOf(left) - UNIFIED_ORDER.indexOf(right);
      })
      .map(([sourceType, hits]) => ({ sourceType, hits }));
  }, [unifiedHits]);

  const processedBookChapter = useMemo(
    () => processBookChapterHtml(bookChapter?.html ?? ""),
    [bookChapter?.html],
  );

  const processedBookFull = useMemo(
    () => bookFullChapters.map((chapter) => processBookChapterHtml(chapter.html)),
    [bookFullChapters],
  );

  useEffect(() => {
    localStorage.setItem(
      "teoamoxtli.book-typesetting.v1",
      JSON.stringify(bookTypesetting),
    );
  }, [bookTypesetting]);

  useEffect(() => {
    localStorage.setItem(
      "teoamoxtli.book-toc.v1",
      bookTocCollapsed ? "collapsed" : "expanded",
    );
  }, [bookTocCollapsed]);

  useEffect(() => {
    localStorage.setItem("teoamoxtli.reader-width.v1", readerWidth);
  }, [readerWidth]);

  useEffect(() => {
    localStorage.setItem(
      LAST_LOCATION_KEY,
      JSON.stringify({
        view,
        bibleId,
        bookId,
        bookSpine,
        book,
        chapter,
        activeVerse,
        readerMode,
        fontScale,
      }),
    );
  }, [view, bibleId, bookId, bookSpine, book, chapter, activeVerse, readerMode, fontScale]);

  useEffect(() => {
    if (
      view === "book" &&
      resources.length > 0 &&
      !resources.some((resource) => resource.id === bookId && resource.kind === "book")
    ) {
      setView("reader");
    }
  }, [view, resources, bookId]);

  useEffect(() => {
    if (!bookViewMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!bookViewMenuRef.current?.contains(event.target as Node)) {
        setBookViewMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBookViewMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [bookViewMenuOpen]);

  useEffect(() => {
    if (view !== "book") {
      setBookImmersive(false);
      setBookViewMenuOpen(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") {
        if (bookViewMenuOpen) {
          setBookViewMenuOpen(false);
          return;
        }
        if (bookImmersive) setBookImmersive(false);
        if (isFullscreen) void toggleFullscreen();
        return;
      }
      if (event.key === "F11") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        moveBook(-1);
        return;
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        moveBook(1);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        setBookTocCollapsed((current) => !current);
      } else if (event.key === "v" || event.key === "V") {
        event.preventDefault();
        setBookViewMenuOpen((current) => !current);
      } else if (event.key === "i" || event.key === "I") {
        event.preventDefault();
        setBookImmersive((current) => !current);
      } else if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        cycleBookColumns();
      } else if (event.key === "1" || event.key === "2" || event.key === "3") {
        event.preventDefault();
        setBookTypesetting((previous) => ({
          ...previous,
          columns: Number(event.key) as 1 | 2 | 3,
        }));
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, bookViewMenuOpen, bookImmersive, isFullscreen, bookChapters, bookSpine]);

  useEffect(() => {
    if (view !== "book") return;
    const element = bookReaderRef.current;
    if (!element) return;
    element.scrollTop = 0;
    setBookProgress(0);
    const frame = window.requestAnimationFrame(() => {
      const max = element.scrollHeight - element.clientHeight;
      setBookProgress(max <= 4 ? 100 : 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view, bookId, bookSpine]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspaces));
  }, [workspaces]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("teoamoxtli.theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebarSettings));
  }, [sidebarSettings]);

  useEffect(() => {
    if (!sidebarSettings.autoHide) setSidebarRevealed(true);
  }, [sidebarSettings.autoHide]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        setShowSermons(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "teoamoxtli.sermons-open.v1",
      showSermons ? "1" : "0",
    );
  }, [showSermons]);

  useEffect(() => {
    void refreshIndexStatus();
  }, [resources.length]);

  useEffect(() => {
    if (!indexStatus || indexStatus.pendingResources === 0) {
      setShowIndexPrompt(false);
      return;
    }
    const choice = localStorage.getItem("teoamoxtli.indexer-prompt.v1");
    if (choice === "never") return;
    const deferredUntil = Number(
      localStorage.getItem("teoamoxtli.indexer-deferred-until.v1") ?? 0,
    );
    if (deferredUntil > Date.now()) return;
    setShowIndexPrompt(true);
  }, [indexStatus]);

  useEffect(() => {
    if (view !== "search" || !indexStatus) return;
    if (searchQuery || searchHits.length > 0 || globalHits.length > 0) return;
    const saved = loadSavedSearch();
    if (!saved) return;
    setSearchQuery(saved.query);
    setSearchMode(saved.mode);
    void performSearch(saved.query, saved.mode);
  }, [view, indexStatus]);

  async function loadPbbCitationMap() {
    try {
      const rows = await invoke<Array<Record<string, unknown>>>("pbb_list");
      const map: Record<string, Record<string, unknown>> = {};
      for (const row of rows) {
        const id = String(row.resourceId ?? row.resource_id ?? "");
        if (id) map[id] = row;
      }
      setPbbCitationMap(map);
      return map;
    } catch {
      return pbbCitationMap;
    }
  }

  function toCitationResource(
    resource: Resource,
    pbb?: Record<string, unknown>,
  ): CitationResource {
    return {
      id: resource.id,
      kind:
        resource.kind === "bible" ||
        resource.kind === "commentary" ||
        resource.kind === "dictionary" ||
        resource.kind === "book"
          ? resource.kind
          : "book",
      title: resource.title,
      abbreviation: resource.abbreviation,
      language: resource.language,
      metadata: resource.metadata,
      pbb: pbb
        ? {
            author: String(pbb.author ?? ""),
            copyright: String(pbb.copyright ?? ""),
            publisher: String(pbb.publisher ?? pbb.publicationDate ?? ""),
            publicationDate: String(pbb.publicationDate ?? pbb.publication_date ?? ""),
            series: String(pbb.series ?? pbb.seriesTitle ?? ""),
            customAttributes: Array.isArray(pbb.customAttributes)
              ? (pbb.customAttributes as Array<{ key: string; value: string }>)
              : Array.isArray(pbb.custom_attributes)
                ? (pbb.custom_attributes as Array<{ key: string; value: string }>)
                : [],
          }
        : undefined,
    };
  }

  function citationLocationFor(
    anchorUri: string,
    text: string,
    label: string,
  ): CitationLocation {
    const parsed = parseAnchor(anchorUri);
    if (parsed?.kind === "bible") {
      return {
        bookName: books.find((item) => item.number === parsed.book)?.name ?? label,
        chapter: parsed.chapter,
        verse: parsed.verse,
        label: `${books.find((item) => item.number === parsed.book)?.name ?? ""} ${parsed.chapter}:${parsed.verse}`.trim(),
      };
    }
    if (parsed) {
      const chapter = /chapter=(\d+)/.exec(parsed.selector);
      if (currentLibraryBook?.kind === "dictionary") {
        return { lemma: text.trim() };
      }
      return {
        chapter: chapter ? Number(chapter[1]) + 1 : undefined,
        label: chapter ? `cap. ${Number(chapter[1]) + 1}` : label,
      };
    }
    return { label };
  }

  async function copyWithCitation(
    text: string,
    anchorUri: string,
    label: string,
  ) {
    const parsed = parseAnchor(anchorUri);
    let resource: Resource | undefined;
    if (parsed?.kind === "bible") {
      resource = currentBible ?? bibles.find((item) => item.id === bibleId);
    } else if (parsed) {
      resource = resources.find((item) => item.id === parsed.resourceId);
    }
    resource = resource ?? currentLibraryBook ?? undefined;
    if (!resource) {
      setStatus("No se pudo identificar el recurso para la cita.");
      return;
    }
    let pbb = pbbCitationMap[resource.id];
    if (!pbb && resource.id.startsWith("pbb:")) {
      pbb = (await loadPbbCitationMap())[resource.id];
    }
    const citation = buildCitation(
      toCitationResource(resource, pbb),
      text,
      citationLocationFor(anchorUri, text, label),
      uiCustomization.citationStyle,
      uiCustomization.includeTranslationEntry,
    );
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([citation.plain], { type: "text/plain" }),
            "text/html": new Blob([citation.html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(citation.plain);
      }
      setStatus("Texto y cita copiados al portapapeles.");
    } catch {
      await navigator.clipboard.writeText(citation.plain);
      setStatus("Texto y cita copiados como texto plano.");
    }
  }

  async function copyTextOrCitation(
    text: string,
    anchorUri: string,
    label: string,
  ) {
    if (uiCustomization.autoCiteOnCopy) {
      await copyWithCitation(text, anchorUri, label);
    } else {
      await navigator.clipboard.writeText(text);
      setSelectionMenu(null);
      setContextMenu(null);
    }
  }

  async function saveCitationInfo(
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    await invoke("update_resource_metadata", { resourceId, metadata });
    setResources((current) =>
      current.map((resource) =>
        resource.id === resourceId ? { ...resource, metadata } : resource,
      ),
    );
    setStatus("Información bibliográfica guardada.");
  }

  async function refreshCatalog() {
    setBusy(true);
    try {
      const [nextResources, nextBooks] = await Promise.all([
        invoke<Resource[]>("list_resources"),
        invoke<BookInfo[]>("books"),
      ]);
      setResources(nextResources);
      setBooks(nextBooks);
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refreshCatalog();
  }, []);

  useEffect(() => {
    if (!bibleId && bibles.length > 0) setBibleId(bibles[0].id);
  }, [bibles, bibleId]);

  useEffect(() => {
    const preferred = uiCustomization.preferredBibleId;
    if (!preferred || !bibles.some((resource) => resource.id === preferred)) {
      return;
    }
    setBibleId((current) => (current === preferred ? current : preferred));
  }, [bibles, uiCustomization.preferredBibleId]);

  useEffect(() => {
    if (bibles.length > 0 && !bibles.some((resource) => resource.id === bibleId)) {
      setBibleId(bibles[0].id);
    }
  }, [bibles, bibleId]);

  useEffect(() => {
    if (!commentaryId && commentaryResources.length > 0) {
      setCommentaryId(commentaryResources[0].id);
    }
  }, [commentaryResources, commentaryId]);

  useEffect(() => {
    if (!dictionaryId && dictionaries.length > 0) setDictionaryId(dictionaries[0].id);
  }, [dictionaries, dictionaryId]);

  useEffect(() => {
    if (!bookId && libraryBooks.length > 0) setBookId(libraryBooks[0].id);
  }, [libraryBooks, bookId]);

  useEffect(() => {
    if (!bibleId) return;
    let cancelled = false;
    invoke<Passage>("get_passage", { resourceId: bibleId, book, chapter })
      .then((nextPassage) => {
        if (cancelled) return;
        setPassage(nextPassage);
        setActiveVerse((current) =>
          nextPassage.verses.some((verse) => verse.verse === current)
            ? current
            : (nextPassage.verses[0]?.verse ?? 1),
        );
      })
      .catch((error) => setStatus(String(error)));
    return () => {
      cancelled = true;
    };
  }, [bibleId, book, chapter]);

  useEffect(() => {
    setPageIndex(0);
  }, [chapter, bibleId]);

  useEffect(() => {
    if (pageIndex >= pageCount) setPageIndex(pageCount - 1);
  }, [pageCount, pageIndex]);

  useEffect(() => {
    if (!commentaryId) {
      setCommentaries([]);
      return;
    }
    invoke<CommentaryEntry[]>("get_commentaries", {
      resourceId: commentaryId,
      book,
      chapter,
      verse: activeVerse,
    })
      .then(setCommentaries)
      .catch((error) => setStatus(String(error)));
  }, [commentaryId, book, chapter, activeVerse]);

  useEffect(() => {
    if (!dictionaryId) return;
    invoke<string[]>("dictionary_topics", { resourceId: dictionaryId, limit: 120 })
      .then(setTopics)
      .catch((error) => setStatus(String(error)));
  }, [dictionaryId]);

  const pendingBookAnchorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!bookId) {
      setBookChapters([]);
      return;
    }
    invoke<EpubChapterSummary[]>("epub_chapters", { resourceId: bookId })
      .then((chapters) => {
        setBookChapters(chapters);
        setBookSpine((current) =>
          chapters.some((chapter) => chapter.spine === current)
            ? current
            : (chapters[0]?.spine ?? 0),
        );
      })
      .catch((error) => setStatus(String(error)));
  }, [bookId, view, bookStructureTick]);

  useEffect(() => {
    if (!bookFullMode || !bookId || bookChapters.length === 0) {
      setBookFullChapters([]);
      return;
    }
    Promise.all(
      bookChapters.map((chapter) =>
        invoke<EpubChapter | null>("get_epub_chapter", { resourceId: bookId, spine: chapter.spine }),
      ),
    )
      .then((items) => setBookFullChapters(items.filter((item): item is EpubChapter => Boolean(item))))
      .catch((error) => setStatus(String(error)));
  }, [bookFullMode, bookId, bookChapters]);

  useEffect(() => {
    if (!bookId) {
      setBookChapter(null);
      return;
    }
    invoke<EpubChapter | null>("get_epub_chapter", {
      resourceId: bookId,
      spine: bookSpine,
    })
      .then((chapterData) => {
        setBookChapter(chapterData);
        if (pendingBookAnchorRef.current) {
          const targetAnchor = pendingBookAnchorRef.current;
          pendingBookAnchorRef.current = null;
          window.setTimeout(() => {
            document
              .getElementById(targetAnchor)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 80);
        }
      })
      .catch((error) => setStatus(String(error)));
  }, [bookId, bookSpine, view]);

  useEffect(() => {
    if (!bibleId || readerMode !== "book") return;
    invoke<BookText>("get_book_text", { resourceId: bibleId, book })
      .then(setBookText)
      .catch((error) => setStatus(String(error)));
  }, [bibleId, book, readerMode]);

  useEffect(() => {
    type HighlightConstructor = new (...ranges: Range[]) => unknown;
    type HighlightRegistry = {
      delete: (name: string) => void;
      set: (name: string, value: unknown) => void;
    };
    const registry = (
      CSS as unknown as { highlights?: HighlightRegistry }
    ).highlights;
    const HighlightConstructor = (
      window as unknown as { Highlight?: HighlightConstructor }
    ).Highlight;
    if (!registry || !HighlightConstructor) return;
    for (const style of Object.keys(HIGHLIGHT_COLORS)) {
      registry.delete(`teo-${style}`);
    }
    if (!showAnnotations) return;
    const groups = new Map<string, Range[]>();
    for (const highlight of annotations.highlights) {
      const match = /^bible:[A-Z0-9]{3}:(\d+):(\d+)$/i.exec(highlight.anchorUri);
      if (!match) continue;
      const ref = `${Number(match[1])}-${Number(match[2])}`;
      const row = readerRef.current?.querySelector(`[data-ref="${ref}"]`);
      const root = row?.querySelector(".verse-text, .flow-verse") ?? row;
      if (!root) continue;
      const text = root.textContent ?? "";
      let start = highlight.startOffset ?? 0;
      let end = highlight.endOffset ?? 0;
      if (
        !highlight.exactText ||
        text.slice(start, end) !== highlight.exactText
      ) {
        const found = highlight.exactText ? text.indexOf(highlight.exactText) : -1;
        if (found >= 0) {
          start = found;
          end = found + highlight.exactText.length;
        }
      }
      if (end <= start || start < 0) continue;
      const range = rangeFromOffsets(root, start, Math.min(end, text.length));
      if (!range) continue;
      const list = groups.get(highlight.styleId) ?? [];
      list.push(range);
      groups.set(highlight.styleId, list);
    }
    for (const [style, ranges] of groups) {
      registry.set(`teo-${style}`, new HighlightConstructor(...ranges));
    }
    return () => {
      for (const style of Object.keys(HIGHLIGHT_COLORS)) {
        registry.delete(`teo-${style}`);
      }
    };
  }, [annotations.highlights, chapter, readerMode, showNumbers, showAnnotations, view]);

  useEffect(() => {
    if (!showTts || readerMode !== "verse") return;
    readerRef.current
      ?.querySelector(`[data-ref="${chapter}-${activeVerse}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeVerse, chapter, showTts, readerMode]);

  useEffect(() => {
    invoke<InterlinearStatus>("interlinear_status")
      .then(setInterlinearStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (readerMode !== "interlinear") return;
    let cancelled = false;
    invoke<InterlinearVerseData[]>("get_interlinear_chapter", { book, chapter })
      .then((value) => {
        if (!cancelled) setInterlinearVerses(value);
      })
      .catch((error) => {
        if (!cancelled) setStatus(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [book, chapter, readerMode]);

  useEffect(() => {
    if (!showAnnotations) {
      setAnnotations({ notes: [], highlights: [] });
      return;
    }
    let cancelled = false;
    invoke<AnnotationBundle>("annotations_for_prefix", {
      prefix:
        readerMode === "book"
          ? `bible:${osisForBook(book)}:`
          : `bible:${osisForBook(book)}:${chapter}:`,
    })
      .then((bundle) => {
        if (!cancelled) setAnnotations(bundle);
      })
      .catch((error) => setStatus(String(error)));
    return () => {
      cancelled = true;
    };
  }, [book, chapter, readerMode, showAnnotations, annotationsVersion, bibleId]);

  function handleReaderSelection(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0 || !showAnnotations) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const text = selection.toString().trim();
      if (!text) return;
      const range = selection.getRangeAt(0);
      const node =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      if (!node?.closest(".reader")) return;
      const verseElement = node.closest("[data-ref]");
      if (!verseElement) return;
      const [anchorChapter, anchorVerse] = (verseElement.getAttribute("data-ref") ?? "")
        .split("-")
        .map(Number);
      if (!anchorChapter || !anchorVerse) return;
      const verseText = verseElement.querySelector(".verse-text") ?? verseElement;
      const offsets = selectionOffsets(verseText, range);
      const rect = range.getBoundingClientRect();
      const width = 318;
      setSelectionMenu({
        x: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)),
        y: Math.max(12, Math.min(window.innerHeight - 210, rect.bottom + 8)),
        text,
        anchorUri: bibleAnchor(book, anchorChapter, anchorVerse),
        label: `${currentBook?.name ?? "Biblia"} ${anchorChapter}:${anchorVerse}`,
        startOffset: offsets.start,
        endOffset: offsets.end,
      });
    }, 10);
  }

  function handleBookSelection(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0 || !showAnnotations) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const text = selection.toString().trim();
      if (!text) return;
      const range = selection.getRangeAt(0);
      const node =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      if (!node?.closest(".book-reader")) return;
      const content = node.closest(".epub-content") ?? node.closest(".book-reader");
      const offsets = content ? selectionOffsets(content, range) : { start: 0, end: text.length };
      const rect = range.getBoundingClientRect();
      const width = 318;
      setSelectionMenu({
        x: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)),
        y: Math.max(12, Math.min(window.innerHeight - 210, rect.bottom + 8)),
        text,
        anchorUri: resourceAnchor(
          bookId,
          `chapter=${bookSpine}&start=${offsets.start}&end=${offsets.end}&text=${encodeURIComponent(text.slice(0, 140))}`,
        ),
        label: `${currentLibraryBook?.title ?? "Libro"} · capítulo ${bookSpine + 1}`,
        startOffset: offsets.start,
        endOffset: offsets.end,
      });
    }, 10);
  }

  async function saveHighlight(
    anchor: { anchorUri: string; text: string; startOffset: number; endOffset: number },
    styleId: string,
  ) {
    try {
      await invoke("highlight_create", {
        anchorUri: anchor.anchorUri,
        exactText: anchor.text,
        styleId,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
      });
      setSelectionMenu(null);
      setContextMenu(null);
      setAnnotationsVersion((current) => current + 1);
      window.getSelection()?.removeAllRanges();
      setStatus("Resaltado guardado.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function applySelectionHighlight(styleId: string) {
    if (!selectionMenu) return;
    await saveHighlight(selectionMenu, styleId);
  }

  function handleReaderContextMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    if (!showAnnotations) return;
    const selection = window.getSelection();
    let range: Range | null = null;
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      range = selection.getRangeAt(0);
    } else {
      range = wordRangeAtPoint(event.clientX, event.clientY);
      if (range && selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    if (!range) return;
    const node =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    if (!node?.closest(".reader, .book-reader")) return;
    if (node.closest(".book-reader") && !node.closest(".reader")) {
      const text = range.toString().trim();
      if (!text) return;
      const content = node.closest(".epub-content") ?? node.closest(".book-reader");
      bookContextNodeRef.current = node.closest("p, blockquote, div") as HTMLElement | null;
      const offsets = content ? selectionOffsets(content, range) : { start: 0, end: text.length };
      setSelectionMenu(null);
      setContextMenu({
        x: Math.max(12, Math.min(window.innerWidth - 260, event.clientX + 4)),
        y: Math.max(12, Math.min(window.innerHeight - 280, event.clientY + 4)),
        text,
        anchorUri: resourceAnchor(
          bookId,
          `chapter=${bookSpine}&start=${offsets.start}&end=${offsets.end}&text=${encodeURIComponent(text.slice(0, 140))}`,
        ),
        label: `${currentLibraryBook?.title ?? "Libro"} · capítulo ${bookSpine + 1}`,
        startOffset: offsets.start,
        endOffset: offsets.end,
        highlightIds: [],
        noteIds: [],
      });
      return;
    }
    const verseElement = node.closest("[data-ref]");
    if (!verseElement) return;
    const [anchorChapter, anchorVerse] = (verseElement.getAttribute("data-ref") ?? "")
      .split("-")
      .map(Number);
    if (!anchorChapter || !anchorVerse) return;
    const text = range.toString().trim();
    if (!text) return;
    const verseText = verseElement.querySelector(".verse-text") ?? verseElement;
    const offsets = selectionOffsets(verseText, range);
    const anchorUri = bibleAnchor(book, anchorChapter, anchorVerse);
    const sameVerseHighlights = annotations.highlights.filter(
      (highlight) => highlight.anchorUri === anchorUri,
    );
    const overlappingHighlights = sameVerseHighlights.filter(
      (highlight) =>
        (highlight.startOffset < offsets.end && highlight.endOffset > offsets.start) ||
        (highlight.exactText &&
          (highlight.exactText.includes(text) || text.includes(highlight.exactText))) ||
        (highlight.startOffset === 0 && highlight.endOffset === 0),
    );
    const highlightIds = (
      overlappingHighlights.length > 0 ? overlappingHighlights : sameVerseHighlights
    ).map((highlight) => highlight.id);

    const sameVerseNotes = annotations.notes.filter((note) =>
      note.anchors.some((anchor) => anchor.anchorUri === anchorUri),
    );
    const overlappingNotes = sameVerseNotes.filter((note) =>
      note.anchors.some(
        (anchor) =>
          anchor.anchorUri === anchorUri &&
          ((anchor.startOffset < offsets.end && anchor.endOffset > offsets.start) ||
            (anchor.exactText &&
              (anchor.exactText.includes(text) || text.includes(anchor.exactText))) ||
            (anchor.startOffset === 0 && anchor.endOffset === 0)),
      ),
    );
    const noteIds = (overlappingNotes.length > 0 ? overlappingNotes : sameVerseNotes).map(
      (note) => note.id,
    );
    setSelectionMenu(null);
    setContextMenu({
      x: Math.max(12, Math.min(window.innerWidth - 260, event.clientX + 4)),
      y: Math.max(12, Math.min(window.innerHeight - 280, event.clientY + 4)),
      text,
      anchorUri,
      label: `${currentBook?.name ?? "Biblia"} ${anchorChapter}:${anchorVerse}`,
      startOffset: offsets.start,
      endOffset: offsets.end,
      highlightIds,
      noteIds,
    });
  }

  const selectionHighlightIds = useMemo(() => {
    if (!selectionMenu) return [] as string[];
    const sameVerse = annotations.highlights.filter(
      (h) => h.anchorUri === selectionMenu.anchorUri,
    );
    const overlapping = sameVerse.filter(
      (h) =>
        (h.startOffset < selectionMenu.endOffset &&
          h.endOffset > selectionMenu.startOffset) ||
        (h.exactText &&
          (h.exactText.includes(selectionMenu.text) ||
            selectionMenu.text.includes(h.exactText))) ||
        (h.startOffset === 0 && h.endOffset === 0),
    );
    return (overlapping.length > 0 ? overlapping : sameVerse).map((h) => h.id);
  }, [selectionMenu, annotations.highlights]);

  async function deleteSelectionHighlights() {
    if (selectionHighlightIds.length === 0) return;
    try {
      for (const id of selectionHighlightIds) {
        await invoke("highlight_delete", { id });
      }
      setSelectionMenu(null);
      window.getSelection()?.removeAllRanges();
      setAnnotationsVersion((current) => current + 1);
      setStatus("Resaltado eliminado.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function deleteHighlightById(id: string) {
    try {
      await invoke("highlight_delete", { id });
      setAnnotationsVersion((current) => current + 1);
      setStatus("Resaltado eliminado.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function deleteHighlightsForVerse(chapterNum: number, verseNum: number) {
    const items = highlightsByVerse.get(`${chapterNum}-${verseNum}`) ?? [];
    if (items.length === 0) return;
    try {
      for (const item of items) {
        await invoke("highlight_delete", { id: item.id });
      }
      setAnnotationsVersion((current) => current + 1);
      setStatus("Resaltado del versículo eliminado.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function deleteContextHighlight() {
    if (!contextMenu) return;
    try {
      for (const id of contextMenu.highlightIds) {
        await invoke("highlight_delete", { id });
      }
      setContextMenu(null);
      setAnnotationsVersion((current) => current + 1);
      setStatus("Resaltado eliminado.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function deleteContextNote() {
    if (!contextMenu) return;
    if (!window.confirm("¿Eliminar la nota anclada a esta selección?")) return;
    try {
      for (const id of contextMenu.noteIds) {
        await invoke("note_delete", { id });
      }
      setContextMenu(null);
      setAnnotationsVersion((current) => current + 1);
      setStatus("Nota anclada eliminada.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function loadNoteIntoFloating(
    noteSummary: AnchoredNote | undefined,
    anchor: NoteSeed,
    x: number,
    y: number,
    chooserOnly = false,
  ) {
    if (noteSummary) {
      try {
        const detail = await invoke<{
          id: string;
          title: string;
          contentJson: string;
          plainText: string;
        }>("note_get", { id: noteSummary.id });
        setFloatingNote({
          x: Math.max(16, Math.min(window.innerWidth - 380, x)),
          y: Math.max(16, Math.min(window.innerHeight - 360, y)),
          anchor,
          noteId: detail.id,
          title: detail.title,
          body: tipTapDocToText(detail.contentJson, detail.plainText),
          chooserOnly,
        });
        return;
      } catch {
        // Fallback to summary
      }
    }
    setFloatingNote({
      x: Math.max(16, Math.min(window.innerWidth - 380, x)),
      y: Math.max(16, Math.min(window.innerHeight - 360, y)),
      anchor,
      noteId: noteSummary?.id ?? null,
      title: noteSummary?.title ?? `Nota sobre ${anchor.label}`,
      body: noteSummary?.excerpt ?? "",
      chooserOnly,
    });
  }

  async function loadNoteIntoSidePanel(
    noteSummary: AnchoredNote | undefined,
    anchor: NoteSeed,
  ) {
    setPanelOpen(true);
    setPanelTab("notes");
    if (noteSummary) {
      try {
        const detail = await invoke<{
          id: string;
          title: string;
          contentJson: string;
          plainText: string;
        }>("note_get", { id: noteSummary.id });
        setSideNoteId(detail.id);
        setSideNoteTitle(detail.title);
        setSideNoteBody(tipTapDocToText(detail.contentJson, detail.plainText));
        setSideNoteAnchor(anchor);
        return;
      } catch {
        // Fallback
      }
    }
    setSideNoteId(noteSummary?.id ?? null);
    setSideNoteTitle(noteSummary?.title ?? `Nota sobre ${anchor.label}`);
    setSideNoteBody(noteSummary?.excerpt ?? "");
    setSideNoteAnchor(anchor);
  }

  async function handleVerseNoteBadgeClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    verse: Verse,
  ) {
    event.stopPropagation();
    selectVerse(verse.chapter, verse.verse);
    const key = `${verse.chapter}-${verse.verse}`;
    const verseNotes = notesByVerse.get(key) ?? [];
    const primaryNote = verseNotes[0];
    const primaryAnchor = primaryNote?.anchors.find(
      (a) => a.anchorUri === bibleAnchor(book, verse.chapter, verse.verse),
    );
    const anchor: NoteSeed = {
      anchorUri: bibleAnchor(book, verse.chapter, verse.verse),
      exactText: primaryAnchor?.exactText || plainTextFromHtml(verse.html).slice(0, 180),
      startOffset: primaryAnchor?.startOffset ?? 0,
      endOffset: primaryAnchor?.endOffset ?? 0,
      label: `${currentBook?.name ?? "Biblia"} ${verse.chapter}:${verse.verse}`,
    };

    const rect = event.currentTarget.getBoundingClientRect();
    const behavior = uiCustomization.noteOpenBehavior;
    if (behavior === "sidepanel") {
      await loadNoteIntoSidePanel(primaryNote, anchor);
    } else if (behavior === "ask") {
      await loadNoteIntoFloating(primaryNote, anchor, rect.left - 320, rect.bottom + 6, true);
    } else {
      await loadNoteIntoFloating(primaryNote, anchor, rect.left - 320, rect.bottom + 6, false);
    }
  }

  async function saveFloatingNote() {
    if (!floatingNote) return;
    try {
      const contentJson = textToTipTapDoc(floatingNote.body);
      const saved = await invoke<{ id: string }>("note_upsert", {
        input: {
          id: floatingNote.noteId,
          title: floatingNote.title.trim() || `Nota sobre ${floatingNote.anchor.label}`,
          contentJson,
          plainText: floatingNote.body.trim(),
          tags: [],
          anchors: [floatingNote.anchor],
        },
      });
      setFloatingNote((current) => (current ? { ...current, noteId: saved.id } : null));
      setAnnotationsVersion((current) => current + 1);
      setStatus("Nota guardada.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function deleteFloatingNote() {
    if (!floatingNote?.noteId) {
      setFloatingNote(null);
      return;
    }
    try {
      await invoke("note_delete", { id: floatingNote.noteId });
      setFloatingNote(null);
      setAnnotationsVersion((current) => current + 1);
      setStatus("Nota eliminada.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function saveSidePanelNote() {
    const anchor: NoteSeed = sideNoteAnchor ?? {
      anchorUri: bibleAnchor(book, chapter, activeVerse),
      exactText: activeVerseText.slice(0, 180),
      startOffset: 0,
      endOffset: 0,
      label: `${currentBook?.name ?? "Biblia"} ${chapter}:${activeVerse}`,
    };
    try {
      const contentJson = textToTipTapDoc(sideNoteBody);
      const saved = await invoke<{ id: string }>("note_upsert", {
        input: {
          id: sideNoteId,
          title: sideNoteTitle.trim() || `Nota sobre ${anchor.label}`,
          contentJson,
          plainText: sideNoteBody.trim(),
          tags: [],
          anchors: [anchor],
        },
      });
      setSideNoteId(saved.id);
      setSideNoteAnchor(anchor);
      setAnnotationsVersion((current) => current + 1);
      setStatus("Nota guardada en el panel.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function deleteNoteById(id: string) {
    try {
      await invoke("note_delete", { id });
      if (sideNoteId === id) {
        setSideNoteId(null);
        setSideNoteTitle("");
        setSideNoteBody("");
      }
      if (floatingNote?.noteId === id) {
        setFloatingNote(null);
      }
      setAnnotationsVersion((current) => current + 1);
      setStatus("Nota eliminada.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  function startNewSidePanelNoteForActiveVerse() {
    const label = `${currentBook?.name ?? "Biblia"} ${chapter}:${activeVerse}`;
    setSideNoteId(null);
    setSideNoteTitle(`Nota sobre ${label}`);
    setSideNoteBody("");
    setSideNoteAnchor({
      anchorUri: bibleAnchor(book, chapter, activeVerse),
      exactText: activeVerseText.slice(0, 180),
      startOffset: 0,
      endOffset: 0,
      label,
    });
  }

  function openFloatingNoteFromSelection() {
    if (!selectionMenu) return;
    const anchor: NoteSeed = {
      anchorUri: selectionMenu.anchorUri,
      exactText: selectionMenu.text,
      startOffset: selectionMenu.startOffset,
      endOffset: selectionMenu.endOffset,
      label: selectionMenu.label,
    };
    const existing = annotations.notes.find((n) =>
      n.anchors.some((a) => a.anchorUri === selectionMenu.anchorUri),
    );
    void loadNoteIntoFloating(existing, anchor, selectionMenu.x, selectionMenu.y, false);
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
  }

  function openSidePanelNoteFromSelection() {
    if (!selectionMenu) return;
    const anchor: NoteSeed = {
      anchorUri: selectionMenu.anchorUri,
      exactText: selectionMenu.text,
      startOffset: selectionMenu.startOffset,
      endOffset: selectionMenu.endOffset,
      label: selectionMenu.label,
    };
    const existing = annotations.notes.find((n) =>
      n.anchors.some((a) => a.anchorUri === selectionMenu.anchorUri),
    );
    void loadNoteIntoSidePanel(existing, anchor);
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
  }

  function openNoteFromContext() {
    if (!contextMenu) return;
    const anchor: NoteSeed = {
      anchorUri: contextMenu.anchorUri,
      exactText: contextMenu.text,
      startOffset: contextMenu.startOffset,
      endOffset: contextMenu.endOffset,
      label: contextMenu.label,
    };
    if (uiCustomization.noteOpenBehavior === "floating") {
      const existing = annotations.notes.find((n) =>
        n.anchors.some((a) => a.anchorUri === contextMenu.anchorUri),
      );
      void loadNoteIntoFloating(existing, anchor, contextMenu.x, contextMenu.y, false);
    } else if (uiCustomization.noteOpenBehavior === "sidepanel") {
      const existing = annotations.notes.find((n) =>
        n.anchors.some((a) => a.anchorUri === contextMenu.anchorUri),
      );
      void loadNoteIntoSidePanel(existing, anchor);
    } else {
      setNoteSeed(anchor);
      setShowNotes(true);
    }
    setContextMenu(null);
    window.getSelection()?.removeAllRanges();
  }

  function openFloatingNoteFromContext() {
    if (!contextMenu) return;
    const anchor: NoteSeed = {
      anchorUri: contextMenu.anchorUri,
      exactText: contextMenu.text,
      startOffset: contextMenu.startOffset,
      endOffset: contextMenu.endOffset,
      label: contextMenu.label,
    };
    const existing = annotations.notes.find((n) =>
      n.anchors.some((a) => a.anchorUri === contextMenu.anchorUri),
    );
    void loadNoteIntoFloating(existing, anchor, contextMenu.x, contextMenu.y, false);
    setContextMenu(null);
    window.getSelection()?.removeAllRanges();
  }

  function openSideNoteFromContext() {
    if (!contextMenu) return;
    const anchor: NoteSeed = {
      anchorUri: contextMenu.anchorUri,
      exactText: contextMenu.text,
      startOffset: contextMenu.startOffset,
      endOffset: contextMenu.endOffset,
      label: contextMenu.label,
    };
    const existing = annotations.notes.find((n) =>
      n.anchors.some((a) => a.anchorUri === contextMenu.anchorUri),
    );
    void loadNoteIntoSidePanel(existing, anchor);
    setContextMenu(null);
    window.getSelection()?.removeAllRanges();
  }

  function openAnchor(anchorUri: string) {
    const parsed = parseAnchor(anchorUri);
    if (!parsed) {
      setStatus(`Ancla no reconocida: ${anchorUri}`);
      return;
    }
    if (parsed.kind === "bible") {
      applyPreferredBible();
      setBook(parsed.book);
      setChapter(parsed.chapter);
      setActiveVerse(parsed.verse);
      setView("reader");
    } else {
      const chapter = /chapter=(\d+)/.exec(parsed.selector);
      setBookId(parsed.resourceId);
      if (chapter) setBookSpine(Number(chapter[1]));
      setView("book");
    }
    setShowNotes(false);
    setNoteSeed(null);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectionMenu(null);
      setContextMenu(null);
      setThemeMenuOpen(false);
      setFormatMenuOpen(false);
      setInterlinearMenuOpen(false);
      setSidebarSettingsOpen(false);
      setShowTts(false);
      setShowCompare(false);
      setShowNotes(false);
      setShowAssistant(false);
      setShowWorkspaces(false);
      window.getSelection()?.removeAllRanges();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!themeMenuOpen) return;
    const closeTheme = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest(".theme-picker")) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeTheme);
    return () => document.removeEventListener("mousedown", closeTheme);
  }, [themeMenuOpen]);

  useEffect(() => {
    if (!formatMenuOpen) return;
    const closeFormat = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest(".format-picker")) {
        setFormatMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeFormat);
    return () => document.removeEventListener("mousedown", closeFormat);
  }, [formatMenuOpen]);

  useEffect(() => {
    if (!sidebarSettingsOpen) return;
    const closeSidebar = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest(".sidebar-settings")) {
        setSidebarSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", closeSidebar);
    return () => document.removeEventListener("mousedown", closeSidebar);
  }, [sidebarSettingsOpen]);

  useEffect(() => {
    if (!interlinearMenuOpen) return;
    const closeInterlinear = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest(".interlinear-picker")) {
        setInterlinearMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeInterlinear);
    return () => document.removeEventListener("mousedown", closeInterlinear);
  }, [interlinearMenuOpen]);

  useEffect(() => {
    if (!selectionMenu && !contextMenu) return;
    const onPointer = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      if (target?.closest(".selection-popover, .context-menu")) return;
      setSelectionMenu(null);
      setContextMenu(null);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [selectionMenu, contextMenu]);

  function openRagContext(context: RagContext) {
    if (context.kind === "bible") {
      applyPreferredBible();
      setBook(context.book);
      setChapter(context.chapter);
      setActiveVerse(context.verse);
      setView("reader");
    } else if (context.kind === "commentary") {
      applyPreferredBible();
      setBook(context.book || book);
      setChapter(context.chapter || chapter);
      setActiveVerse(context.verse || activeVerse);
      setCommentaryId(context.resourceId);
      setPanelTab("commentary");
      setPanelOpen(true);
      setView("reader");
    } else if (context.kind === "dictionary") {
      setDictionaryId(context.resourceId);
      setTopic(context.label);
      setPanelTab("dictionary");
      setPanelOpen(true);
      setView("reader");
    } else {
      setBookId(context.resourceId);
      setBookSpine(context.spine);
      setView("book");
    }
    setShowAssistant(false);
  }

  function selectVerse(chapterNumber: number, verseNumber: number) {
    if (chapterNumber !== chapter) setChapter(chapterNumber);
    setActiveVerse(verseNumber);
    requestAnimationFrame(() => {
      readerRef.current
        ?.querySelector(`[data-ref="${chapterNumber}-${verseNumber}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  async function refreshIndexStatus() {
    try {
      const status = await invoke<GlobalIndexStatus>("global_index_status");
      setIndexStatus(status);
      return status;
    } catch (error) {
      setIndexError(String(error));
      return null;
    }
  }

  async function performSearch(
    query: string,
    mode: "unified" | "global" | "classic" | "advanced",
  ) {
    const clean = query.trim();
    if (!clean) return;
    setBusy(true);
    setStatus("");
    try {
      if (mode === "advanced") {
        const hits = await invoke<UnifiedSearchResult[]>("search_advanced", {
          query: clean,
          limit: 100,
          expandByStrong,
        });
        setUnifiedHits(hits);
        setGlobalHits([]);
        setSearchHits([]);
      } else if (mode === "unified") {
        const hits = await invoke<UnifiedSearchResult[]>("search_everything", {
          query: clean,
          limit: 60,
        });
        setUnifiedHits(hits);
        setGlobalHits([]);
        setSearchHits([]);
      } else if (mode === "global") {
        const hits = await invoke<GlobalSearchHit[]>("global_search", {
          query: clean,
          limit: 120,
        });
        setGlobalHits(hits);
        setUnifiedHits([]);
        setSearchHits([]);
      } else {
        const hits = await invoke<SearchHit[]>("search", { query: clean, limit: 80 });
        setSearchHits(hits);
        setGlobalHits([]);
        setUnifiedHits([]);
      }
      localStorage.setItem(
        LAST_SEARCH_KEY,
        JSON.stringify({ query: clean, mode }),
      );
      setView("search");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    setShowHome(false);
    setView("search");
    await performSearch(searchQuery, searchMode);
  }

  async function indexNow() {
    if (!indexStatus || indexing) return;
    setShowIndexPrompt(false);
    setIndexing(true);
    setIndexError("");
    const pending = indexStatus.pending;
    let done = 0;
    for (const resource of pending) {
      setIndexProgress({ done, total: pending.length, title: resource.title });
      try {
        await invoke<IndexReport>("global_index_resource", {
          resourceId: resource.id,
        });
        done += 1;
        setIndexProgress({ done, total: pending.length, title: resource.title });
      } catch (error) {
        setIndexError(String(error));
        break;
      }
    }
    await refreshIndexStatus();
    setIndexing(false);
  }

  async function reindexAll() {
    if (indexing) return;
    setIndexing(true);
    setIndexError("");
    setIndexProgress({ done: 0, total: 0, title: "Reindexando toda la biblioteca" });
    try {
      await invoke<IndexReport[]>("global_index_all");
      await refreshIndexStatus();
    } catch (error) {
      setIndexError(String(error));
    } finally {
      setIndexing(false);
    }
  }

  function postponeIndexing() {
    localStorage.setItem("teoamoxtli.indexer-prompt.v1", "later");
    localStorage.setItem(
      "teoamoxtli.indexer-deferred-until.v1",
      String(Date.now() + 7 * 24 * 60 * 60 * 1000),
    );
    setShowIndexPrompt(false);
  }

  function neverAskIndexing() {
    localStorage.setItem("teoamoxtli.indexer-prompt.v1", "never");
    setShowIndexPrompt(false);
  }

  function openUnifiedHit(hit: UnifiedSearchResult) {
    if (hit.sourceType === "user_note" && hit.noteId) {
      setNoteFocusId(hit.noteId);
      setShowNotes(true);
      return;
    }
    if (hit.sourceType === "pbb_book") {
      setModularBook({
        resourceId: hit.resourceId,
        spine: hit.spine ?? 0,
      });
      setShowModular(true);
      return;
    }
    if (hit.sourceType === "dictionary") {
      setDictionaryId(hit.resourceId);
      setPanelTab("dictionary");
      setPanelOpen(true);
      if (hit.reference.startsWith("dict:")) {
        void lookupTopic(hit.reference.slice("dict:".length));
      } else {
        void lookupTopic(hit.reference);
      }
      return;
    }
    if (hit.sourceType === "book") {
      setBookId(hit.resourceId);
      setBookSpine(hit.spine ?? 0);
      setView("book");
      return;
    }
    if (hit.sourceType === "commentary") {
      setCommentaryId(hit.resourceId);
      setPanelTab("commentary");
      setPanelOpen(true);
    }
    const isBibleHit = hit.sourceType === "bible";
    if (isBibleHit) {
      setBibleId(hit.resourceId);
    }
    if (hit.book && hit.chapter && hit.verse) {
      openReference(hit.book, hit.chapter, hit.verse, !isBibleHit);
    }
  }

  function openGlobalHit(hit: GlobalSearchHit) {
    const parsed = parseGlobalReference(hit);
    if (hit.moduleType === "dictionary" && parsed.topic) {
      setDictionaryId(hit.resourceId);
      setPanelTab("dictionary");
      setPanelOpen(true);
      void lookupTopic(parsed.topic);
      return;
    }
    if (hit.moduleType === "book") {
      setBookId(hit.resourceId);
      setBookSpine(parsed.spine ?? 0);
      setView("book");
      return;
    }
    if (hit.moduleType === "commentary") {
      setCommentaryId(hit.resourceId);
      setPanelTab("commentary");
      setPanelOpen(true);
    }
    const isBibleHit = hit.moduleType === "bible";
    if (isBibleHit) {
      setBibleId(hit.resourceId);
    }
    if (parsed.book) {
      openReference(parsed.book, parsed.chapter ?? 1, parsed.verse ?? 1, !isBibleHit);
    }
  }

  async function lookupTopic(nextTopic: string) {
    setTopic(nextTopic);
    if (!dictionaryId || !nextTopic.trim()) return;
    try {
      const entry = await invoke<DictionaryEntry | null>("lookup_dictionary", {
        resourceId: dictionaryId,
        topic: nextTopic,
      });
      setDictionaryEntry(entry);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function importFromPath(path: string) {
    if (!path) return;
    setBusy(true);
    try {
      const reports = await invoke<ImportReport[]>("import_folder", { path });
      await refreshCatalog();
      await refreshIndexStatus();
      setShowImport(false);
      setStatus(`${reports.length} módulos importados correctamente.`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function importLibrary() {
    await importFromPath(importPath.trim());
  }

  async function chooseFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Selecciona la carpeta de módulos o libros",
    });
    if (typeof selected === "string") {
      setImportPath(selected);
      await importFromPath(selected);
    }
  }

  async function chooseImportFile() {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Selecciona un libro o módulo (.azw3, .epub, .mobi, .docx, .bbli, .cmti, .dcti)",
      filters: [
        {
          name: "Libros y módulos (AZW3, EPUB, MOBI, DOCX, e-Sword, MySword)",
          extensions: [
            "azw3",
            "epub",
            "mobi",
            "docx",
            "bbli",
            "bblx",
            "cmti",
            "dcti",
            "refi",
            "mapx",
            "mybible",
          ],
        },
      ],
    });
    if (typeof selected === "string") {
      setImportPath(selected);
      await importFromPath(selected);
    }
  }

  async function chooseInterlinearFile() {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Selecciona STEPBible-Data (.zip) o TAGNT (.txt)",
      filters: [
        { name: "STEPBible", extensions: ["zip", "txt"] },
      ],
    });
    if (typeof selected === "string") {
      setInterlinearPath(selected);
    }
  }

  async function importInterlinear() {
    const path = interlinearPath.trim();
    if (!path) {
      setStatus("Selecciona el ZIP de STEPBible o un archivo TAGNT.");
      return;
    }
    setInterlinearBusy(true);
    try {
      const report = await invoke<InterlinearImportReport>("import_interlinear", {
        path,
      });
      setStatus(
        `Interlineal importado: ${report.tokens.toLocaleString("es")} tokens, ${report.books} libros y ${report.verses.toLocaleString("es")} versículos.`,
      );
      setInterlinearStatus({
        tokens: report.tokens,
        books: report.books,
        verses: report.verses,
      });
      await refreshCatalog();
      if (readerMode === "interlinear") {
        const data = await invoke<InterlinearVerseData[]>(
          "get_interlinear_chapter",
          { book, chapter },
        );
        setInterlinearVerses(data);
      }
    } catch (error) {
      setStatus(String(error));
    } finally {
      setInterlinearBusy(false);
    }
  }

  const activeVerseText = useMemo(() => {
    const verse = chapterVerses.find((item) => item.verse === activeVerse);
    return verse ? plainTextFromHtml(verse.html) : "";
  }, [chapterVerses, activeVerse]);

  function openWordStudy(
    strong: string,
    query = "",
    reference: { book: number; chapter: number; verse: number } | null = null,
  ) {
    setWordStudyStrong(strong);
    setWordStudyQuery(query);
    setWordStudyReference(reference);
    setShowWordStudy(true);
  }

  function openStrong(strong: string) {
    setTopic(strong);
    setPanelTab("dictionary");
    setPanelOpen(true);
    setView("reader");
    openWordStudy(strong, "", { book, chapter, verse: activeVerse });
  }

  function applyPreferredBible() {
    const preferred = bibles.find(
      (resource) => resource.id === uiCustomization.preferredBibleId,
    );
    if (preferred) setBibleId(preferred.id);
  }

  function openReference(
    nextBook: number,
    nextChapter: number,
    nextVerse: number,
    usePreferred = true,
  ) {
    if (usePreferred) applyPreferredBible();
    setBook(nextBook);
    setChapter(nextChapter);
    setActiveVerse(nextVerse);
    setReaderMode("verse");
    setPageIndex(0);
    setView("reader");
  }

  function openSearchHit(hit: SearchHit) {
    if (hit.kind === "dictionary") {
      setPanelTab("dictionary");
      setPanelOpen(true);
      void lookupTopic(hit.label);
      return;
    }
    if (hit.kind === "book") {
      setBookId(hit.resourceId);
      setBookSpine(hit.chapter);
      setView("book");
      return;
    }
    const isBibleHit = hit.kind === "bible" || hit.kind === "verse";
    if (isBibleHit) setBibleId(hit.resourceId);
    openReference(hit.book, hit.chapter, hit.verse, !isBibleHit);
  }

  function openResource(resource: Resource) {
    if (resource.kind === "bible") {
      setBibleId(resource.id);
      setView("reader");
    } else if (resource.kind === "commentary") {
      setCommentaryId(resource.id);
      setPanelTab("commentary");
      setPanelOpen(true);
      setView("reader");
    } else if (resource.kind === "dictionary") {
      setDictionaryId(resource.id);
      setPanelTab("dictionary");
      setPanelOpen(true);
      setView("reader");
    } else if (resource.kind === "book") {
      setBookId(resource.id);
      const progress = readingProgressMap[resource.id];
      if (progress) setBookSpine(progress.spine);
      setView("book");
    }
  }

  async function toggleResourcePriority(resource: Resource) {
    try {
      await invoke("set_resource_priority", {
        resourceId: resource.id,
        priority: resource.searchPriority ? 0 : 1,
      });
      await refreshCatalog();
      setStatus(
        resource.searchPriority
          ? `«${resource.title}» ya no es prioritario.`
          : `«${resource.title}» se priorizará en las búsquedas.`,
      );
    } catch (error) {
      setStatus(String(error));
    }
  }

  function requestDeleteResource(resource: Resource) {
    if (resource.cloudSynced) return;
    setDeleteTarget(resource);
  }

  async function confirmDeleteResource() {
    const resource = deleteTarget;
    if (!resource) return;
    setDeleting(true);
    try {
      await invoke("delete_resource", { resourceId: resource.id });
      if (uiCustomization.preferredBibleId === resource.id) {
        uiCustomization.update({ preferredBibleId: "" });
      }
      await refreshCatalog();
      setStatus(`«${resource.title}» se eliminó de la biblioteca.`);
      setDeleteTarget(null);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setDeleting(false);
    }
  }

  async function toggleFullscreen() {
    const next = !isFullscreen;
    try {
      await getCurrentWindow().setFullscreen(next);
      setIsFullscreen(next);
    } catch (error) {
      setStatus(`No se pudo cambiar a pantalla completa: ${String(error)}`);
    }
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const onMove = (moveEvent: PointerEvent) => {
      setPanelWidth(Math.min(560, Math.max(280, startWidth - (moveEvent.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function saveWorkspace() {
    const workspace: Workspace = {
      id: newId(),
      name: workspaceName.trim() || `Entorno ${workspaces.length + 1}`,
      createdAt: Date.now(),
      view,
      bibleId,
      commentaryId,
      dictionaryId,
      bookId,
      book,
      chapter,
      activeVerse,
      readerMode,
      showNumbers,
      panelOpen,
      panelWidth,
      fontScale,
      focusMode,
      resourcesOpen,
      readerFont,
      studyFont,
      studyFontScale,
    };
    setWorkspaces((current) => [workspace, ...current].slice(0, 24));
    setWorkspaceName("");
    setStatus(`Entorno “${workspace.name}” guardado.`);
  }

  function updateWorkspaceInPlace(workspaceId: string) {
    setWorkspaces((current) =>
      current.map((ws) =>
        ws.id === workspaceId
          ? {
              ...ws,
              createdAt: Date.now(),
              view,
              bibleId,
              commentaryId,
              dictionaryId,
              bookId,
              book,
              chapter,
              activeVerse,
              readerMode,
              showNumbers,
              panelOpen,
              panelWidth,
              fontScale,
              focusMode,
              resourcesOpen,
              readerFont,
              studyFont,
              studyFontScale,
            }
          : ws,
      ),
    );
    setStatus("Entorno actualizado con la disposición actual.");
  }

  function openAvanzadoModularPreset(presetId: string) {
    setModularPreset(presetId);
    setShowWorkspaces(false);
    setShowModular(true);
  }

  async function openScriptureRefPreview(
    refBook: number,
    refChapter: number,
    refVerse: number,
    refEndVerse: number,
    label: string,
    clientX: number,
    clientY: number,
  ) {
    // Also synchronize the study panel's active reference immediately!
    applyPreferredBible();
    setBook(refBook);
    setChapter(refChapter);
    setActiveVerse(refVerse);

    const x = Math.max(16, Math.min(window.innerWidth - 400, clientX - 160));
    const y = Math.max(16, Math.min(window.innerHeight - 280, clientY + 14));
    setScripturePreview({
      x,
      y,
      label,
      book: refBook,
      chapter: refChapter,
      verse: refVerse,
      endVerse: refEndVerse,
      text: "",
      loading: true,
    });

    if (!bibleId) {
      setScripturePreview((prev) =>
        prev ? { ...prev, loading: false, text: "Selecciona una Biblia activa." } : null,
      );
      return;
    }

    try {
      const targetPassage = await invoke<Passage>("get_passage", {
        resourceId: bibleId,
        book: refBook,
        chapter: refChapter,
      });
      const matchingVerses = targetPassage.verses.filter(
        (v) => v.verse >= refVerse && v.verse <= Math.max(refVerse, refEndVerse),
      );
      const rendered =
        matchingVerses.length > 0
          ? matchingVerses
              .map((v) => `${v.verse}. ${plainTextFromHtml(v.html)}`)
              .join(" ")
          : targetPassage.verses[0]
            ? `1. ${plainTextFromHtml(targetPassage.verses[0].html)}`
            : "No se encontró el versículo en esta versión.";
      setScripturePreview((prev) =>
        prev ? { ...prev, loading: false, text: rendered } : null,
      );
    } catch (error) {
      setScripturePreview((prev) =>
        prev ? { ...prev, loading: false, text: String(error) } : null,
      );
    }
  }

  function handleScriptureLinkClick(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    const polyglot = target?.closest?.(".editorial-hebrew, .editorial-greek") as HTMLElement | null;
    if (polyglot) {
      event.preventDefault();
      event.stopPropagation();
      lookupTextInDictionary((polyglot.textContent ?? "").trim());
      return;
    }
    const footnote = target?.closest?.("sup.footnote-ref, a[href*='#fn'], a[href*='#note']") as HTMLElement | null;
    if (footnote) {
      event.preventDefault();
      event.stopPropagation();
      const href = footnote.getAttribute("href") ?? "";
      const targetId = href.replace(/^#/, "");
      const source = targetId ? document.getElementById(targetId) : null;
      setFootnotePreview({
        x: Math.max(12, Math.min(window.innerWidth - 300, event.clientX + 8)),
        y: Math.max(12, Math.min(window.innerHeight - 220, event.clientY + 8)),
        text: (source?.textContent ?? footnote.getAttribute("data-footnote") ?? footnote.getAttribute("title") ?? "Nota al pie").trim(),
      });
      return;
    }
    const external = target?.closest?.("a[href^='http://'], a[href^='https://'], a[href^='mailto:']") as HTMLAnchorElement | null;
    if (external) {
      event.preventDefault();
      event.stopPropagation();
      void openExternalUrl(external.href);
      return;
    }
    const tocLink = target?.closest?.(
      "a.book-toc-link, a[data-toc-anchor], a[href^='#']",
    ) as HTMLAnchorElement | null;
    if (tocLink && !tocLink.classList.contains("scripture-ref-link")) {
      event.preventDefault();
      event.stopPropagation();
      const rawSpine = tocLink.dataset.tocSpine;
      const rawAnchor =
        tocLink.dataset.tocAnchor ||
        tocLink.getAttribute("href")?.replace(/^#/, "") ||
        "";
      if (rawSpine !== undefined && rawSpine !== "") {
        const targetSpine = Number(rawSpine);
        if (!Number.isNaN(targetSpine) && targetSpine !== bookSpine) {
          pendingBookAnchorRef.current = rawAnchor || null;
          setBookSpine(targetSpine);
          return;
        }
      }
      if (rawAnchor) {
        const el = document.getElementById(rawAnchor);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
      const linkText = (tocLink.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (linkText) {
        const matchedChapter = bookChapters.find((ch) => {
          const title = ch.title.replace(/\s+/g, " ").trim().toLowerCase();
          return title === linkText || title.includes(linkText) || linkText.includes(title);
        });
        if (matchedChapter) {
          pendingBookAnchorRef.current = rawAnchor || null;
          setBookSpine(matchedChapter.spine);
        }
      }
      return;
    }

    const link = target?.closest?.("a.scripture-ref-link") as HTMLElement | null;
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const refBook = Number(link.dataset.book || 0);
    const refChapter = Number(link.dataset.chapter || 1);
    const refVerse = Number(link.dataset.verse || 1);
    const refEndVerse = Number(link.dataset.endVerse || refVerse);
    const label = link.dataset.label || link.textContent || `${refChapter}:${refVerse}`;
    if (refBook >= 1 && refBook <= 66) {
      void openScriptureRefPreview(
        refBook,
        refChapter,
        refVerse,
        refEndVerse,
        label,
        event.clientX,
        event.clientY,
      );
    }
  }

  function lookupTextInDictionary(rawText: string) {
    const cleaned = rawText
      .trim()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      .split(/\s+/)[0];
    if (!cleaned) return;
    setPanelOpen(true);
    setPanelTab("dictionary");
    setSelectionMenu(null);
    setContextMenu(null);
    void lookupTopic(cleaned);
  }

  function applyWorkspace(workspace: Workspace) {
    setView(workspace.view);
    setBibleId(workspace.bibleId);
    setCommentaryId(workspace.commentaryId);
    setDictionaryId(workspace.dictionaryId);
    setBookId(workspace.bookId);
    setBook(workspace.book);
    setChapter(workspace.chapter);
    setActiveVerse(workspace.activeVerse);
    setReaderMode(workspace.readerMode);
    useBibleFormatStore
      .getState()
      .setOption("showChapterVerseNumbers", workspace.showNumbers);
    setPanelOpen(workspace.panelOpen);
    setPanelWidth(workspace.panelWidth);
    setFontScale(workspace.fontScale);
    setFocusMode(workspace.focusMode);
    setResourcesOpen(workspace.resourcesOpen);
    setReaderFont(workspace.readerFont ?? "Literata");
    setStudyFont(workspace.studyFont ?? "Crimson Pro");
    setStudyFontScale(workspace.studyFontScale ?? 1);
    setShowWorkspaces(false);
    setStatus(`Entorno “${workspace.name}” aplicado.`);
  }

  function applyPreset(preset: "study" | "reading") {
    setView("reader");
    setReaderMode(preset === "reading" ? "book" : "verse");
    if (preset === "reading") {
      setChapter(1);
      setActiveVerse(1);
    }
    useBibleFormatStore
      .getState()
      .setOption("showChapterVerseNumbers", preset !== "reading");
    setPanelOpen(preset === "study");
    setPanelWidth(360);
    setFontScale(preset === "reading" ? 1.15 : 1);
    if (preset === "reading") setReaderWidth("wide");
    setReaderFont("Literata");
    setStudyFont("Crimson Pro");
    setStudyFontScale(1);
    setFocusMode(preset === "reading");
    setResourcesOpen(false);
    setShowWorkspaces(false);
    setStatus(preset === "reading" ? "Modo lectura activado." : "Modo estudio activado.");
  }

  function moveBook(delta: number) {
    const position = bookChapters.findIndex((item) => item.spine === bookSpine);
    const next = bookChapters[position + delta];
    if (next) setBookSpine(next.spine);
  }

  function updateBookProgress() {
    const element = bookReaderRef.current;
    if (!element) return;
    const max = element.scrollHeight - element.clientHeight;
    const next = max > 4 ? (element.scrollTop / max) * 100 : 100;
    setBookProgress(Math.min(100, Math.max(0, next)));
  }

  async function saveChapterRename(spine: number, currentTitle: string) {
    const title = renameDraft.trim();
    setRenamingChapter(null);
    if (!title || title === currentTitle) return;
    try {
      await invoke("book_rename_chapter", { resourceId: bookId, spine, newTitle: title });
      setBookStructureTick((value) => value + 1);
      setStatus("Capítulo renombrado.");
    } catch (error) { setStatus(String(error)); }
  }

  async function mergeBookChapter(spine: number) {
    if (spine <= 0) return;
    try {
      await invoke("book_merge_chapter_with_previous", { resourceId: bookId, spine });
      setBookStructureTick((value) => value + 1);
      setBookSpine(spine - 1);
      setStatus("Capítulo unido con el anterior.");
    } catch (error) { setStatus(String(error)); }
  }

  async function reconstructBookStructure() {
    if (!bookId) return;
    try {
      await invoke("reconstruct_book_structure", { resourceId: bookId });
      setBookStructureTick((value) => value + 1);
      setStatus("Índice y capítulos reconstruidos.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  function cycleBookColumns() {
    setBookTypesetting((previous) => ({
      ...previous,
      columns: previous.columns === 1 ? 2 : previous.columns === 2 ? 3 : 1,
    }));
  }

  function renderVerseRow(verse: Verse, compact = false) {
    const key = `${verse.chapter}-${verse.verse}`;
    const highlight = highlightByVerse.get(key);
    const verseHighlights = highlightsByVerse.get(key) ?? [];
    const verseNotes = notesByVerse.get(key) ?? [];
    const hasNote = verseNotes.length > 0;
    return (
      <div
        key={key}
        data-ref={key}
        className={[
          "verse-row",
          compact ? "compact" : "",
          verse.chapter === chapter && verse.verse === activeVerse ? "selected" : "",
          highlight ? "has-highlight" : "",
          hasNote ? "has-note" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          highlight
            ? ({
                "--highlight-color": HIGHLIGHT_COLORS[highlight] ?? HIGHLIGHT_COLORS.yellow,
              } as CSSProperties)
            : undefined
        }
        onClick={() => {
          selectVerse(verse.chapter, verse.verse);
        }}
      >
        <span className="verse-number">{verse.verse}</span>
        <div className="verse-body-wrap">
          <Html html={verse.html} className="verse-text" />
          {(hasNote || verseHighlights.length > 0) && (
            <span className="verse-annotations" onClick={(e) => e.stopPropagation()}>
              {hasNote && (
                <button
                  type="button"
                  className="verse-note-badge"
                  onClick={(event) => void handleVerseNoteBadgeClick(event, verse)}
                  title={`Nota: ${verseNotes[0]?.title || "Ver / editar nota"} (clic para abrir)`}
                  aria-label={`Abrir nota del versículo ${verse.verse}`}
                >
                  <Icon name="note" />
                  <span>{verseNotes.length > 1 ? `Nota (${verseNotes.length})` : "Nota"}</span>
                </button>
              )}
              {verseHighlights.length > 0 && (
                <button
                  type="button"
                  className="verse-highlight-badge"
                  onClick={() => void deleteHighlightsForVerse(verse.chapter, verse.verse)}
                  title="Borrar resaltado de este versículo"
                  aria-label={`Borrar resaltado del versículo ${verse.verse}`}
                >
                  <span
                    className="verse-highlight-dot"
                    style={{
                      background: HIGHLIGHT_COLORS[highlight ?? "yellow"] ?? HIGHLIGHT_COLORS.yellow,
                    }}
                  />
                  <span>Borrar resaltado ×</span>
                </button>
              )}
            </span>
          )}
        </div>
        {readingRibbon?.resourceId === "bible:canonical" &&
          readingRibbon.label === `${currentBook?.name ?? ""} ${verse.chapter}:${verse.verse}` && (
            <div className="reading-ribbon-banner">
              <RibbonIcon size={13} color="#d97706" /> Punto de lectura · {new Date(readingRibbon.createdAt * 1000).toLocaleDateString("es-MX")}
            </div>
          )}
      </div>
    );
  }

  useEffect(() => {
    if (showHermeneutics) {
      localStorage.setItem("teoamoxtli.hermeneutics-open.v1", "1");
    } else {
      localStorage.removeItem("teoamoxtli.hermeneutics-open.v1");
    }
  }, [showHermeneutics]);

  useEffect(() => {
    if (showDocuments) {
      localStorage.setItem("teoamoxtli.documents-open.v1", "1");
    } else {
      localStorage.removeItem("teoamoxtli.documents-open.v1");
    }
  }, [showDocuments]);

  useEffect(() => {
    if (showModular) {
      localStorage.setItem("teoamoxtli.modular-open.v1", "1");
    } else {
      localStorage.removeItem("teoamoxtli.modular-open.v1");
    }
  }, [showModular]);

  useEffect(() => {
    if (formationTab) {
      localStorage.setItem("teoamoxtli.formation-open.v1", formationTab);
    } else {
      localStorage.removeItem("teoamoxtli.formation-open.v1");
    }
  }, [formationTab]);

  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocusMode(false);
        setStatus("Modo enfoque cerrado.");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);

  useEffect(() => {
    if (localStorage.getItem("teoamoxtli.editorial-repair.v1") === "done") return;
    localStorage.setItem("teoamoxtli.editorial-repair.v1", "done");
    void invoke<number>("repair_all_books_typesetting")
      .then((count) => {
        if (count > 0) setStatus(`${count} capítulos re-maquetados.`);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setI18nLanguage(language);
    localStorage.setItem(LANGUAGE_KEY, language);
    if (language === "en") {
      requestAnimationFrame(() => applyEnglishDomTranslations());
    }
  }, [language]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "c") return;
      if (selectionMenu) {
        event.preventDefault();
        void copyWithCitation(selectionMenu.text, selectionMenu.anchorUri, selectionMenu.label);
        setSelectionMenu(null);
      } else if (contextMenu) {
        event.preventDefault();
        void copyWithCitation(contextMenu.text, contextMenu.anchorUri, contextMenu.label);
        setContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionMenu, contextMenu, uiCustomization.citationStyle, uiCustomization.includeTranslationEntry]);

  useEffect(() => {
    const label = view === "book"
      ? `${currentLibraryBook?.title ?? "Libro"} · capítulo ${bookSpine + 1}`
      : `${currentBook?.name ?? "Biblia"} ${chapter}`;
    setJumpHistory((current) => {
      if (current[0]?.label === label) return current;
      const entry: JumpEntry = {
        id: crypto.randomUUID(), label,
        resourceId: view === "book" ? bookId : "bible:canonical",
        spine: view === "book" ? bookSpine : 0, visitedAt: Date.now(),
      };
      const next = [entry, ...current].slice(0, 20);
      localStorage.setItem("teoamoxtli.reading-jump-history.v1", JSON.stringify(next));
      return next;
    });
  }, [view, book, chapter, bookId, bookSpine]);

  useEffect(() => {
    const resourceId = view === "book" ? bookId : "bible:canonical";
    void invoke<Array<{ id: string; resourceId: string; spine: number; label: string; createdAt: number; isPrimaryRibbon: boolean }>>(
      "bookmark_list",
      { resourceId },
    )
      .then((items) => setReadingRibbon(items.find((item) => item.isPrimaryRibbon) ?? null))
      .catch(() => setReadingRibbon(null));
    void invoke<BookmarkEntry[]>("bookmark_list", { resourceId })
      .then(setBookmarks)
      .catch(() => setBookmarks([]));
    void invoke<Array<{ resourceId: string; spine: number; overallPercent: number }>>("reading_progress_list")
      .then((items) => setReadingProgressMap(Object.fromEntries(items.map((item) => [item.resourceId, item]))))
      .catch(() => undefined);
  }, [view, bookId, bibleId]);

  function recordHistory(label: string, resourceId: string, spine: number) {
    const entry: JumpEntry = { id: crypto.randomUUID(), label, resourceId, spine, visitedAt: Date.now() };
    setJumpHistory((current) => {
      const next = [entry, ...current].slice(0, 20);
      localStorage.setItem("teoamoxtli.reading-jump-history.v1", JSON.stringify(next));
      return next;
    });
    setReturnTarget(entry);
  }

  function navigateToBookmark(label: string, resourceId: string, spine: number) {
    recordHistory(currentLabel(), resourceId, spine);
    if (resourceId === "bible:canonical") {
      const match = label.match(/^(.*)\s+(\d+):(\d+)$/);
      const targetBook = match ? books.find((item) => item.name === match[1]) : undefined;
      if (targetBook && match) {
        setBook(targetBook.number); setChapter(Number(match[2])); setActiveVerse(Number(match[3])); setView("reader");
      }
    } else {
      setBookSpine(spine); setView("book");
    }
    setBookmarksOpen(false);
  }

  function currentLabel() {
    return view === "book" ? currentLibraryBook?.title ?? "Libro" : `${currentBook?.name ?? "Biblia"} ${chapter}:${activeVerse}`;
  }

  async function saveSecondaryBookmark(title: string, note: string, color: string) {
    const resourceId = view === "book" ? bookId : "bible:canonical";
    const saved = await invoke<BookmarkEntry>("bookmark_add", {
      resourceId, spine: view === "book" ? bookSpine : 0, paragraphIndex: 0,
      scrollRatio: view === "book" ? bookProgress / 100 : 0,
      label: title.trim() || currentLabel(), note, excerpt: selectedVerseHtml(activeVerse), color,
    });
    setBookmarks((current) => [...current, saved]);
    setStatus("Marcador guardado.");
  }

  async function deleteBookmark(id: string) {
    await invoke("bookmark_delete", { id });
    setBookmarks((current) => current.filter((item) => item.id !== id));
    if (readingRibbon?.id === id) setReadingRibbon(null);
  }

  async function placeReadingRibbon() {
    const resourceId = view === "book" ? bookId : "bible:canonical";
    const label =
      view === "book"
        ? `${currentLibraryBook?.title ?? "Libro"} · ${bookChapters.find((item) => item.spine === bookSpine)?.title ?? `capítulo ${bookSpine + 1}`}`
        : `${currentBook?.name ?? "Biblia"} ${chapter}:${activeVerse}`;
    const saved = await invoke<{ id: string; resourceId: string; spine: number; label: string; createdAt: number }>(
      "bookmark_set_ribbon",
      {
        resourceId,
        spine: view === "book" ? bookSpine : 0,
        paragraphIndex: 0,
        scrollRatio: view === "book" ? bookProgress / 100 : 0,
        label,
        note: "",
        excerpt: view === "book" ? "" : selectedVerseHtml(activeVerse),
      },
    );
    setReadingRibbon(saved);
    setBookmarksOpen(false);
    setStatus("Separador de lectura colocado.");
  }

  function selectedVerseHtml(verse: number) {
    return passage?.verses.find((item) => item.verse === verse)?.html?.replace(/<[^>]+>/g, " ") ?? "";
  }

  async function removeReadingRibbon() {
    if (!readingRibbon) return;
    try {
      await invoke("bookmark_delete", { id: readingRibbon.id });
      setReadingRibbon(null);
      setBookmarksOpen(false);
      setStatus("Separador de lectura eliminado.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  function goToReadingRibbon() {
    if (!readingRibbon) return;
    recordHistory(currentLabel(), view === "book" ? bookId : "bible:canonical", bookSpine);
    if (readingRibbon.resourceId === "bible:canonical") {
      const match = readingRibbon.label.match(/^(.*)\s+(\d+):(\d+)$/);
      const targetBook = match ? books.find((item) => item.name === match[1]) : undefined;
      if (targetBook && match) {
        setBook(targetBook.number);
        setChapter(Number(match[2]));
        setActiveVerse(Number(match[3]));
        setView("reader");
      }
    } else {
      setBookSpine(readingRibbon.spine);
      setView("book");
    }
    setBookmarksOpen(false);
  }

  async function completeCurrentUnit() {
    const resourceId = view === "book" ? bookId : "bible:canonical";
    const unit = view === "book" ? bookSpine : chapter;
    await invoke("toggle_reading_unit_completed", { resourceId, spine: unit, completed: true });
    setStatus("Capítulo completado.");
  }

  async function persistBookChapterHtml(html: string) {
    await invoke("update_book_chapter_html", { resourceId: bookId, spine: bookSpine, html });
    setBookChapter((current) => current ? { ...current, html } : current);
  }

  async function applyBookBlockTag(tag: "h1" | "h2" | "h3" | "h4" | "p", target?: HTMLElement | null) {
    const node = target ?? bookContextNodeRef.current;
    const content = bookReaderRef.current?.querySelector<HTMLElement>(".epub-content");
    if (!node || !content) return;
    const replacement = document.createElement(tag);
    if (tag !== "p") replacement.id = `sec-${Date.now()}`;
    replacement.innerHTML = node.innerHTML;
    node.replaceWith(replacement);
    bookContextNodeRef.current = replacement;
    setContextMenu(null);
    try { await persistBookChapterHtml(content.innerHTML); setStatus(`Bloque convertido a ${tag.toUpperCase()}.`); }
    catch (error) { setStatus(String(error)); }
  }

  async function splitBookChapterAt(target?: HTMLElement | null) {
    const node = target ?? bookContextNodeRef.current;
    const content = bookReaderRef.current?.querySelector<HTMLElement>(".epub-content");
    if (!node || !content || !bookChapter) return;
    const children = Array.from(content.children) as HTMLElement[];
    const index = children.indexOf(node);
    if (index < 0) return;
    const beforeHtml = children.slice(0, index).map((el) => el.outerHTML).join("");
    const afterHtml = children.slice(index).map((el) => el.outerHTML).join("");
    const title = (node.textContent ?? "").trim().slice(0, 120) || `Capítulo ${bookSpine + 2}`;
    try {
      await invoke("book_split_chapter_at", { resourceId: bookId, spine: bookSpine, beforeHtml, afterHtml, newChapterTitle: title });
      setBookStructureTick((value) => value + 1);
      setBookSpine(bookSpine + 1);
      setContextMenu(null);
      setStatus("Capítulo dividido.");
    } catch (error) { setStatus(String(error)); }
  }

  function handleBookBlockHover(event: ReactMouseEvent<HTMLElement>) {
    if (!bookCurationMode) return;
    const target = (event.target as HTMLElement).closest("p,h1,h2,h3,h4,blockquote,div");
    if (!target || !target.closest(".book-typeset-surface")) return;
    const rect = target.getBoundingClientRect();
    setBookHoveredBlock({ node: target as HTMLElement, x: rect.right - 8, y: rect.top + 4 });
  }

  async function formatBookParagraph(mode: "quote" | "poetry" | "callout" | "normal") {
    const node = bookContextNodeRef.current;
    const content = bookReaderRef.current?.querySelector(".epub-content");
    if (!node || !content) return;
    let replacement: HTMLElement;
    if (mode === "quote") {
      replacement = document.createElement("blockquote");
      replacement.className = "editorial-blockquote";
    } else if (mode === "poetry") {
      replacement = document.createElement("blockquote");
      replacement.className = "editorial-poetry";
    } else if (mode === "callout") {
      replacement = document.createElement("div");
      replacement.className = "editorial-callout";
    } else {
      replacement = document.createElement("p");
    }
    replacement.innerHTML = node.innerHTML;
    node.replaceWith(replacement);
    setContextMenu(null);
    try {
      await invoke("update_book_chapter_html", {
        resourceId: bookId,
        spine: bookSpine,
        html: content.innerHTML,
      });
      setStatus("Formato del párrafo guardado.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  function renderRibbonTools() {
    return (
      <button type="button" className="tool-button ribbon-open-button" onClick={() => setBookmarksOpen((value) => !value)} title="Bitácora de lectura: separador, marcadores e historial">
        <RibbonIcon size={15} color="#d97706" /> Bitácora
      </button>
    );
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (view === "reader" || view === "book") {
        event.preventDefault();
        setBookmarksOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);

  useEffect(() => {
    if (!showSettings) return;
    try {
      const raw = localStorage.getItem("teoamoxtli.assistant.config.v2");
      if (!raw) return;
      const config = JSON.parse(raw);
      const provider = config.provider ?? "deepseek";
      setAssistantProvider(provider);
      setAssistantApiKey(config.apiKeyByProvider?.[provider] ?? "");
      setAssistantModel(config.modelByProvider?.[provider] ?? "");
    } catch {
      // configuración nueva
    }
  }, [showSettings]);

  function saveAssistantApi() {
    try {
      const raw = localStorage.getItem("teoamoxtli.assistant.config.v2");
      const config = raw ? JSON.parse(raw) : {
        provider: "deepseek", persona: "harvard-exegesis",
        baseUrlByProvider: {}, modelByProvider: {}, apiKeyByProvider: {},
        rememberKeys: true, maxContextItems: 10, temperature: 0.25, textScale: 1,
      };
      config.provider = assistantProvider;
      config.apiKeyByProvider = { ...(config.apiKeyByProvider ?? {}), [assistantProvider]: assistantApiKey };
      config.modelByProvider = { ...(config.modelByProvider ?? {}), [assistantProvider]: assistantModel };
      localStorage.setItem("teoamoxtli.assistant.config.v2", JSON.stringify(config));
      setStatus("Configuración del proveedor de IA guardada.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  const appShellClass = [
    "app-shell",
    `sidebar-pos-${sidebarSettings.position}`,
    sidebarSettings.collapsed ? "sidebar-collapsed" : "",
    sidebarSettings.autoHide ? "sidebar-autohide" : "",
    sidebarRevealed ? "sidebar-revealed" : "",
    focusMode ? "focus-mode" : "",
    `reader-width-${readerWidth}`,
    showHome ? "home-mode" : "",
    view === "book" && bookImmersive ? "reading-immersive" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={appShellClass}>
      {focusMode && (
        <button
          type="button"
          className="focus-exit-button"
          onClick={() => {
            setFocusMode(false);
            setStatus("Modo enfoque cerrado.");
          }}
          title="Salir del modo enfoque (Esc)"
        >
          Salir del enfoque ✕
        </button>
      )}
      {sidebarSettings.autoHide && !sidebarRevealed && (
        <button
          className={`sidebar-handle ${sidebarSettings.position}`}
          onClick={() => setSidebarRevealed(true)}
          onMouseEnter={() => setSidebarRevealed(true)}
          title="Mostrar barra lateral"
          aria-label="Mostrar barra lateral"
        >
          <span className="sidebar-handle-glyph">☰</span>
        </button>
      )}
      <aside
        className="sidebar"
        onMouseLeave={() => {
          if (sidebarSettings.autoHide) setSidebarRevealed(false);
        }}
      >
        <div className="brand">
          <img className="brand-mark" src={minellyMark} alt="Minelly Estudio Bíblico" />
          <div className="brand-copy">
            <strong>Minelly</strong>
            <span>Estudio Bíblico</span>
          </div>
          <span className="brand-compact" aria-hidden="true">
            {"Minelly".split("").map((letter, index) => (
              <span key={`${letter}-${index}`}>{letter}</span>
            ))}
          </span>
        </div>

        <div className="sidebar-actions">
          <div className="sidebar-settings">
            <button
              className="sidebar-action"
              onClick={() => setSidebarSettingsOpen((current) => !current)}
              aria-label="Mover y configurar la barra lateral"
              title="Mover y configurar barra"
              aria-expanded={sidebarSettingsOpen}
            >
              ⋮
            </button>
            {sidebarSettingsOpen && (
              <div className="sidebar-settings-menu">
                <div className="sidebar-settings-heading">
                  <strong>Barra lateral</strong>
                  <span>Posición y visibilidad</span>
                </div>
                <div className="sidebar-position-grid">
                  {([
                    ["left", "←", "Izquierda"],
                    ["right", "→", "Derecha"],
                    ["top", "↑", "Arriba"],
                    ["bottom", "↓", "Abajo"],
                  ] as const).map(([position, arrow, label]) => (
                    <button
                      key={position}
                      className={
                        sidebarSettings.position === position
                          ? "sidebar-position active"
                          : "sidebar-position"
                      }
                      onClick={() => {
                        setSidebarSettings((current) => ({ ...current, position }));
                        setSidebarSettingsOpen(false);
                      }}
                      title={label}
                    >
                      <span>{arrow}</span>
                      {label}
                    </button>
                  ))}
                </div>
                <label className="sidebar-toggle-row">
                  <span>
                    <strong>Auto-ocultar</strong>
                    <small>Se retrae como la barra de Windows.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={sidebarSettings.autoHide}
                    onChange={(event) => {
                      setSidebarSettings((current) => ({
                        ...current,
                        autoHide: event.target.checked,
                      }));
                      setSidebarRevealed(!event.target.checked);
                    }}
                  />
                </label>
                <button
                  className="sidebar-reset"
                  onClick={() => {
                    setSidebarSettings({ position: "left", collapsed: false, autoHide: false });
                    setSidebarRevealed(true);
                    setSidebarSettingsOpen(false);
                  }}
                >
                  Restablecer barra
                </button>
              </div>
            )}
          </div>
          <button
            className="sidebar-action"
            onClick={() =>
              setSidebarSettings((current) => ({
                ...current,
                collapsed: !current.collapsed,
              }))
            }
            aria-label={sidebarSettings.collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
            title={sidebarSettings.collapsed ? "Expandir barra" : "Contraer barra"}
          >
            {sidebarSettings.collapsed ? "»" : "«"}
          </button>
        </div>

        <nav
          className="primary-nav"
          aria-label="Navegación principal"
          onClickCapture={(event) => {
            const target = event.target as Element | null;
            if (!target?.closest(".nav-home")) setShowHome(false);
          }}
        >
          <button
            className={showHome ? "nav-item active nav-home" : "nav-item nav-home"}
            onClick={() => setShowHome(true)}
          >
            <Icon name="home" />
            <span>{tr("Inicio", "Home")}</span>
          </button>
          <button
            className={view === "library" ? "nav-item active" : "nav-item"}
            onClick={() => setView("library")}
          >
            <Icon name="library" />
            <span>{tr("Biblioteca", "Library")}</span>
          </button>
          <button
            className={showDocuments ? "nav-item active" : "nav-item"}
            onClick={() => {
              setShowHome(false);
              setShowDocuments(true);
            }}
          >
            <Icon name="note" />
            <span>{tr("Documentos", "Documents")}</span>
          </button>
          <button
            className={view === "reader" ? "nav-item active" : "nav-item"}
            onClick={() => setView("reader")}
          >
            <Icon name="bible" />
            <span>{tr("Biblia", "Bible")}</span>
          </button>
          <button
            className={showCompare ? "nav-item active" : "nav-item"}
            onClick={() => setShowCompare(true)}
          >
            <Icon name="compare" />
            <span>{tr("Comparador", "Compare")}</span>
          </button>
          <button
            className={view === "book" ? "nav-item active" : "nav-item"}
            onClick={() => setView("book")}
          >
            <Icon name="book" />
            <span>{tr("Libros", "Books")}</span>
          </button>
          <button
            className={showNotes ? "nav-item active" : "nav-item"}
            onClick={() => {
              setNoteFocusId(null);
              setShowNotes(true);
            }}
          >
            <Icon name="note" />
            <span>{tr("Notas", "Notes")}</span>
          </button>
          <button
            className={view === "search" ? "nav-item active" : "nav-item"}
            onClick={() => setView("search")}
          >
            <Icon name="search" />
            <span>{tr("Buscar", "Search")}</span>
          </button>
          <button
            className={showAssistant ? "nav-item active" : "nav-item"}
            onClick={() => setShowAssistant(true)}
          >
            <Icon name="assistant" />
            <span>{tr("Asistente", "Assistant")}</span>
          </button>
          <button
            className={showHermeneutics ? "nav-item active" : "nav-item"}
            onClick={() => {
              setShowHome(false);
              setShowHermeneutics(true);
            }}
          >
            <Icon name="bible" />
            <span>{tr("Hermenéutica", "Hermeneutics")}</span>
          </button>
          <button
            className={formationTab === "prayer" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setShowHome(false);
              setFormationTab("prayer");
            }}
          >
            <Icon name="prayer" />
            <span>{tr("Oración", "Prayer")}</span>
          </button>
          <button
            className={formationTab === "guides" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setShowHome(false);
              setFormationTab("guides");
            }}
          >
            <Icon name="course" />
            <span>{tr("Guías de estudio", "Study guides")}</span>
          </button>
          <button
            className={showModular ? "nav-item active" : "nav-item"}
            onClick={() => {
              setModularBook(null);
              setShowModular(true);
            }}
          >
            <Icon name="layers" />
            <span>{tr("Lienzo", "Canvas")}</span>
          </button>
          <button
            className={showPbb ? "nav-item active" : "nav-item"}
            onClick={() => setShowPbb(true)}
          >
            <Icon name="book" />
            <span>{tr("Libros PBB", "PBB books")}</span>
          </button>
          <button
            className={showSermons ? "nav-item active" : "nav-item"}
            onClick={() => setShowSermons(true)}
          >
            <Icon name="sermon" />
            <span>{tr("Sermones", "Sermons")}</span>
          </button>
          <button
            className={showWorkspaces ? "nav-item active" : "nav-item"}
            onClick={() => setShowWorkspaces(true)}
          >
            <Icon name="workspace" />
            <span>{tr("Entornos", "Environments")}</span>
          </button>
          <button
            className={showCustomization ? "nav-item active" : "nav-item"}
            onClick={() => setShowCustomization(true)}
          >
            <Icon name="eye" />
            <span>{tr("Personalizar", "Customize")}</span>
          </button>
          <button
            className={showImport ? "nav-item active" : "nav-item"}
            onClick={() => setShowImport((current) => !current)}
          >
            <Icon name="plus" />
            <span>{tr("Importar", "Import")}</span>
          </button>
        </nav>

        <button
          className="resources-toggle"
          onClick={() => setResourcesOpen((current) => !current)}
          aria-expanded={resourcesOpen}
          aria-controls="resource-drawer"
        >
          <span className="resources-toggle-label">
            <Icon name="layers" />
            Recursos
          </span>
          <span className="resources-toggle-meta">
            {resources.length}
            <span className={resourcesOpen ? "chevron open" : "chevron"}>
              <Icon name="chevron" />
            </span>
          </span>
        </button>

        {resourcesOpen && (
          <div className="resource-drawer" id="resource-drawer">
            <div className="resource-group">
              <div className="section-label">Biblias</div>
              {bibles.map((resource) => (
                <button
                  key={resource.id}
                  className={resource.id === bibleId ? "resource-pill active" : "resource-pill"}
                  onClick={() => {
                    setBibleId(resource.id);
                    setView("reader");
                  }}
                  title={resource.title}
                >
                  <span>{resource.abbreviation || resource.title}</span>
                  <small>{resource.verseCount.toLocaleString("es")}</small>
                </button>
              ))}
            </div>
            <div className="resource-group">
              <div className="section-label">Comentarios</div>
              {commentaryResources.map((resource) => (
                <button
                  key={resource.id}
                  className={
                    resource.id === commentaryId ? "resource-pill active" : "resource-pill"
                  }
                  onClick={() => {
                    setCommentaryId(resource.id);
                    setPanelTab("commentary");
                    setPanelOpen(true);
                    setView("reader");
                  }}
                  title={resource.title}
                >
                  <span>{resource.abbreviation || resource.title}</span>
                  <small>{resource.entryCount.toLocaleString("es")}</small>
                </button>
              ))}
            </div>
            <div className="resource-group">
              <div className="section-label">Libros</div>
              {libraryBooks.map((resource) => (
                <button
                  key={resource.id}
                  className={resource.id === bookId ? "resource-pill active" : "resource-pill"}
                  onClick={() => {
                    setBookId(resource.id);
                    setView("book");
                  }}
                  title={resource.title}
                >
                  <span>{resource.abbreviation || resource.title}</span>
                  <small>{resource.entryCount.toLocaleString("es")}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sidebar-footer">
          <span className={busy ? "status-dot busy" : "status-dot"} />
          <span>{busy ? "Trabajando…" : `${resources.length} recursos`}</span>
        </div>
      </aside>

      <main className={showHome ? "main-area home-mode" : "main-area"}>
        <header className="topbar">
          {view === "book" ? (
            <div className="book-topbar">
              <button
                className="icon-button"
                onClick={() => setView("library")}
                aria-label="Volver a la biblioteca"
              >
                ‹
              </button>
              <div>
                <span className="eyebrow">Libro</span>
                <strong>{currentLibraryBook?.title ?? "Libro"}</strong>
              </div>
              {currentLibraryBook && (
                <button
                  type="button"
                  className="icon-button book-delete-button"
                  onClick={() => requestDeleteResource(currentLibraryBook)}
                  disabled={currentLibraryBook.cloudSynced}
                  title={
                    currentLibraryBook.cloudSynced
                      ? "Libro sincronizado: no se puede eliminar"
                      : "Eliminar este libro de la biblioteca"
                  }
                  aria-label="Eliminar este libro"
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
          ) : (
            <div className="passage-controls">
              {readerMode !== "book" && (
                <button
                  className="icon-button"
                  onClick={() => setChapter((current) => Math.max(1, current - 1))}
                  title="Capítulo anterior"
                  aria-label="Capítulo anterior"
                >
                  ‹
                </button>
              )}
              <SelectMenu
                className="book-select-menu"
                value={String(book)}
                onChange={(value) => {
                  setBook(Number(value));
                  setChapter(1);
                  setActiveVerse(1);
                }}
                ariaLabel="Libro de la Biblia"
                options={books.map((item) => ({
                  value: String(item.number),
                  label: item.name,
                }))}
              />
              {readerMode === "book" ? (
                <span className="book-mode-chip">Todo el libro</span>
              ) : (
                <>
                  <input
                    type="number"
                    min={1}
                    value={chapter}
                    onChange={(event) =>
                      setChapter(Math.max(1, Number(event.target.value) || 1))
                    }
                    aria-label="Capítulo"
                  />
                  <SelectMenu
                    className="verse-select-menu"
                    value={String(activeVerse)}
                    onChange={(value) => selectVerse(chapter, Number(value))}
                    ariaLabel="Versículo"
                    disabled={chapterVerses.length === 0}
                    options={chapterVerses.map((verse) => ({
                      value: String(verse.verse),
                      label: String(verse.verse),
                    }))}
                  />
                  <button
                    className="icon-button"
                    onClick={() => setChapter((current) => current + 1)}
                    title="Capítulo siguiente"
                    aria-label="Capítulo siguiente"
                  >
                    ›
                  </button>
                </>
              )}
              <SelectMenu
                className="version-select-menu"
                value={bibleId}
                onChange={setBibleId}
                ariaLabel="Versión de la Biblia"
                options={bibles.map((resource) => ({
                  value: resource.id,
                  label: resource.abbreviation || resource.title,
                }))}
              />
            </div>
          )}

          <form className="search-form" onSubmit={runSearch}>
            <Icon name="search" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={tr("Buscar en la biblioteca…", "Search the library…")}
              aria-label="Buscar en la biblioteca"
            />
            <button type="submit">{tr("Buscar", "Search")}</button>
          </form>

          <div className="topbar-actions">
            <button
              className="theme-button customize-top-button"
              onClick={() => setShowCustomization(true)}
              aria-label="Personalizar interfaz y tamaños de letra"
              title="Personalizar interfaz y tamaños de letra de los menús"
            >
              <span>Aa</span>
              <span>{tr("Personalizar", "Customize")}</span>
            </button>
            <button
              className="theme-button"
              onClick={() => setShowSettings(true)}
              aria-label={tr("Configuración de la aplicación", "Application settings")}
              title={tr("Configuración", "Settings")}
            >
              <span aria-hidden="true">⚙</span>
              <span>{tr("Configuración", "Settings")}</span>
            </button>
            <div className="theme-picker">
              <button
                className="theme-button"
                onClick={() => setThemeMenuOpen((current) => !current)}
                aria-expanded={themeMenuOpen}
                aria-haspopup="menu"
                aria-label="Tema de la interfaz"
                title="Tema de la interfaz"
              >
                <span className={`theme-dot ${theme}`} />
                {THEME_OPTIONS.find((option) => option.id === theme)?.label}
                <span className="theme-chevron">⌄</span>
              </button>
              {themeMenuOpen && (
                <div className="theme-menu" role="menu">
                  {(["light", "dark"] as const).map((group) => (
                    <div className="theme-group" key={group}>
                      <span className="theme-group-label">
                        {group === "light" ? "Temas Claros Editoriales" : "Temas Oscuros de Estudio"}
                      </span>
                      {THEME_META.filter((option) => option.group === group).map((option) => (
                        <button
                          key={option.id}
                          className={theme === option.id ? "active" : ""}
                          onClick={() => {
                            setTheme(option.id);
                            setThemeMenuOpen(false);
                          }}
                          role="menuitem"
                        >
                          <span className="theme-swatches">
                            <i style={{ background: option.shell }} />
                            <i style={{ background: option.card }} />
                            <i style={{ background: option.accent }} />
                          </span>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              className="icon-button"
              onClick={() => setPanelOpen((current) => !current)}
              aria-label={panelOpen ? "Ocultar panel de estudio" : "Mostrar panel de estudio"}
              title={panelOpen ? "Ocultar panel" : "Mostrar panel"}
            >
              <Icon name="panel" />
            </button>
            <button
              className="icon-button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
              title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
            >
              <Icon name={isFullscreen ? "collapse" : "expand"} />
            </button>
          </div>
        </header>

        {status && (
          <div className="status-banner">
            <span>{status}</span>
            <button onClick={() => setStatus("")} aria-label="Cerrar aviso">
              ×
            </button>
          </div>
        )}

        {showImport && (
          <div className="import-modal-backdrop">
            <div className="import-modal">
              <header className="import-modal-head">
                <div>
                  <span className="eyebrow">{tr("Biblioteca", "Library")}</span>
                  <h2>{tr("Importar libros y módulos", "Import books and modules")}</h2>
                </div>
                <button type="button" className="word-study-close" onClick={() => setShowImport(false)} aria-label={tr("Cerrar", "Close")}>×</button>
              </header>
              <section className="import-card">
            <div>
              <h2>{tr("Biblioteca y libros comerciales", "Library and commercial books")}</h2>
              <p>
                {tr("Importa libros o módulos en formatos AZW3, EPUB, MOBI, DOCX, e-Sword o MySword. Las jerarquías de títulos se convierten en capítulos e índice interactivo.", "Import books or modules in AZW3, EPUB, MOBI, DOCX, e-Sword or MySword. Heading hierarchies become chapters and an interactive index.")}
              </p>
            </div>
            <div className="import-row">
              <div className={`import-selection${importPath ? " has-file" : ""}`}>
                {importPath ? fileLabel(importPath) : tr("Ningún archivo o carpeta seleccionada", "No file or folder selected")}
              </div>
              <button className="secondary-button" onClick={chooseImportFile} disabled={busy}>
                {tr("Elegir libro", "Choose book")}
              </button>
              <button className="secondary-button" onClick={chooseFolder} disabled={busy}>
                {tr("Elegir carpeta", "Choose folder")}
              </button>
              <button className="primary-button" onClick={importLibrary} disabled={busy}>
                {tr("Importar", "Import")}
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  setShowImport(false);
                  setShowPbb(true);
                }}
              >
                {tr("Constructor PBB", "PBB Builder")}
              </button>
            </div>
              </section>
              <section className="import-card interlinear-import-card">
            <div>
              <span className="eyebrow">{tr("Interlineal AT + NT", "OT + NT Interlinear")}</span>
              <h2>{tr("Importar datos interlineales", "Import interlinear data")}</h2>
              <p>
                {tr("Añade texto original hebreo/arameo y griego, transliteración, lema, Strong, morfología, glosas y lexicones.", "Add Hebrew/Aramaic and Greek source text, transliteration, lemma, Strong, morphology, glosses and lexicons.")}
              </p>
              <small>
                {interlinearStatus.tokens > 0
                  ? `${interlinearStatus.tokens.toLocaleString("es")} tokens · ${interlinearStatus.books} libros · ${interlinearStatus.verses.toLocaleString("es")} versículos`
                  : tr("Todavía no hay tokens interlineales importados.", "No interlinear tokens imported yet.")}
              </small>
            </div>
            <div className="import-row">
              <div className={`import-selection${interlinearPath ? " has-file" : ""}`}>
                {interlinearPath ? fileLabel(interlinearPath) : tr("Ningún ZIP interlineal seleccionado", "No interlinear ZIP selected")}
              </div>
              <button
                className="secondary-button"
                onClick={() => void chooseInterlinearFile()}
                disabled={interlinearBusy}
              >
                {tr("Elegir ZIP", "Choose ZIP")}
              </button>
              <button
                className="primary-button"
                onClick={() => void importInterlinear()}
                disabled={interlinearBusy}
              >
                {interlinearBusy ? tr("Importando…", "Importing…") : tr("Importar interlineal", "Import interlinear")}
              </button>
            </div>
              </section>
            </div>
          </div>
        )}

        {showHome && (
          <Dashboard
            currentBible={currentBible?.abbreviation || currentBible?.title || "Biblia"}
            currentBook={currentBook?.name ?? "Juan"}
            currentBookNumber={book}
            currentChapter={chapter}
            currentVerse={activeVerse}
            readingPercent={readingProgressMap["bible:canonical"]?.overallPercent ?? 0}
            bibleCount={bibles.length}
            commentaryCount={commentaryResources.length}
            bookCount={libraryBooks.length}
            dictionaryCount={dictionaries.length}
            onOpenBible={(nextBook, nextChapter, nextVerse = 1) => {
              openReference(nextBook, nextChapter, nextVerse);
              setShowHome(false);
            }}
            onOpenLibrary={() => {
              setShowHome(false);
              setView("library");
            }}
            onOpenSearch={() => {
              setShowHome(false);
              setView("search");
            }}
            onOpenAssistant={(question) => {
              setShowHome(false);
              setAssistantSeed(question);
              setShowAssistant(true);
            }}
            onOpenWordStudy={(query) => {
              setShowHome(false);
              openWordStudy("", query);
            }}
            onOpenNotes={() => {
              setShowHome(false);
              setShowNotes(true);
            }}
            onOpenSermons={() => {
              setShowHome(false);
              setShowSermons(true);
            }}
            onOpenModular={() => {
              setShowHome(false);
              setShowModular(true);
            }}
            onOpenHermeneutics={() => {
              setShowHome(false);
              setShowHermeneutics(true);
            }}
            onOpenDocuments={() => {
              setShowHome(false);
              setShowDocuments(true);
            }}
            onOpenPrayer={() => {
              setShowHome(false);
              setFormationTab("prayer");
            }}
            onOpenGuides={() => {
              setShowHome(false);
              setFormationTab("guides");
            }}
          />
        )}

        {view === "library" && (
          <section className="library-view">
            <div className="view-heading library-heading">
              <div>
                <span className="eyebrow">Catálogo local</span>
                <h1>Biblioteca</h1>
                <p>
                  {resources.length} recursos · {bibles.length} Biblias ·{" "}
                  {commentaryResources.length} comentarios · {libraryBooks.length} libros
                </p>
              </div>
              <button className="primary-button" onClick={() => setShowImport(true)}>
                Añadir recursos
              </button>
            </div>

            <div className="library-stats">
              <div>
                <strong>{resources.length}</strong>
                <span>recursos</span>
              </div>
              <div>
                <strong>
                  {resources.reduce((total, resource) => total + resource.verseCount, 0).toLocaleString("es")}
                </strong>
                <span>versículos</span>
              </div>
              <div>
                <strong>
                  {commentaryResources.reduce((total, resource) => total + resource.entryCount, 0).toLocaleString("es")}
                </strong>
                <span>entradas de comentario</span>
              </div>
              <div>
                <strong>{libraryBooks.length}</strong>
                <span>libros EPUB</span>
              </div>
            </div>

            <div className="library-tools">
              <label className="library-search">
                <Icon name="search" />
                <input
                  value={libraryQuery}
                  onChange={(event) => setLibraryQuery(event.target.value)}
                  placeholder="Filtrar por título, idioma o formato…"
                />
              </label>
              <label className="preferred-bible-picker">
                <Icon name="bible" />
                <span>Biblia preferida</span>
                <select
                  value={uiCustomization.preferredBibleId}
                  onChange={(event) => {
                    const value = event.target.value;
                    uiCustomization.update({ preferredBibleId: value });
                    if (value) setBibleId(value);
                  }}
                >
                  <option value="">Usar la Biblia actual</option>
                  {bibles.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="filter-chips" role="group" aria-label="Filtrar por tipo">
                <button
                  className={libraryFilter === "all" ? "chip active" : "chip"}
                  onClick={() => setLibraryFilter("all")}
                >
                  Todos <span>{libraryCounts.all ?? 0}</span>
                </button>
                {KIND_ORDER.map((kind) => (
                  <button
                    key={kind}
                    className={libraryFilter === kind ? "chip active" : "chip"}
                    onClick={() => setLibraryFilter(kind)}
                  >
                    {KIND_LABEL[kind]} <span>{libraryCounts[kind] ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>

            {filteredResources.length === 0 ? (
              <div className="empty-state">
                <h2>Sin coincidencias</h2>
                <p>Prueba otro filtro o importa nuevos módulos.</p>
              </div>
            ) : (
              <div className="resource-grid">
                {filteredResources.map((resource) => (
                  <article
                    className={`resource-card${resource.searchPriority ? " is-priority" : ""}`}
                    key={resource.id}
                  >
                    <button
                      type="button"
                      className="resource-card-main"
                      onClick={() => openResource(resource)}
                    >
                      <div className={`card-spine ${resource.kind}`} />
                      <div className="card-body">
                        <span className="card-kind">{KIND_LABEL[resource.kind]}</span>
                        <strong>{resource.title}</strong>
                        <span className="card-abbrev">
                          {resource.abbreviation || resource.sourceFormat}
                        </span>
                        <div className="card-meta">
                          <span>{resource.language || "—"}</span>
                          <span>
                            {resource.kind === "bible"
                              ? `${resource.verseCount.toLocaleString("es")} versículos`
                              : `${resource.entryCount.toLocaleString("es")} entradas`}
                          </span>
                        </div>
                      </div>
                      <span className="card-open">Abrir</span>
                    </button>
                    {readingProgressMap[resource.id] && (
                      <div className="card-reading-progress">
                        <div><span style={{ width: `${readingProgressMap[resource.id].overallPercent}%` }} /></div>
                        <button type="button" onClick={() => openResource(resource)}>
                          Continuar lectura · {Math.round(readingProgressMap[resource.id].overallPercent)}%
                        </button>
                      </div>
                    )}
                    <div className="resource-card-actions">
                      <button
                        type="button"
                        className="card-citation"
                        title="Información bibliográfica"
                        aria-label="Editar información bibliográfica"
                        onClick={() => setCitationInfoTarget(resource)}
                      >
                        <Icon name="book" />
                      </button>
                      <button
                        type="button"
                        className={`card-priority${resource.searchPriority ? " active" : ""}`}
                        title={
                          resource.searchPriority
                            ? "Quitar prioridad en búsquedas"
                            : "Priorizar en búsquedas"
                        }
                        aria-label={
                          resource.searchPriority
                            ? "Quitar prioridad"
                            : "Marcar como prioritario"
                        }
                        onClick={() => void toggleResourcePriority(resource)}
                      >
                        <Icon name="star" />
                      </button>
                      {resource.kind === "book" && (
                        <button
                          type="button"
                          className="card-delete"
                          title={
                            resource.cloudSynced
                              ? "Libro sincronizado: no se puede eliminar"
                              : "Eliminar libro"
                          }
                          aria-label={
                            resource.cloudSynced
                              ? "Libro sincronizado, eliminación deshabilitada"
                              : "Eliminar libro"
                          }
                          disabled={resource.cloudSynced}
                          onClick={() => requestDeleteResource(resource)}
                        >
                          <Icon name="trash" />
                        </button>
                      )}
                    </div>
                    {resource.searchPriority && (
                      <span className="card-priority-badge">Prioritario</span>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {view === "search" && (
          <section className="search-view">
            <div className="view-heading search-heading">
              <div>
                <span className="eyebrow">
                  {searchMode === "advanced"
                    ? "Búsqueda avanzada: DSL, rangos canónicos y Strong"
                    : searchMode === "unified"
                      ? "Búsqueda unificada: módulos, libros y notas"
                      : searchMode === "global"
                        ? "Búsqueda global FTS5"
                        : "Búsqueda clásica por coincidencia"}
                </span>
                <h1>Resultados</h1>
                <p>
                  {searchMode === "advanced"
                    ? `${unifiedHits.length} resultados avanzados para “${searchQuery}”.`
                    : searchMode === "unified"
                      ? `${unifiedHits.length} resultados para “${searchQuery}” en ${unifiedGroups.length} tipos de fuente.`
                      : searchMode === "global"
                      ? `${globalHits.length} fragmentos para “${searchQuery}” en ${globalGroups.length} módulos.`
                      : `${searchHits.length} coincidencias para “${searchQuery}”.`}
                </p>
              </div>
              <div className="search-mode-toggle" role="group" aria-label="Modo de búsqueda">
                <button
                  type="button"
                  className={searchMode === "unified" ? "active" : ""}
                  onClick={() => {
                    setSearchMode("unified");
                    if (searchQuery.trim()) {
                      void performSearch(searchQuery, "unified");
                    }
                  }}
                >
                  Todo
                </button>
                <button
                  type="button"
                  className={searchMode === "global" ? "active" : ""}
                  onClick={() => {
                    setSearchMode("global");
                    if (searchQuery.trim()) {
                      void performSearch(searchQuery, "global");
                    }
                  }}
                >
                  Global FTS5
                </button>
                <button
                  type="button"
                  className={searchMode === "advanced" ? "active" : ""}
                  onClick={() => {
                    setSearchMode("advanced");
                    if (searchQuery.trim()) {
                      void performSearch(searchQuery, "advanced");
                    }
                  }}
                >
                  Avanzada
                </button>
                <button
                  type="button"
                  className={searchMode === "classic" ? "active" : ""}
                  onClick={() => {
                    setSearchMode("classic");
                    if (searchQuery.trim()) {
                      void performSearch(searchQuery, "classic");
                    }
                  }}
                >
                  Clásica
                </button>
              </div>
            </div>

            {searchMode === "advanced" && (
              <div className="advanced-search-helper">
                <div className="advanced-search-pills">
                  <button type="button" onClick={() => setSearchQuery((current) => `${current} @tipo:biblia`.trim())}>@tipo:biblia</button>
                  <button type="button" onClick={() => setSearchQuery((current) => `${current} @tipo:comentario`.trim())}>@tipo:comentario</button>
                  <button type="button" onClick={() => setSearchQuery((current) => `${current} @pasaje:Juan 3:16`.trim())}>@pasaje:Juan 3:16</button>
                  <button type="button" onClick={() => setSearchQuery((current) => `${current} @strong:G26`.trim())}>@strong:G26</button>
                  <button type="button" onClick={() => setSearchQuery((current) => `${current} @lema:amor`.trim())}>@lema:amor</button>
                </div>
                <label className="advanced-expand">
                  <input type="checkbox" checked={expandByStrong} onChange={(event) => setExpandByStrong(event.target.checked)} />
                  Expandir por Strong
                </label>
              </div>
            )}

            <div className="global-index-bar">
              <div className="global-index-summary">
                <strong>Índice global</strong>
                <span>
                  {indexStatus
                    ? `${indexStatus.indexedResources}/${indexStatus.totalResources} recursos · ${indexStatus.totalRows.toLocaleString("es")} fragmentos`
                    : "Consultando estado…"}
                </span>
                {indexing && (
                  <small>
                    {indexProgress.total > 0
                      ? `Indexando ${indexProgress.done}/${indexProgress.total}: ${indexProgress.title}`
                      : "Reindexando toda la biblioteca…"}
                  </small>
                )}
              </div>
              <div className="global-index-actions">
                {indexStatus && indexStatus.pendingResources > 0 ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void indexNow()}
                    disabled={indexing}
                  >
                    {indexing
                      ? "Indexando…"
                      : `Indexar ${indexStatus.pendingResources} pendientes`}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void reindexAll()}
                    disabled={indexing || !indexStatus}
                  >
                    {indexing ? "Indexando…" : "Reindexar biblioteca"}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void refreshIndexStatus()}
                  disabled={indexing}
                >
                  Actualizar
                </button>
              </div>
            </div>

            {indexError && (
              <div className="index-error">
                <span>{indexError}</span>
                <button type="button" onClick={() => setIndexError("")}>×</button>
              </div>
            )}

            {searchMode === "unified" || searchMode === "advanced" ? (
              <div className="global-results unified-results">
                {unifiedGroups.map((group) => (
                  <section className="global-group" key={group.sourceType}>
                    <header>
                      <span className={`hit-kind ${group.sourceType}`}>
                        {UNIFIED_LABELS[group.sourceType] ?? group.sourceType}
                      </span>
                      <strong>
                        {group.hits.length} resultado
                        {group.hits.length === 1 ? "" : "s"}
                      </strong>
                      <small>
                        {group.sourceType === "user_note"
                          ? "Notas de usuario"
                          : "Biblioteca indexada"}
                      </small>
                    </header>
                    <div className="global-group-hits">
                      {group.hits.map((hit, index) => (
                        <button
                          type="button"
                          className="global-hit unified-hit"
                          key={`${hit.sourceType}-${hit.resourceId}-${hit.reference}-${index}`}
                          onClick={() => openUnifiedHit(hit)}
                          title={
                            hit.sourceType === "pbb_book"
                              ? "Abrir en el Lienzo Modular"
                              : hit.sourceType === "user_note"
                                ? "Abrir la nota en Notas"
                                : "Abrir en el módulo correspondiente"
                          }
                        >
                          <span className="global-hit-ref">
                            {unifiedReferenceLabel(
                              hit,
                              (bookNumber) =>
                                books.find((item) => item.number === bookNumber)?.name ??
                                `Libro ${bookNumber}`,
                            )}
                            {hit.sourceType !== "user_note" && (
                              <small className="unified-hit-title">{hit.title}</small>
                            )}
                          </span>
                          <span
                            className="global-hit-snippet"
                            dangerouslySetInnerHTML={{
                              __html: snippetHtml(hit.snippet),
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {unifiedHits.length === 0 && (
                  <div className="empty-state">
                    <h2>Sin resultados unificados</h2>
                    <p>
                      Prueba con otra palabra. La búsqueda unificada cubre Biblias,
                      comentarios, diccionarios, Libros Personales y notas.
                    </p>
                    {indexStatus && indexStatus.pendingResources > 0 && (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void indexNow()}
                        disabled={indexing}
                      >
                        Indexar ahora
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : searchMode === "global" ? (
              <div className="global-results">
                {globalGroups.map((group) => (
                  <section className="global-group" key={group.resourceId}>
                    <header>
                      <span className={`hit-kind ${group.moduleType}`}>
                        {MODULE_LABELS[group.moduleType] ?? group.moduleType}
                      </span>
                      <strong>{group.title}</strong>
                      <small>{group.hits.length} fragmentos</small>
                    </header>
                    <div className="global-group-hits">
                      {group.hits.map((hit, index) => (
                        <button
                          type="button"
                          className="global-hit"
                          key={`${hit.referenceKey}-${index}`}
                          onClick={() => openGlobalHit(hit)}
                          title="Abrir en el módulo correspondiente"
                        >
                          <span className="global-hit-ref">
                            {globalReferenceLabel(
                              hit,
                              (bookNumber) =>
                                books.find((item) => item.number === bookNumber)?.name ??
                                `Libro ${bookNumber}`,
                            )}
                          </span>
                          <span
                            className="global-hit-snippet"
                            dangerouslySetInnerHTML={{
                              __html: snippetHtml(hit.fragment),
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {globalHits.length === 0 && (
                  <div className="empty-state">
                    <h2>
                      {indexStatus && indexStatus.totalRows > 0
                        ? "Sin resultados en el índice"
                        : "El índice global aún no está listo"}
                    </h2>
                    <p>
                      {indexStatus && indexStatus.totalRows > 0
                        ? "Prueba con otra palabra o revisa que el recurso esté indexado."
                        : "Indexa tu biblioteca para buscar por palabras exactas y fragmentos en todos los módulos a la vez."}
                    </p>
                    {indexStatus && indexStatus.pendingResources > 0 && (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void indexNow()}
                        disabled={indexing}
                      >
                        Indexar ahora
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="search-results">
                {searchHits.map((hit, index) => (
                  <button
                    key={`${hit.resourceId}-${hit.kind}-${index}`}
                    className="search-hit"
                    onClick={() => openSearchHit(hit)}
                  >
                    <div className="hit-heading">
                      <span className={`hit-kind ${hit.kind}`}>{hit.kind}</span>
                      <strong>{hit.label}</strong>
                      <span>{hit.resourceTitle}</span>
                    </div>
                    <Html html={hit.html} className="hit-snippet" />
                  </button>
                ))}
                {searchHits.length === 0 && (
                  <div className="empty-state">
                    <h2>Sin resultados</h2>
                    <p>Prueba con otra palabra o revisa que la biblioteca esté importada.</p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {view === "reader" && resources.length === 0 && (
          <section className="empty-state" style={{ margin: 40 }}>
            <h2>Tu biblioteca está vacía</h2>
            <p>
              Importa tus módulos de e-Sword o MySword para empezar a leer. La app
              leerá los archivos en su ubicación original.
            </p>
            <button className="primary-button" onClick={() => setShowImport(true)}>
              Importar módulos
            </button>
          </section>
        )}

        {view === "reader" && resources.length > 0 && (
          <div
            className="reader-layout"
            style={{
              gridTemplateColumns: panelVisible
                ? `minmax(0, 1fr) ${panelWidth}px`
                : "minmax(0, 1fr)",
            }}
          >
            <section
              className={`reader ${bibleFormatClass}`}
              ref={readerRef}
              onMouseUp={handleReaderSelection}
              onContextMenu={handleReaderContextMenu}
              style={
                {
                  "--reader-font-size": `${18.5 * fontScale}px`,
                  "--reader-font": `"${readerFont}", Georgia, serif`,
                } as CSSProperties
              }
            >
              <div className="reader-panel-tabs" role="tablist" aria-label="Herramientas del panel bíblico">
                <button type="button" className="active" role="tab" aria-selected="true">
                  {tr("Inicio", "Home")}
                </button>
                <button
                  type="button"
                  role="tab"
                  onClick={() => {
                    setShowHome(false);
                    setView("search");
                  }}
                >
                  {tr("Búsqueda", "Search")}
                </button>
                <button type="button" role="tab" onClick={() => setShowNotes(true)}>
                  {tr("Notas", "Notes")}
                </button>
                <button
                  type="button"
                  role="tab"
                  onClick={() => setFormatMenuOpen((current) => !current)}
                >
                  {tr("Formato", "Format")}
                </button>
                <button type="button" role="tab" onClick={() => setShowCustomization(true)}>
                  {tr("Vista", "View")}
                </button>
                <button type="button" role="tab" onClick={() => setShowHermeneutics(true)}>
                  {tr("Hermenéutica", "Hermeneutics")}
                </button>
                <span className="reader-panel-tab-spacer" />
                <button
                  type="button"
                  className="reader-panel-tab-more"
                  onClick={() => setPanelOpen((current) => !current)}
                  title={panelOpen ? "Ocultar panel de estudio" : "Mostrar panel de estudio"}
                >
                  {panelOpen ? "Ocultar estudio" : "Abrir estudio"}
                </button>
              </div>
              <div className="reader-toolbar">
                <SelectMenu
                  className="font-select-menu"
                  value={readerFont}
                  onChange={setReaderFont}
                  ariaLabel="Fuente de lectura"
                  options={FONT_OPTIONS}
                />
                <div className="segmented" role="group" aria-label="Modo de lectura">
                  <button
                    className={readerMode === "verse" ? "active" : ""}
                    onClick={() => setReaderMode("verse")}
                  >
                    {tr("Versículo", "Verse")}
                  </button>
                  <button
                    className={readerMode === "page" ? "active" : ""}
                    onClick={() => setReaderMode("page")}
                  >
                    {tr("Página", "Page")}
                  </button>
                  <button
                    className={readerMode === "book" ? "active" : ""}
                    onClick={() => {
                      setReaderMode("book");
                      setChapter(1);
                      setActiveVerse(1);
                    }}
                  >
                    {tr("Libro completo", "Whole book")}
                  </button>
                  <button
                    className={readerMode === "interlinear" ? "active" : ""}
                    onClick={() => setReaderMode("interlinear")}
                  >
                    {tr("Interlineal", "Interlinear")}
                  </button>
                </div>
                <div className="toolbar-actions">
                  {readerMode === "interlinear" && (
                    <div className="interlinear-picker">
                      <button
                        className={interlinearMenuOpen ? "tool-button active" : "tool-button"}
                        onClick={() => setInterlinearMenuOpen((current) => !current)}
                        aria-expanded={interlinearMenuOpen}
                        aria-haspopup="menu"
                        title="Capas del interlineal"
                      >
                        Capas
                      </button>
                      {interlinearMenuOpen && (
                        <div className="interlinear-menu" role="menu">
                          <div className="format-popover-heading">
                            <strong>Opciones del interlineal</strong>
                            <span>Activa o desactiva cada capa.</span>
                          </div>
                          {([
                            ["showSurfaceText", "Texto superficial"],
                            ["showSpanishGloss", "Glosa española (léxica)"],
                            ["showManuscript", "Manuscrito original"],
                            ["showTransliteration", "Transliteración"],
                            ["showLemma", "Lema"],
                            ["showMorphology", "Morfología"],
                            ["showStrongNumbers", "Número de Strong"],
                          ] as const).map(([key, label]) => (
                            <label className="format-option" key={key}>
                              <input
                                type="checkbox"
                                checked={interlinearOptions[key]}
                                onChange={(event) =>
                                  interlinearOptions.setOption(key, event.target.checked)
                                }
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                          <button
                            className="format-reset"
                            onClick={() => interlinearOptions.reset()}
                          >
                            Restablecer capas
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="reader-width-picker">
                    <button
                      type="button"
                      className={readerWidthMenuOpen ? "tool-button active" : "tool-button"}
                      onClick={() => setReaderWidthMenuOpen((current) => !current)}
                      aria-expanded={readerWidthMenuOpen}
                      aria-haspopup="menu"
                      title="Ancho de lectura"
                    >
                      {tr("Ancho", "Width")} · {readerWidth === "compact" ? tr("Compacto", "Compact") : readerWidth === "wide" ? tr("Ancho", "Wide") : readerWidth === "full" ? tr("Completo", "Full") : tr("Normal", "Normal")}
                    </button>
                    {readerWidthMenuOpen && (
                      <div className="reader-width-menu" role="menu">
                        <strong>{tr("Ancho del texto", "Text width")}</strong>
                        {([
                          ["compact", tr("Compacto", "Compact"), "≈ 680 px"],
                          ["normal", tr("Normal", "Normal"), "≈ 820 px"],
                          ["wide", tr("Ancho", "Wide"), "≈ 1180 px"],
                          ["full", tr("Completo", "Full"), tr("Todo el panel", "Whole panel")],
                        ] as const).map(([value, label, hint]) => (
                          <button
                            type="button"
                            key={value}
                            className={readerWidth === value ? "active" : ""}
                            onClick={() => {
                              setReaderWidth(value);
                              setReaderWidthMenuOpen(false);
                            }}
                          >
                            <span>{label}</span>
                            <small>{hint}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="tool-button"
                    onClick={() => setCitationInfoTarget(currentBible ?? null)}
                    title={tr("Información bibliográfica", "Bibliographic information")}
                    aria-label={tr("Información bibliográfica", "Bibliographic information")}
                  >
                    <Icon name="book" />
                  </button>
                  <PaperModePicker />
                  <div className="format-picker">
                    <button
                      className={formatMenuOpen ? "tool-button active" : "tool-button"}
                      onClick={() => setFormatMenuOpen((current) => !current)}
                      aria-expanded={formatMenuOpen}
                      aria-haspopup="menu"
                      title="Formato del texto bíblico"
                    >
                      Formato
                    </button>
                    {formatMenuOpen && (
                      <div className="format-popover" role="menu">
                        <div className="format-popover-heading">
                          <strong>Cambiar el formato del texto</strong>
                          <span>Sin volver a consultar la base de datos.</span>
                        </div>
                        <label className="format-master">
                          <span>
                            <strong>Formato personalizado</strong>
                            <small>Activa o desactiva estos ajustes.</small>
                          </span>
                          <input
                            type="checkbox"
                            checked={bibleFormat.enableCustomFormatting}
                            onChange={(event) =>
                              bibleFormat.setOption(
                                "enableCustomFormatting",
                                event.target.checked,
                              )
                            }
                          />
                        </label>
                        <div className="format-section-title">
                          <span>⌄</span> Texto bíblico
                        </div>
                        <div
                          className={
                            bibleFormat.enableCustomFormatting
                              ? "format-options"
                              : "format-options disabled"
                          }
                        >
                          <label className="format-option">
                            <input
                              type="checkbox"
                              checked={bibleFormat.showBibleFormatting}
                              disabled={!bibleFormat.enableCustomFormatting}
                              onChange={(event) =>
                                bibleFormat.setOption(
                                  "showBibleFormatting",
                                  event.target.checked,
                                )
                              }
                            />
                            <span>Formato de texto de la Biblia</span>
                          </label>
                          <label className="format-option">
                            <input
                              type="checkbox"
                              checked={bibleFormat.showChapterVerseNumbers}
                              disabled={!bibleFormat.enableCustomFormatting}
                              onChange={(event) =>
                                bibleFormat.setOption(
                                  "showChapterVerseNumbers",
                                  event.target.checked,
                                )
                              }
                            />
                            <span>Números de capítulo/versículo</span>
                          </label>
                          <label className="format-option">
                            <input
                              type="checkbox"
                              checked={bibleFormat.showFootnoteIndicators}
                              disabled={!bibleFormat.enableCustomFormatting}
                              onChange={(event) =>
                                bibleFormat.setOption(
                                  "showFootnoteIndicators",
                                  event.target.checked,
                                )
                              }
                            />
                            <span>Indicadores de pie de página</span>
                          </label>
                          <label className="format-option">
                            <input
                              type="checkbox"
                              checked={bibleFormat.showNonBiblicalText}
                              disabled={!bibleFormat.enableCustomFormatting}
                              onChange={(event) =>
                                bibleFormat.setOption(
                                  "showNonBiblicalText",
                                  event.target.checked,
                                )
                              }
                            />
                            <span>Texto no bíblico y títulos</span>
                          </label>
                          <label className="format-option">
                            <input
                              type="checkbox"
                              checked={bibleFormat.oneVersePerLine}
                              disabled={!bibleFormat.enableCustomFormatting}
                              onChange={(event) =>
                                bibleFormat.setOption(
                                  "oneVersePerLine",
                                  event.target.checked,
                                )
                              }
                            />
                            <span>Un versículo por línea</span>
                          </label>
                        </div>
                        <button
                          className="format-reset"
                          onClick={() => bibleFormat.reset()}
                        >
                          Restablecer formato
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    className={showNumbers ? "tool-button active" : "tool-button"}
                    onClick={() => {
                      bibleFormat.setOption("enableCustomFormatting", true);
                      bibleFormat.setOption("showChapterVerseNumbers", !showNumbers);
                    }}
                    aria-pressed={showNumbers}
                    title="Mostrar u ocultar números y capítulos"
                  >
                    123
                  </button>
                  <button
                    className="tool-button"
                    onClick={() => setFontScale((current) => Math.max(0.8, current - 0.06))}
                    aria-label="Disminuir fuente"
                    title="Disminuir fuente"
                  >
                    A−
                  </button>
                  <button
                    className="tool-button"
                    onClick={() => setFontScale((current) => Math.min(1.8, current + 0.06))}
                    aria-label="Aumentar fuente"
                    title="Aumentar fuente"
                  >
                    A+
                  </button>
                  <button
                    className={showAnnotations ? "tool-button active" : "tool-button"}
                    onClick={() => {
                      setShowAnnotations((current) => !current);
                      setSelectionMenu(null);
                    }}
                    aria-pressed={showAnnotations}
                    aria-label="Mostrar u ocultar resaltados y notas"
                    title="Mostrar/ocultar resaltados y notas ancladas"
                  >
                    <Icon name={showAnnotations ? "eye" : "eyeOff"} />
                  </button>
                  <button
                    className={focusMode ? "tool-button active" : "tool-button"}
                    onClick={() => setFocusMode((current) => !current)}
                    aria-pressed={focusMode}
                    title="Modo enfoque: solo lectura"
                  >
                    <Icon name="focus" />
                  </button>
                  <button
                    className="tool-button"
                    onClick={toggleFullscreen}
                    title="Pantalla completa"
                    aria-label="Pantalla completa"
                  >
                    <Icon name={isFullscreen ? "collapse" : "expand"} />
                  </button>
                  {renderRibbonTools()}
                  <button
                    className="tool-button"
                    onClick={() => window.print()}
                    title={tr("Imprimir capítulo bíblico", "Print Bible chapter")}
                    aria-label={tr("Imprimir", "Print")}
                  >
                    🖨
                  </button>
                  <button
                    className={showTts ? "tool-button active" : "tool-button"}
                    onClick={() => setShowTts((current) => !current)}
                    aria-pressed={showTts}
                    title="Lectura en voz alta con Qwen3-TTS"
                  >
                    <Icon name="audio" />
                  </button>
                  <button
                    className={panelOpen ? "tool-button active" : "tool-button"}
                    onClick={() => setPanelOpen((current) => !current)}
                    aria-pressed={panelOpen}
                    title={panelOpen ? "Ocultar comentario y diccionario" : "Mostrar comentario y diccionario"}
                  >
                    <Icon name="panel" />
                  </button>
                </div>
              </div>

              <div className="reader-canvas-stage">
                <div className="reader-canvas-sheet">
                  <div className="reader-heading">
                    <span className="eyebrow">
                      {currentBible?.title ?? "Biblia"}
                      {readerMode === "book" ? " · lectura continua" : ""}
                    </span>
                    <h1>
                      {passage?.book.name ?? currentBook?.name ?? "Biblia"}
                      {readerMode !== "book" && <span> {chapter}</span>}
                    </h1>
                    {readerMode === "book" && (
                      <p className="reader-subtitle">
                        {bookText?.verses.length.toLocaleString("es") ?? "…"} versículos en este libro
                      </p>
                    )}
                  </div>

                  {readerMode === "interlinear" && (
                    <div
                      className="interlinear-chapter"
                      style={
                        {
                          "--interlinear-scale": fontScale,
                        } as CSSProperties
                      }
                    >
                      <div className="interlinear-toolbar">
                        <span>
                          STEPBible TAHOT + TAGNT · CC BY 4.0 ·{" "}
                          {interlinearStatus.books} libros ·{" "}
                          {interlinearStatus.tokens.toLocaleString("es")} tokens ·{" "}
                          {interlinearStatus.verses.toLocaleString("es")} versículos
                        </span>
                        <div className="interlinear-zoom">
                          <span>Zoom</span>
                          <input
                            type="range"
                            min={0.8}
                            max={1.8}
                            step={0.05}
                            value={fontScale}
                            onChange={(event) =>
                              setFontScale(Number(event.target.value))
                            }
                            aria-label="Zoom del interlineal"
                            title="Zoom del interlineal"
                          />
                          <strong>{Math.round(fontScale * 100)}%</strong>
                          <button
                            type="button"
                            className="interlinear-zoom-reset"
                            onClick={() => setFontScale(1)}
                            title="Restablecer zoom al 100%"
                          >
                            100%
                          </button>
                        </div>
                        <button onClick={() => setShowImport(true)}>
                          Importar STEPBible
                        </button>
                      </div>
                      {interlinearVerses.length > 0 ? (
                        interlinearVerses.map((verse) => {
                          const translated = chapterVerses.find(
                            (item) => item.verse === verse.verse,
                          );
                          return (
                            <InterlinearVerse
                              key={verse.verse}
                              verse={verse.verse}
                              translation={
                                translated
                                  ? plainTextFromHtml(translated.html)
                                  : ""
                              }
                              tokens={verse.tokens}
                              onStrong={openStrong}
                            />
                          );
                        })
                      ) : (
                        <div className="interlinear-empty">
                          <h2>Sin datos interlineales para este pasaje</h2>
                          <p>
                            Importa STEPBible-Data-master.zip (AT hebreo/arameo TAHOT + NT griego TAGNT) y vuelve a abrir este capítulo.
                          </p>
                          <button className="primary-button" onClick={() => setShowImport(true)}>
                            Importar STEPBible
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {readerMode === "verse" && (
                    <div className="verse-list">
                      {chapterVerses.map((verse) => renderVerseRow(verse))}
                      {chapterVerses.length === 0 && (
                        <p className="empty-hint">Este capítulo no tiene texto en la versión elegida.</p>
                      )}
                    </div>
                  )}

                  {readerMode === "page" && (
                    <div className="page-reader">
                      <div className="page-sheet">
                        <div className="page-header">
                          <span>
                            {passage?.book.name ?? currentBook?.name} {chapter}
                          </span>
                          <span>
                            {pageIndex + 1} / {pageCount}
                          </span>
                        </div>
                        <div className="page-body">
                          {pageVerses.map((verse) => renderVerseRow(verse, true))}
                        </div>
                        <div className="page-footer">
                          {pageIndex + 1} de {pageCount}
                        </div>
                      </div>
                      <div className="page-nav">
                        <button
                          onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                          disabled={pageIndex <= 0}
                        >
                          ‹ Página anterior
                        </button>
                        <span>
                          Página {pageIndex + 1} de {pageCount}
                        </span>
                        <button
                          onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
                          disabled={pageIndex >= pageCount - 1}
                        >
                          Página siguiente ›
                        </button>
                      </div>
                    </div>
                  )}

                  {readerMode === "book" && (
                    <div className="book-flow">
                      {!bookText && <p className="empty-hint">Cargando el libro completo…</p>}
                      {bookGroups.map(([chapterNumber, verses]) => (
                        <section className="book-flow-chapter" key={chapterNumber}>
                          <h2 className="chapter-heading">Capítulo {chapterNumber}</h2>
                          {verses.map((verse) => renderVerseRow(verse, true))}
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {panelVisible && (
              <aside
                className="study-panel"
                style={
                  {
                    "--study-font": `"${studyFont}", Georgia, serif`,
                    "--study-font-size": `${12.5 * studyFontScale}px`,
                  } as CSSProperties
                }
              >
                <div
                  className="panel-resizer"
                  onPointerDown={startResize}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Redimensionar panel de estudio"
                  title="Arrastrar para redimensionar"
                />
                <div className="panel-tabs">
                  <button
                    className={panelTab === "commentary" ? "active" : ""}
                    onClick={() => setPanelTab("commentary")}
                  >
                    Comentario
                  </button>
                  <button
                    className={panelTab === "dictionary" ? "active" : ""}
                    onClick={() => setPanelTab("dictionary")}
                  >
                    Diccionario
                  </button>
                  <button
                    className={panelTab === "notes" ? "active" : ""}
                    onClick={() => {
                      setPanelTab("notes");
                      if (!sideNoteAnchor) {
                        startNewSidePanelNoteForActiveVerse();
                      }
                    }}
                  >
                    Notas{annotations.notes.length > 0 ? ` (${annotations.notes.length})` : ""}
                  </button>
                  <button
                    className="panel-close"
                    onClick={() => setPanelOpen(false)}
                    aria-label="Ocultar panel de estudio"
                    title="Ocultar panel"
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <div className="panel-format-bar">
                  <SelectMenu
                    className="panel-font-select-menu"
                    value={studyFont}
                    onChange={setStudyFont}
                    ariaLabel="Fuente del comentario y diccionario"
                    options={FONT_OPTIONS}
                  />
                  <button
                    onClick={() => setStudyFontScale((current) => Math.max(0.8, current - 0.06))}
                    aria-label="Disminuir fuente del panel"
                    title="Disminuir fuente del panel"
                  >
                    A−
                  </button>
                  <button
                    onClick={() => setStudyFontScale((current) => Math.min(2.2, current + 0.06))}
                    aria-label="Aumentar fuente del panel"
                    title="Aumentar fuente del panel"
                  >
                    A+
                  </button>
                  <PaperModePicker compact />
                </div>

                {panelTab === "commentary" && (
                  <div className="panel-content">
                    <div className="panel-select-row">
                      <SelectMenu
                        className="panel-resource-select-menu"
                        value={commentaryId}
                        onChange={setCommentaryId}
                        ariaLabel="Comentario"
                        options={commentaryResources.map((resource) => ({
                          value: resource.id,
                          label: resource.title,
                        }))}
                      />
                    </div>
                    <div className="reference-chip">
                      {passage?.book.name ?? currentBook?.name} {chapter}:{activeVerse}
                    </div>
                    {commentaries.map((entry, index) => (
                      <article
                        className="commentary-entry"
                        key={index}
                        onClick={handleScriptureLinkClick}
                      >
                        {entry.chapterStart > 0 && (
                          <div className="entry-range">
                            {entry.chapterStart}:{entry.verseStart}
                            {entry.chapterEnd !== entry.chapterStart ||
                            entry.verseEnd !== entry.verseStart
                              ? `–${entry.chapterEnd}:${entry.verseEnd}`
                              : ""}
                          </div>
                        )}
                        <Html
                          html={processBookChapterHtml(entry.html).html}
                          className="rich-text"
                        />
                      </article>
                    ))}
                    {commentaries.length === 0 && (
                      <p className="empty-hint">
                        No hay comentario para este versículo en la obra seleccionada.
                      </p>
                    )}
                  </div>
                )}

                {panelTab === "dictionary" && (
                  <div className="panel-content">
                    <div className="panel-select-row">
                      <SelectMenu
                        className="panel-resource-select-menu"
                        value={dictionaryId}
                        onChange={setDictionaryId}
                        ariaLabel="Diccionario"
                        options={dictionaries.map((resource) => ({
                          value: resource.id,
                          label: resource.title,
                        }))}
                      />
                    </div>
                    <form
                      className="dictionary-search"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void lookupTopic(topic);
                      }}
                    >
                      <input
                        value={topic}
                        onChange={(event) => setTopic(event.target.value)}
                        placeholder="Buscar una palabra…"
                        aria-label="Tema del diccionario"
                      />
                      <button type="submit">Ir</button>
                    </form>
                    <div className="topic-chips">
                      {topics.slice(0, 40).map((item) => (
                        <button key={item} onClick={() => void lookupTopic(item)}>
                          {item}
                        </button>
                      ))}
                    </div>
                    {dictionaryEntry && (
                      <article className="commentary-entry">
                        <h3>{dictionaryEntry.topic}</h3>
                        <Html html={dictionaryEntry.html} className="rich-text" />
                      </article>
                    )}
                    {currentDictionary && (
                      <p className="panel-caption">
                        {currentDictionary.entryCount.toLocaleString("es")} entradas en{" "}
                        {currentDictionary.abbreviation}.
                      </p>
                    )}
                  </div>
                )}

                {panelTab === "notes" && (
                  <div className="panel-content panel-notes-view">
                    <div className="panel-notes-toolbar">
                      <div className="reference-chip">
                        {sideNoteAnchor?.label ??
                          `${passage?.book.name ?? currentBook?.name} ${chapter}:${activeVerse}`}
                      </div>
                      <div className="panel-notes-toolbar-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={startNewSidePanelNoteForActiveVerse}
                          title="Crear nueva nota para el versículo activo"
                        >
                          + Nueva
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setShowNotes(true)}
                          title="Abrir el gestor completo de notas"
                        >
                          Panel completo
                        </button>
                      </div>
                    </div>

                    <div className="panel-note-editor">
                      <input
                        type="text"
                        className="panel-note-title-input"
                        value={sideNoteTitle}
                        onChange={(event) => setSideNoteTitle(event.target.value)}
                        placeholder={`Nota sobre ${passage?.book.name ?? currentBook?.name} ${chapter}:${activeVerse}`}
                      />
                      <textarea
                        className="panel-note-textarea"
                        value={sideNoteBody}
                        onChange={(event) => setSideNoteBody(event.target.value)}
                        placeholder="Escribe aquí tu reflexión, exégesis o apuntes del versículo…"
                        rows={5}
                      />
                      <div className="panel-note-editor-footer">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => void saveSidePanelNote()}
                        >
                          {sideNoteId ? "Actualizar nota" : "Guardar nota"}
                        </button>
                        {sideNoteId && (
                          <button
                            type="button"
                            className="secondary-button danger-button"
                            onClick={() => void deleteNoteById(sideNoteId)}
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="panel-annotations-section">
                      <div className="section-label">
                        Notas en este capítulo ({annotations.notes.length})
                      </div>
                      {annotations.notes.length === 0 ? (
                        <p className="empty-hint">
                          Aún no hay notas en este capítulo. Selecciona texto o escribe arriba.
                        </p>
                      ) : (
                        <div className="panel-notes-list">
                          {annotations.notes.map((note) => {
                            const firstAnchor = note.anchors[0];
                            const parsed = firstAnchor ? parseAnchor(firstAnchor.anchorUri) : null;
                            return (
                              <article
                                key={note.id}
                                className={
                                  sideNoteId === note.id
                                    ? "panel-note-card active"
                                    : "panel-note-card"
                                }
                              >
                                <div className="panel-note-card-head">
                                  <strong>{note.title}</strong>
                                  {parsed?.kind === "bible" && (
                                    <span className="reference-chip">
                                      {parsed.chapter}:{parsed.verse}
                                    </span>
                                  )}
                                </div>
                                {note.excerpt && <p>{note.excerpt}</p>}
                                <div className="panel-note-card-actions">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void loadNoteIntoSidePanel(note, {
                                        anchorUri:
                                          firstAnchor?.anchorUri ??
                                          bibleAnchor(book, chapter, activeVerse),
                                        exactText: firstAnchor?.exactText ?? "",
                                        startOffset: firstAnchor?.startOffset ?? 0,
                                        endOffset: firstAnchor?.endOffset ?? 0,
                                        label: `${passage?.book.name ?? currentBook?.name} ${
                                          parsed?.kind === "bible" ? parsed.chapter : chapter
                                        }:${parsed?.kind === "bible" ? parsed.verse : activeVerse}`,
                                      })
                                    }
                                  >
                                    Editar aquí
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) =>
                                      void loadNoteIntoFloating(
                                        note,
                                        {
                                          anchorUri:
                                            firstAnchor?.anchorUri ??
                                            bibleAnchor(book, chapter, activeVerse),
                                          exactText: firstAnchor?.exactText ?? "",
                                          startOffset: firstAnchor?.startOffset ?? 0,
                                          endOffset: firstAnchor?.endOffset ?? 0,
                                          label: `${passage?.book.name ?? currentBook?.name} ${
                                            parsed?.kind === "bible" ? parsed.chapter : chapter
                                          }:${parsed?.kind === "bible" ? parsed.verse : activeVerse}`,
                                        },
                                        event.clientX - 320,
                                        event.clientY,
                                        false,
                                      )
                                    }
                                  >
                                    Abrir flotante
                                  </button>
                                  <button
                                    type="button"
                                    className="danger-link"
                                    onClick={() => void deleteNoteById(note.id)}
                                  >
                                    Borrar
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="panel-annotations-section">
                      <div className="section-label">
                        Resaltados en este capítulo ({annotations.highlights.length})
                      </div>
                      {annotations.highlights.length === 0 ? (
                        <p className="empty-hint">No hay resaltados en este capítulo.</p>
                      ) : (
                        <div className="panel-highlights-list">
                          {annotations.highlights.map((hl) => {
                            const parsed = parseAnchor(hl.anchorUri);
                            return (
                              <div key={hl.id} className="panel-highlight-item">
                                <span
                                  className="verse-highlight-dot"
                                  style={{
                                    background:
                                      HIGHLIGHT_COLORS[hl.styleId] ?? HIGHLIGHT_COLORS.yellow,
                                  }}
                                />
                                <div className="panel-highlight-copy">
                                  <strong>
                                    {parsed?.kind === "bible"
                                      ? `Versículo ${parsed.chapter}:${parsed.verse}`
                                      : hl.anchorUri}
                                  </strong>
                                  {hl.exactText && <small>“{hl.exactText.slice(0, 70)}”</small>}
                                </div>
                                <button
                                  type="button"
                                  className="danger-link"
                                  onClick={() => void deleteHighlightById(hl.id)}
                                  title="Eliminar este resaltado"
                                >
                                  Borrar ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </aside>
            )}
          </div>
        )}

        {view === "book" && (
          <div
            className={`book-layout${bookTocCollapsed ? " toc-collapsed" : ""}${bookImmersive ? " book-immersive" : ""}${panelVisible && !bookImmersive ? " with-panel" : ""}`}
            style={
              {
                "--book-panel-width": `${panelWidth}px`,
              } as CSSProperties
            }
          >
            <aside
              className={`book-toc${bookTocCollapsed ? " collapsed" : ""}`}
              aria-label="Índice del libro"
            >
              <div className="book-toc-head">
                {!bookTocCollapsed && (
                  <div className="book-toc-title">
                    <span>Índice del libro</span>
                    <small>
                      {bookChapters.length} capítulos · {processedBookChapter.outline.length} secciones
                    </small>
                    <button type="button" className="book-toc-reconstruct" onClick={() => void reconstructBookStructure()}>Ordenar índice y capítulos</button>
                  </div>
                )}
                <button
                  type="button"
                  className="book-toc-toggle"
                  onClick={() => setBookTocCollapsed((current) => !current)}
                  aria-expanded={!bookTocCollapsed}
                  aria-label={
                    bookTocCollapsed ? "Expandir el índice del libro" : "Contraer el índice del libro"
                  }
                  title={bookTocCollapsed ? "Expandir índice (T)" : "Contraer índice (T)"}
                >
                  {bookTocCollapsed ? "»" : "«"}
                </button>
              </div>

              {bookTocCollapsed ? (
                <div className="book-toc-rail" role="group" aria-label="Accesos del índice">
                  <button
                    type="button"
                    className={bookTocTab === "chapters" ? "active" : ""}
                    onClick={() => {
                      setBookTocTab("chapters");
                      setBookTocCollapsed(false);
                    }}
                    title="Capítulos"
                  >
                    <strong>☰</strong>
                    <span>Cap.</span>
                    <small>{bookChapters.length}</small>
                  </button>
                  <button
                    type="button"
                    className={bookTocTab === "outline" ? "active" : ""}
                    onClick={() => {
                      setBookTocTab("outline");
                      setBookTocCollapsed(false);
                    }}
                    title="Secciones del capítulo"
                  >
                    <strong>§</strong>
                    <span>Sec.</span>
                    <small>{processedBookChapter.outline.length}</small>
                  </button>
                  <button
                    type="button"
                    className={bookTocTab === "refs" ? "active" : ""}
                    onClick={() => {
                      setBookTocTab("refs");
                      setBookTocCollapsed(false);
                    }}
                    title="Citas bíblicas detectadas"
                  >
                    <strong>⌖</strong>
                    <span>Citas</span>
                    <small>{processedBookChapter.scriptureRefs.length}</small>
                  </button>
                  <div className="book-toc-rail-spacer" />
                  <button
                    type="button"
                    onClick={() => setBookTocCollapsed(false)}
                    title="Expandir índice (T)"
                    aria-label="Expandir índice"
                  >
                    <strong>»</strong>
                  </button>
                </div>
              ) : (
                <>
              <div className="book-toc-tabs" role="tablist" aria-label="Navegación del libro">
                <button
                  type="button"
                  role="tab"
                  aria-selected={bookTocTab === "chapters"}
                  className={bookTocTab === "chapters" ? "active" : ""}
                  onClick={() => setBookTocTab("chapters")}
                >
                  Capítulos ({bookChapters.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bookTocTab === "outline"}
                  className={bookTocTab === "outline" ? "active" : ""}
                  onClick={() => setBookTocTab("outline")}
                >
                  Secciones ({processedBookChapter.outline.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bookTocTab === "refs"}
                  className={bookTocTab === "refs" ? "active" : ""}
                  onClick={() => setBookTocTab("refs")}
                >
                  Citas ({processedBookChapter.scriptureRefs.length})
                </button>
              </div>

              {bookTocTab === "chapters" && (
                <div className="book-toc-list">
                  {bookChapters.map((chapterItem, index) => (
                    <div key={chapterItem.spine} className={chapterItem.spine === bookSpine ? "toc-row active" : "toc-row"}>
                      {renamingChapter === chapterItem.spine ? (
                        <input
                          className="toc-rename-input"
                          autoFocus
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => void saveChapterRename(chapterItem.spine, chapterItem.title)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveChapterRename(chapterItem.spine, chapterItem.title);
                            if (event.key === "Escape") setRenamingChapter(null);
                          }}
                        />
                      ) : (
                        <button type="button" className="toc-item" onClick={() => setBookSpine(chapterItem.spine)}>
                          <span>{index + 1}</span>
                          <strong>{chapterItem.title}</strong>
                        </button>
                      )}
                      <div className="toc-row-actions">
                        <button type="button" title="Renombrar capítulo" onClick={() => { setRenameDraft(chapterItem.title); setRenamingChapter(chapterItem.spine); }}>✎</button>
                        {chapterItem.spine > 0 && <button type="button" title="Unir con el capítulo anterior" onClick={() => void mergeBookChapter(chapterItem.spine)}>⇡</button>}
                      </div>
                    </div>
                  ))}
                  {bookChapters.length === 0 && (
                    <p className="empty-hint">Este libro no tiene capítulos legibles.</p>
                  )}
                </div>
              )}

              {bookTocTab === "outline" && (
                <div className="book-toc-list">
                  {processedBookChapter.outline.map((heading) => (
                    <div key={heading.id} className="toc-outline-row">
                    <button
                      type="button"
                      className={`toc-item outline-level-${heading.level}`}
                      onClick={() => {
                        if (
                          heading.tocSpine !== undefined &&
                          heading.tocSpine !== bookSpine
                        ) {
                          pendingBookAnchorRef.current =
                            heading.tocAnchor || heading.id;
                          setBookSpine(heading.tocSpine);
                          return;
                        }
                        const targetId =
                          heading.tocAnchor &&
                          document.getElementById(heading.tocAnchor)
                            ? heading.tocAnchor
                            : heading.id;
                        document
                          .getElementById(targetId)
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <span>H{heading.level}</span>
                      <strong>{heading.text}</strong>
                    </button>
                    <div className="toc-row-actions">
                      {([2, 3, 4] as const).map((level) => (
                        <button key={level} type="button" title={`Convertir en H${level}`} onClick={() => void applyBookBlockTag(`h${level}` as "h2" | "h3" | "h4", document.getElementById(heading.id))}>H{level}</button>
                      ))}
                    </div>
                    </div>
                  ))}
                  {processedBookChapter.outline.length === 0 && (
                    <p className="empty-hint">
                      Este capítulo no contiene subtítulos estructurados (H1–H4).
                    </p>
                  )}
                </div>
              )}

              {bookTocTab === "bookmarks" && (
                <div className="book-toc-bookmarks">
                  <div className="bookmark-ribbon-card">
                    <strong>{readingRibbon?.label ?? "Sin separador principal"}</strong>
                    <small>{view === "book" ? `${Math.round(bookProgress)}% del capítulo` : "Punto de lectura bíblico"}</small>
                    <button type="button" onClick={() => setBookmarksOpen(true)}>Abrir bitácora</button>
                  </div>
                  {bookmarks.filter((item) => !item.isPrimaryRibbon).map((bookmark) => (
                    <button type="button" className="book-toc-bookmark-row" key={bookmark.id} onClick={() => navigateToBookmark(bookmark.label, bookmark.resourceId, bookmark.spine)}>
                      <RibbonIcon size={12} color={bookmark.color || "#d97706"} /> {bookmark.label}
                    </button>
                  ))}
                </div>
              )}

              {bookTocTab === "refs" && (
                <div className="book-toc-list">
                  <div className="book-refs-summary">
                    <span>
                      Citas bíblicas detectadas automáticamente en este capítulo. Haz clic para
                      previsualizar o sincronizar con la Biblia y el Comentario.
                    </span>
                  </div>
                  {processedBookChapter.scriptureRefs.map((ref, idx) => (
                    <button
                      key={`${ref.book}-${ref.chapter}-${ref.verse}-${idx}`}
                      type="button"
                      className="book-ref-item"
                      onClick={(event) =>
                        void openScriptureRefPreview(
                          ref.book,
                          ref.chapter,
                          ref.verse,
                          ref.endVerse,
                          ref.label,
                          event.clientX + 180,
                          event.clientY,
                        )
                      }
                    >
                      <span className="book-ref-badge">📖 {ref.label}</span>
                      {ref.contextSnippet && <small>{ref.contextSnippet}</small>}
                    </button>
                  ))}
                  {processedBookChapter.scriptureRefs.length === 0 && (
                    <p className="empty-hint">
                      No se detectaron referencias bíblicas explícitas en este capítulo.
                    </p>
                  )}
                </div>
              )}
                </>
              )}
            </aside>
            <article
              className="book-reader"
              ref={bookReaderRef}
              onScroll={updateBookProgress}
              onMouseUp={handleBookSelection}
              onContextMenu={handleReaderContextMenu}
              style={
                {
                  "--reader-font": `"${readerFont}", Georgia, serif`,
                  "--reader-font-size": `${18.5 * fontScale}px`,
                  "--book-line-height": String(bookTypesetting.lineHeight),
                  "--book-para-spacing": `${bookTypesetting.paragraphSpacing}em`,
                  "--book-max-width": `${bookTypesetting.maxWidth}px`,
                  "--book-col-gap": "34px",
                } as CSSProperties
              }
            >
              <div className="book-font-bar">
                <div className="book-font-group">
                  {renderRibbonTools()}
                  <button
                    type="button"
                    onClick={() => window.print()}
                    title={tr("Imprimir este capítulo", "Print this chapter")}
                    aria-label={tr("Imprimir", "Print")}
                  >
                    🖨
                  </button>
                  <SelectMenu
                    className="book-font-select-menu"
                    value={readerFont}
                    onChange={setReaderFont}
                    ariaLabel="Fuente del libro"
                    options={FONT_OPTIONS}
                  />
                  <button
                    onClick={() => setFontScale((current) => Math.max(0.8, current - 0.06))}
                    aria-label="Disminuir fuente del libro"
                    title="Disminuir fuente"
                  >
                    A−
                  </button>
                  <button
                    onClick={() => setFontScale((current) => Math.min(1.8, current + 0.06))}
                    aria-label="Aumentar fuente del libro"
                    title="Aumentar fuente"
                  >
                    A+
                  </button>
                  <PaperModePicker />
                </div>

                <div className="book-typeset-controls" role="group" aria-label="Maquetación editorial">
                  <button
                    type="button"
                    className={`tool-button${bookTypesetting.columns > 1 ? " active" : ""}`}
                    onClick={cycleBookColumns}
                    title="Cambiar el número de columnas de lectura (1, 2 o 3)"
                    aria-label={`Columnas de lectura: ${bookTypesetting.columns}`}
                  >
                    {bookTypesetting.columns} Col
                  </button>

                  <button
                    type="button"
                    className={`tool-button${bookFullMode ? " active" : ""}`}
                    onClick={() => setBookFullMode((current) => !current)}
                    title="Leer todos los capítulos seguidos"
                  >
                    Libro completo
                  </button>
                  <button type="button" className={`tool-button${bookCurationMode ? " active" : ""}`} onClick={() => setBookCurationMode((current) => !current)} title="Modo Maquetación: asigna H1–H4 y divide capítulos desde el texto">Maquetar</button>
                  <div className="book-view-wrap" ref={bookViewMenuRef}>
                    <button
                      type="button"
                      className={`tool-button${bookViewMenuOpen ? " active" : ""}`}
                      onClick={() => setBookViewMenuOpen((current) => !current)}
                      aria-expanded={bookViewMenuOpen}
                      aria-haspopup="dialog"
                      title="Ajustes de vista de lectura: columnas, ancho, interlineado y tipografía"
                    >
                      Aa Vista
                    </button>
                    {bookViewMenuOpen && (
                      <div
                        className="book-view-popover"
                        role="dialog"
                        aria-label="Ajustes de vista de lectura"
                      >
                        <div className="book-view-heading">
                          <strong>Vista de lectura</strong>
                          <span>Se guarda automáticamente</span>
                        </div>
                        <button type="button" className="secondary-button book-view-reconstruct" onClick={() => void reconstructBookStructure()}>Ordenar índice y capítulos</button>

                        <div className="book-view-section">
                          <span className="book-view-label">Columnas</span>
                          <div className="book-view-segmented" role="group" aria-label="Número de columnas">
                            {([1, 2, 3] as const).map((count) => (
                              <button
                                key={count}
                                type="button"
                                className={bookTypesetting.columns === count ? "active" : ""}
                                onClick={() =>
                                  setBookTypesetting((previous) => ({ ...previous, columns: count }))
                                }
                                title={`${count} columna${count > 1 ? "s" : ""}`}
                                aria-pressed={bookTypesetting.columns === count}
                              >
                                {count}
                              </button>
                            ))}
                          </div>
                        </div>

                        <label className="book-view-range">
                          <span>
                            Ancho de lectura <small>{bookTypesetting.maxWidth} px</small>
                          </span>
                          <input
                            type="range"
                            min={560}
                            max={1200}
                            step={20}
                            value={bookTypesetting.maxWidth}
                            onChange={(event) =>
                              setBookTypesetting((previous) => ({
                                ...previous,
                                maxWidth: Number(event.target.value),
                              }))
                            }
                          />
                        </label>

                        <label className="book-view-range">
                          <span>
                            Interlineado <small>{bookTypesetting.lineHeight.toFixed(2)}×</small>
                          </span>
                          <input
                            type="range"
                            min={1.4}
                            max={2.1}
                            step={0.05}
                            value={bookTypesetting.lineHeight}
                            onChange={(event) =>
                              setBookTypesetting((previous) => ({
                                ...previous,
                                lineHeight: Number(event.target.value),
                              }))
                            }
                          />
                        </label>

                        <label className="book-view-range">
                          <span>
                            Espacio entre párrafos{" "}
                            <small>{bookTypesetting.paragraphSpacing.toFixed(2)} em</small>
                          </span>
                          <input
                            type="range"
                            min={0.4}
                            max={1.6}
                            step={0.05}
                            value={bookTypesetting.paragraphSpacing}
                            onChange={(event) =>
                              setBookTypesetting((previous) => ({
                                ...previous,
                                paragraphSpacing: Number(event.target.value),
                              }))
                            }
                          />
                        </label>

                        <div className="book-view-toggles">
                          <label>
                            <input
                              type="checkbox"
                              checked={bookTypesetting.justify}
                              onChange={(event) =>
                                setBookTypesetting((previous) => ({
                                  ...previous,
                                  justify: event.target.checked,
                                }))
                              }
                            />
                            <span>Justificar</span>
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={bookTypesetting.firstLineIndent}
                              onChange={(event) =>
                                setBookTypesetting((previous) => ({
                                  ...previous,
                                  firstLineIndent: event.target.checked,
                                }))
                              }
                            />
                            <span>Sangría</span>
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={bookTypesetting.dropCap}
                              onChange={(event) =>
                                setBookTypesetting((previous) => ({
                                  ...previous,
                                  dropCap: event.target.checked,
                                }))
                              }
                            />
                            <span>Capitular</span>
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={bookTypesetting.columnRule}
                              onChange={(event) =>
                                setBookTypesetting((previous) => ({
                                  ...previous,
                                  columnRule: event.target.checked,
                                }))
                              }
                            />
                            <span>Regla entre columnas</span>
                          </label>
                        </div>

                        <button
                          type="button"
                          className="book-view-reset"
                          onClick={() => setBookTypesetting({ ...DEFAULT_BOOK_TYPESETTING })}
                        >
                          Restablecer vista
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`tool-button${isFullscreen ? " active" : ""}`}
                    onClick={() => void toggleFullscreen()}
                    aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                    title={isFullscreen ? "Salir de pantalla completa (F11)" : "Pantalla completa (F11)"}
                  >
                    <Icon name={isFullscreen ? "collapse" : "expand"} />
                  </button>
                  <button
                    type="button"
                    className={`tool-button${bookImmersive ? " active" : ""}`}
                    onClick={() => setBookImmersive((current) => !current)}
                    aria-pressed={bookImmersive}
                    aria-label="Alternar lectura inmersiva"
                    title="Lectura inmersiva: oculta menús y deja solo el texto"
                  >
                    <Icon name="focus" />
                  </button>
                  <button
                    type="button"
                    className="tool-button"
                    onClick={() => openAvanzadoModularPreset("seminary")}
                    title="Abrir este libro conectado con Biblia y Comentario en el Lienzo Modular (estilo integrado)"
                  >
                    ⊞ Seminario
                  </button>
                  <button
                    type="button"
                    className={panelOpen ? "tool-button active" : "tool-button"}
                    onClick={() => setPanelOpen((current) => !current)}
                    title={panelOpen ? "Ocultar panel de estudio conectado" : "Mostrar panel de estudio conectado"}
                  >
                    <Icon name="panel" />
                  </button>
                </div>
              </div>

              <div
                className="book-progress"
                role="progressbar"
                aria-valuenow={Math.round(bookProgress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Progreso de lectura: ${Math.round(bookProgress)}%`}
              >
                <span className="book-progress-fill" style={{ width: `${bookProgress}%` }} />
              </div>

              {bookImmersive && (
                <div
                  className="book-immersive-bar"
                  role="toolbar"
                  aria-label="Controles de lectura inmersiva"
                >
                  <span className="book-immersive-title">Lectura inmersiva</span>
                  <span className="book-immersive-progress">{Math.round(bookProgress)}%</span>
                  <button
                    type="button"
                    onClick={() => void toggleFullscreen()}
                    title={isFullscreen ? "Salir de pantalla completa (F11)" : "Pantalla completa (F11)"}
                    aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                  >
                    {isFullscreen ? "Restaurar" : "Pantalla completa"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBookImmersive(false)}
                    title="Salir de la lectura inmersiva (Esc)"
                  >
                    Salir ✕
                  </button>
                </div>
              )}

              <div className="reader-canvas-stage">
                <div className="reader-canvas-sheet">
                  {bookChapter ? (
                    bookFullMode ? (
                      <div className="book-full-surface">
                        {bookFullChapters.map((chapter, index) => (
                          <section key={chapter.spine} className="book-full-chapter" data-spine={chapter.spine}>
                            <h1>{chapter.title}</h1>
                            <div
                              className="book-typeset-surface"
                              onClick={handleScriptureLinkClick}
                              dangerouslySetInnerHTML={{ __html: processedBookFull[index]?.html ?? chapter.html }}
                            />
                          </section>
                        ))}
                      </div>
                    ) : (
                    <>
                      <div className="reader-heading book-heading">
                        <div className="book-heading-meta">
                          <span className="eyebrow">{currentLibraryBook?.title ?? "Libro"}</span>
                          <span className="book-stats-pill">
                            {processedBookChapter.wordCount.toLocaleString("es")} palabras · ~
                            {processedBookChapter.readingMinutes} min lectura ·{" "}
                            {processedBookChapter.scriptureRefs.length} citas bíblicas
                          </span>
                        </div>
                        <h1>{bookChapter.title}</h1>
                        {processedBookChapter.scriptureRefs.length > 0 && (
                          <div className="mod-book-refs-bar">
                            <span className="mod-book-refs-label">
                              Citas conectadas ({processedBookChapter.scriptureRefs.length}):
                            </span>
                            {processedBookChapter.scriptureRefs.slice(0, 14).map((ref, idx) => (
                              <button
                                key={`${ref.book}-${ref.chapter}-${ref.verse}-${idx}`}
                                type="button"
                                className="mod-book-ref-chip"
                                onClick={(event) =>
                                  void openScriptureRefPreview(
                                    ref.book,
                                    ref.chapter,
                                    ref.verse,
                                    ref.endVerse,
                                    ref.label,
                                    event.clientX,
                                    event.clientY,
                                  )
                                }
                                title={`Previsualizar ${ref.label} y sincronizar panel`}
                              >
                                {ref.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {readingRibbon?.resourceId === bookId && readingRibbon.spine === bookSpine && (
                        <div className="reading-ribbon-banner"><RibbonIcon size={13} color="#d97706" /> Punto de lectura</div>
                      )}
                      <div
                        className={[
                          "epub-content",
                          "book-typeset-surface",
                          `cols-${bookTypesetting.columns}`,
                          bookTypesetting.columnRule && bookTypesetting.columns > 1
                            ? "rule-on"
                            : "",
                          bookTypesetting.justify ? "justify-on" : "",
                          bookTypesetting.firstLineIndent ? "indent-on" : "",
                          bookTypesetting.dropCap ? "dropcap-on" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={handleScriptureLinkClick}
                        onMouseOver={handleBookBlockHover}
                        onMouseLeave={() => setBookHoveredBlock(null)}
                        dangerouslySetInnerHTML={{ __html: processedBookChapter.html }}
                      />
                      <div className="book-nav">
                        <button
                          onClick={() => moveBook(-1)}
                          disabled={
                            bookChapters.findIndex((item) => item.spine === bookSpine) <= 0
                          }
                          title="Capítulo anterior (Alt+←)"
                        >
                          ‹ Anterior
                        </button>
                        <span className="book-nav-progress">
                          <span className="book-progress-dot" aria-hidden="true" />
                          {Math.round(bookProgress)}% leído
                        </span>
                        <span>
                          {bookChapters.findIndex((item) => item.spine === bookSpine) + 1} /{" "}
                          {bookChapters.length}
                        </span>
                        <button
                          onClick={() => moveBook(1)}
                          disabled={
                            bookChapters.findIndex((item) => item.spine === bookSpine) >=
                            bookChapters.length - 1
                          }
                          title="Capítulo siguiente (Alt+→)"
                        >
                          Siguiente ›
                        </button>
                        <button type="button" onClick={() => void completeCurrentUnit()}>
                          ✓ Capítulo completado
                        </button>
                      </div>
                    </>
                    )
                  ) : (
                    <p className="empty-hint">Cargando libro…</p>
                  )}
                </div>
              </div>
            </article>

            {panelVisible && !bookImmersive && (
              <aside
                className="study-panel"
                style={
                  {
                    "--study-font": `"${studyFont}", Georgia, serif`,
                    "--study-font-size": `${12.5 * studyFontScale}px`,
                  } as CSSProperties
                }
              >
                <div
                  className="panel-resizer"
                  onPointerDown={startResize}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Redimensionar panel de estudio"
                  title="Arrastrar para redimensionar"
                />
                <div className="panel-tabs">
                  <button
                    className={panelTab === "commentary" ? "active" : ""}
                    onClick={() => setPanelTab("commentary")}
                  >
                    Comentario
                  </button>
                  <button
                    className={panelTab === "dictionary" ? "active" : ""}
                    onClick={() => setPanelTab("dictionary")}
                  >
                    Diccionario
                  </button>
                  <button
                    className={panelTab === "notes" ? "active" : ""}
                    onClick={() => setPanelTab("notes")}
                  >
                    Notas ({annotations.notes.length})
                  </button>
                  <button
                    className="panel-close"
                    onClick={() => setPanelOpen(false)}
                    aria-label="Ocultar panel de estudio"
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <div className="panel-format-bar">
                  <SelectMenu
                    className="panel-font-select-menu"
                    value={studyFont}
                    onChange={setStudyFont}
                    ariaLabel="Fuente del panel"
                    options={FONT_OPTIONS}
                  />
                  <button
                    onClick={() => setStudyFontScale((current) => Math.max(0.8, current - 0.06))}
                    title="Disminuir fuente del panel"
                  >
                    A−
                  </button>
                  <button
                    onClick={() => setStudyFontScale((current) => Math.min(2.2, current + 0.06))}
                    title="Aumentar fuente del panel"
                  >
                    A+
                  </button>
                  <PaperModePicker compact />
                </div>

                {panelTab === "commentary" && (
                  <div className="panel-content">
                    <div className="panel-select-row">
                      <SelectMenu
                        className="panel-resource-select-menu"
                        value={commentaryId}
                        onChange={setCommentaryId}
                        ariaLabel="Comentario"
                        options={commentaryResources.map((resource) => ({
                          value: resource.id,
                          label: resource.title,
                        }))}
                      />
                    </div>
                    <div className="reference-chip">
                      📖 {passage?.book.name ?? currentBook?.name} {chapter}:{activeVerse}
                      <button
                        type="button"
                        className="ref-jump-inline"
                        onClick={() => setView("reader")}
                      >
                        Abrir Biblia ›
                      </button>
                    </div>
                    {activeVerseText && (
                      <blockquote className="connected-bible-quote">
                        <strong>
                          {currentBible?.abbreviation ?? "Biblia"} {chapter}:{activeVerse}
                        </strong>{" "}
                        — {activeVerseText}
                      </blockquote>
                    )}
                    {commentaries.map((entry, index) => (
                      <article
                        className="commentary-entry"
                        key={index}
                        onClick={handleScriptureLinkClick}
                      >
                        {entry.chapterStart > 0 && (
                          <div className="entry-range">
                            {entry.chapterStart}:{entry.verseStart}
                            {entry.chapterEnd !== entry.chapterStart ||
                            entry.verseEnd !== entry.verseStart
                              ? `–${entry.chapterEnd}:${entry.verseEnd}`
                              : ""}
                          </div>
                        )}
                        <Html
                          html={processBookChapterHtml(entry.html).html}
                          className="rich-text"
                        />
                      </article>
                    ))}
                    {commentaries.length === 0 && (
                      <p className="empty-hint">
                        Haz clic en cualquier cita bíblica del libro para cargar su pasaje y
                        comentario aquí.
                      </p>
                    )}
                  </div>
                )}

                {panelTab === "dictionary" && (
                  <div className="panel-content">
                    <div className="panel-select-row">
                      <SelectMenu
                        className="panel-resource-select-menu"
                        value={dictionaryId}
                        onChange={setDictionaryId}
                        ariaLabel="Diccionario"
                        options={dictionaries.map((resource) => ({
                          value: resource.id,
                          label: resource.title,
                        }))}
                      />
                    </div>
                    <form
                      className="dictionary-search"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void lookupTopic(topic);
                      }}
                    >
                      <input
                        value={topic}
                        onChange={(event) => setTopic(event.target.value)}
                        placeholder="Buscar término del libro…"
                        aria-label="Tema del diccionario"
                      />
                      <button type="submit">Ir</button>
                    </form>
                    <div className="topic-chips">
                      {topics.slice(0, 30).map((item) => (
                        <button key={item} onClick={() => void lookupTopic(item)}>
                          {item}
                        </button>
                      ))}
                    </div>
                    {dictionaryEntry && (
                      <article className="commentary-entry">
                        <h3>{dictionaryEntry.topic}</h3>
                        <Html html={dictionaryEntry.html} className="rich-text" />
                      </article>
                    )}
                  </div>
                )}

                {panelTab === "notes" && (
                  <div className="panel-content panel-notes-view">
                    <div className="panel-notes-toolbar">
                      <div className="reference-chip">
                        {currentLibraryBook?.abbreviation || currentLibraryBook?.title || "Libro"} · Cap.{" "}
                        {bookSpine + 1}
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setShowNotes(true)}
                      >
                        Gestor de Notas
                      </button>
                    </div>
                    <p className="empty-hint">
                      Selecciona cualquier fragmento del libro para resaltarlo o crear una nota
                      anclada a este capítulo.
                    </p>
                  </div>
                )}
              </aside>
            )}
          </div>
        )}

        {showWorkspaces && (
          <div className="drawer-backdrop" onClick={() => setShowWorkspaces(false)}>
            <aside
              className="workspace-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Entornos de ventana al estilo integrado"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="drawer-heading">
                <div>
                  <span className="eyebrow">Ecosistema y Disposición (Estilo Integrado)</span>
                  <h2>Entornos de Estudio</h2>
                </div>
                <button
                  className="icon-button"
                  onClick={() => setShowWorkspaces(false)}
                  aria-label="Cerrar entornos"
                >
                  <Icon name="close" />
                </button>
              </div>
              <p className="drawer-copy">
                Elige una plantilla de entorno conectada (con grupos de enlace Link Set A–F entre
                Biblia, Comentarios y Libros) o guarda instantáneas completas de tu espacio de
                trabajo.
              </p>

              <div className="section-label">Plantillas rápidas (Ventana principal)</div>
              <div className="avanzado-layout-grid">
                <button
                  type="button"
                  className="avanzado-layout-card"
                  onClick={() => applyPreset("study")}
                >
                  <div className="avanzado-layout-diagram">
                    <span className="pane-box wide">Biblia</span>
                    <span className="pane-box">Com / Dic / Notas</span>
                  </div>
                  <strong>Estudio Bíblico Integrado</strong>
                  <small>Biblia por versículo + Panel lateral de Comentario, Diccionario y Notas</small>
                </button>

                <button
                  type="button"
                  className="avanzado-layout-card"
                  onClick={() => applyPreset("reading")}
                >
                  <div className="avanzado-layout-diagram">
                    <span className="pane-box full">Lectura continua enfocada</span>
                  </div>
                  <strong>Lectura Limpia Inmersiva</strong>
                  <small>Libro completo sin distracciones, ideal con modos de papel Sepia o Crema</small>
                </button>
              </div>

              <div className="section-label">
                Entornos Multipanel Avanzados (Lienzo con Link Sets A–F)
              </div>
              <div className="avanzado-layout-grid">
                <button
                  type="button"
                  className="avanzado-layout-card"
                  onClick={() => openAvanzadoModularPreset("study")}
                >
                  <div className="avanzado-layout-diagram">
                    <span className="pane-box wide">Biblia [A]</span>
                    <div className="pane-stack">
                      <span className="pane-box">Comentario [A]</span>
                      <span className="pane-box">Diccionario</span>
                    </div>
                  </div>
                  <strong>Exégesis 3 Paneles (Link A)</strong>
                  <small>Biblia sincronizada con Comentario + Diccionario léxico abajo</small>
                </button>

                <button
                  type="button"
                  className="avanzado-layout-card"
                  onClick={() => openAvanzadoModularPreset("seminary")}
                >
                  <div className="avanzado-layout-diagram">
                    <span className="pane-box">Biblia [A]</span>
                    <span className="pane-box">Libro [A]</span>
                    <span className="pane-box">Comentario [A]</span>
                  </div>
                  <strong>Seminario: Biblia + Libro + Comentario</strong>
                  <small>Citas del libro sincronizan automáticamente la Biblia y el Comentario</small>
                </button>

                <button
                  type="button"
                  className="avanzado-layout-card"
                  onClick={() => openAvanzadoModularPreset("grid4")}
                >
                  <div className="avanzado-layout-diagram grid-2x2">
                    <span className="pane-box">Biblia 1 [A]</span>
                    <span className="pane-box">Biblia 2 [A]</span>
                    <span className="pane-box">Comentario [A]</span>
                    <span className="pane-box">Libro [A]</span>
                  </div>
                  <strong>Cuadrícula Multivista 2×2 (4 paneles)</strong>
                  <small>2 versiones bíblicas + Comentario + Libro conectado en cuadrícula</small>
                </button>

                <button
                  type="button"
                  className="avanzado-layout-card"
                  onClick={() => openAvanzadoModularPreset("compare")}
                >
                  <div className="avanzado-layout-diagram">
                    <span className="pane-box">Biblia 1 [A]</span>
                    <span className="pane-box">Biblia 2 [A]</span>
                    <span className="pane-box">Comentario [A]</span>
                  </div>
                  <strong>Paralelo de Traducciones</strong>
                  <small>Dos Biblias en paralelo sincronizadas con Comentario exegético</small>
                </button>

                <button
                  type="button"
                  className="avanzado-layout-card"
                  onClick={() => openAvanzadoModularPreset("avanzado-compare")}
                >
                  <div className="avanzado-layout-diagram">
                    <span className="pane-box">Biblia [A]</span>
                    <span className="pane-box wide">Comparador [A]</span>
                    <span className="pane-box">Comentario [A]</span>
                  </div>
                  <strong>Estudio Comparado Avanzado</strong>
                  <small>Biblia + Comparador de Versiones integrado + Comentario enlazados</small>
                </button>

                <button
                  type="button"
                  className="avanzado-layout-card"
                  onClick={() => openAvanzadoModularPreset("avanzado-original")}
                >
                  <div className="avanzado-layout-diagram grid-2x2">
                    <span className="pane-box">Biblia [A]</span>
                    <span className="pane-box">Interlineal [A]</span>
                    <span className="pane-box">Comentario [A]</span>
                    <span className="pane-box">Diccionario</span>
                  </div>
                  <strong>Idiomas Originales (AT/NT)</strong>
                  <small>Biblia + Interlineal Hebreo/Griego + Comentario + Léxico Strong</small>
                </button>
              </div>

              <div className="section-label">Guardar entorno personalizado</div>
              <div className="save-workspace">
                <input
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder="Ej. Estudio de Juan 3 (Sepia + NTV)"
                  aria-label="Nombre del entorno"
                />
                <button className="primary-button" onClick={saveWorkspace}>
                  Guardar actual
                </button>
              </div>

              <div className="section-label">
                Mis entornos guardados ({workspaces.length})
              </div>
              <div className="workspace-list">
                {workspaces.map((workspace) => (
                  <div className="workspace-item" key={workspace.id}>
                    <button
                      className="workspace-main"
                      onClick={() => applyWorkspace(workspace)}
                    >
                      <strong>{workspace.name}</strong>
                      <span>
                        {bibles.find((item) => item.id === workspace.bibleId)?.abbreviation ??
                          "Biblia"}{" "}
                        · {books.find((b) => b.number === workspace.book)?.name ?? `Libro ${workspace.book}`}{" "}
                        {workspace.chapter}:{workspace.activeVerse} · {workspace.readerMode}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => updateWorkspaceInPlace(workspace.id)}
                      title="Actualizar este entorno con la disposición actual"
                      aria-label={`Actualizar entorno ${workspace.name}`}
                    >
                      ↻
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() =>
                        setWorkspaces((current) =>
                          current.filter((item) => item.id !== workspace.id),
                        )
                      }
                      aria-label={`Eliminar entorno ${workspace.name}`}
                      title="Eliminar entorno"
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                ))}
                {workspaces.length === 0 && (
                  <p className="empty-hint">
                    Todavía no hay entornos guardados. Configura la ventana y guarda uno arriba.
                  </p>
                )}
              </div>
            </aside>
          </div>
        )}

        {selectionMenu && !contextMenu && !showNotes && (
          <div
            className="selection-popover"
            style={{ left: selectionMenu.x, top: selectionMenu.y }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="selection-popover-label">
              <span>{selectionMenu.label}</span>
              <small>“{selectionMenu.text.slice(0, 90)}”</small>
            </div>
            <div className="selection-swatches">
              {Object.keys(HIGHLIGHT_COLORS).map((style) => (
                <button
                  key={style}
                  className={`selection-swatch ${style}`}
                  onClick={() => void applySelectionHighlight(style)}
                  aria-label={`Resaltar ${style}`}
                  title={`Resaltar ${style}`}
                />
              ))}
              {selectionHighlightIds.length > 0 && (
                <button
                  type="button"
                  className="selection-clear-highlight"
                  onClick={() => void deleteSelectionHighlights()}
                  title="Borrar resaltado"
                >
                  × Borrar
                </button>
              )}
            </div>
            <div className="selection-note-actions">
              <button className="selection-action" onClick={openFloatingNoteFromSelection}>
                <Icon name="note" /> Nota flotante
              </button>
              <button className="selection-action" onClick={openSidePanelNoteFromSelection}>
                <Icon name="panel" /> Nota en panel
              </button>
              <button
                className="selection-action"
                onClick={() => lookupTextInDictionary(selectionMenu.text)}
                title="Buscar la palabra seleccionada en el Diccionario"
              >
                <Icon name="search" /> Diccionario
              </button>
              <button
                className="selection-action"
                onClick={() => {
                  const parsed = parseAnchor(selectionMenu.anchorUri);
                  openWordStudy(
                    "",
                    selectionMenu.text,
                    parsed?.kind === "bible"
                      ? {
                          book: parsed.book,
                          chapter: parsed.chapter,
                          verse: parsed.verse,
                        }
                      : null,
                  );
                  setSelectionMenu(null);
                }}
                title="Abrir el estudio de palabra"
              >
                <Icon name="search" /> Estudio de palabra
              </button>
            </div>
            {selectionHighlightIds.length > 0 && (
              <button
                type="button"
                className="selection-delete-highlight"
                onClick={() => void deleteSelectionHighlights()}
              >
                <Icon name="trash" /> Eliminar resaltado
              </button>
            )}
            <button
              className="selection-copy"
              onClick={() => {
                void copyTextOrCitation(selectionMenu.text, selectionMenu.anchorUri, selectionMenu.label);
                setSelectionMenu(null);
              }}
            >
              {tr("Copiar texto", "Copy text")}
            </button>
            <button
              className="selection-copy selection-copy-citation"
              onClick={() => {
                void copyWithCitation(selectionMenu.text, selectionMenu.anchorUri, selectionMenu.label);
                setSelectionMenu(null);
              }}
            >
              Copiar con cita {citationStyleLabel(uiCustomization.citationStyle)}
            </button>
          </div>
        )}

        {bookCurationMode && bookHoveredBlock && (
          <div className="book-curation-toolbar" style={{ left: bookHoveredBlock.x, top: bookHoveredBlock.y }}>
            <button type="button" onClick={() => void splitBookChapterAt(bookHoveredBlock.node)}>✂ Cap.</button>
            {(["h1", "h2", "h3", "h4"] as const).map((tag) => (
              <button type="button" key={tag} onClick={() => void applyBookBlockTag(tag, bookHoveredBlock.node)}>{tag.toUpperCase()}</button>
            ))}
            <button type="button" onClick={() => void applyBookBlockTag("p", bookHoveredBlock.node)}>¶</button>
          </div>
        )}

        {contextMenu && !showNotes && (
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="context-menu-heading">
              <span>{contextMenu.label}</span>
              <small>“{contextMenu.text.slice(0, 50)}”</small>
            </div>
            <button onClick={() => lookupTextInDictionary(contextMenu.text)}>
              🔍 Buscar en Diccionario
            </button>
            <button
              onClick={() => {
                const parsed = parseAnchor(contextMenu.anchorUri);
                openWordStudy(
                  "",
                  contextMenu.text,
                  parsed?.kind === "bible"
                    ? {
                        book: parsed.book,
                        chapter: parsed.chapter,
                        verse: parsed.verse,
                      }
                    : null,
                );
                setContextMenu(null);
              }}
            >
              📖 Estudio de palabra
            </button>
            <button
              onClick={() => {
                void copyTextOrCitation(contextMenu.text, contextMenu.anchorUri, contextMenu.label);
                setContextMenu(null);
              }}
            >
              {tr("Copiar texto", "Copy text")}
            </button>
            <button
              onClick={() => {
                void copyWithCitation(contextMenu.text, contextMenu.anchorUri, contextMenu.label);
                setContextMenu(null);
              }}
            >
              Copiar con cita {citationStyleLabel(uiCustomization.citationStyle)}
            </button>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(contextMenu.label);
                setContextMenu(null);
              }}
            >
              Copiar referencia
            </button>
            {view === "book" && (
              <>
                <div className="context-menu-subhead">Jerarquía e Índice</div>
                <button onClick={() => void splitBookChapterAt()}>✂️ Dividir aquí como Nuevo Capítulo</button>
                <button onClick={() => void applyBookBlockTag("h1")}>H1 — Título dentro del capítulo</button>
                <button onClick={() => void applyBookBlockTag("h2")}>H2 — Sección principal</button>
                <button onClick={() => void applyBookBlockTag("h3")}>H3 — Subsección</button>
                <button onClick={() => void applyBookBlockTag("h4")}>H4 — Apartado menor</button>
                <button onClick={() => void applyBookBlockTag("p")}>¶ Convertir en párrafo normal</button>
                <button onClick={() => void formatBookParagraph("quote")}>❝ Convertir en cita con sangría</button>
                <button onClick={() => void formatBookParagraph("poetry")}>📜 Formatear como poesía / verso</button>
                <button onClick={() => void formatBookParagraph("callout")}>📌 Destacar como recuadro</button>
                <button onClick={() => void formatBookParagraph("normal")}>↩ Párrafo normal</button>
              </>
            )}
            <button onClick={openFloatingNoteFromContext}>
              Crear / abrir nota flotante
            </button>
            <button onClick={openSideNoteFromContext}>
              Abrir en pestaña Notas (junto a Diccionario)
            </button>
            <button onClick={openNoteFromContext}>
              Abrir en gestor de Notas completo
            </button>
            {contextMenu.highlightIds.length > 0 && (
              <button className="context-menu-delete" onClick={() => void deleteContextHighlight()}>
                Eliminar resaltado
              </button>
            )}
            {contextMenu.noteIds.length > 0 && (
              <button className="context-menu-delete" onClick={() => void deleteContextNote()}>
                Eliminar nota anclada
              </button>
            )}
            <div className="context-menu-swatches">
              {Object.keys(HIGHLIGHT_COLORS).map((style) => (
                <button
                  key={style}
                  className={`selection-swatch ${style}`}
                  onClick={() =>
                    void saveHighlight(contextMenu, style)
                  }
                  aria-label={`Resaltar ${style}`}
                  title={`Resaltar ${style}`}
                />
              ))}
            </div>
          </div>
        )}

        {floatingNote && (
          <div
            className="floating-note-card"
            style={{ left: floatingNote.x, top: floatingNote.y }}
            role="dialog"
            aria-label="Nota flotante"
          >
            <div className="floating-note-header">
              <div className="floating-note-title-wrap">
                <Icon name="note" />
                <span className="reference-chip">{floatingNote.anchor.label}</span>
              </div>
              <div className="floating-note-header-actions">
                <button
                  type="button"
                  className="floating-note-link-btn"
                  onClick={() => {
                    setPanelOpen(true);
                    setPanelTab("notes");
                    setSideNoteId(floatingNote.noteId);
                    setSideNoteTitle(floatingNote.title);
                    setSideNoteBody(floatingNote.body);
                    setSideNoteAnchor(floatingNote.anchor);
                    setFloatingNote(null);
                  }}
                  title="Pasar a la pestaña Notas junto a Diccionario"
                >
                  Pestaña Notas
                </button>
                <button
                  type="button"
                  className="floating-note-link-btn"
                  onClick={() => {
                    setNoteSeed(floatingNote.anchor);
                    setShowNotes(true);
                    setFloatingNote(null);
                  }}
                  title="Abrir el gestor completo de Notas"
                >
                  Panel completo
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setFloatingNote(null)}
                  aria-label="Cerrar nota flotante"
                >
                  <Icon name="close" />
                </button>
              </div>
            </div>

            {floatingNote.chooserOnly ? (
              <div className="floating-note-chooser">
                <p className="floating-note-preview-title">
                  <strong>{floatingNote.title}</strong>
                </p>
                {floatingNote.body && (
                  <p className="floating-note-preview-body">{floatingNote.body}</p>
                )}
                <div className="floating-note-chooser-buttons">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      setFloatingNote((current) =>
                        current ? { ...current, chooserOnly: false } : null,
                      )
                    }
                  >
                    Abrir nota flotante aquí
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setPanelOpen(true);
                      setPanelTab("notes");
                      setSideNoteId(floatingNote.noteId);
                      setSideNoteTitle(floatingNote.title);
                      setSideNoteBody(floatingNote.body);
                      setSideNoteAnchor(floatingNote.anchor);
                      setFloatingNote(null);
                    }}
                  >
                    Abrir pestaña Notas (junto a Diccionario)
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setNoteSeed(floatingNote.anchor);
                      setShowNotes(true);
                      setFloatingNote(null);
                    }}
                  >
                    Abrir panel de Notas completo
                  </button>
                </div>
              </div>
            ) : (
              <div className="floating-note-body">
                {floatingNote.anchor.exactText && (
                  <blockquote className="floating-note-quote">
                    “{floatingNote.anchor.exactText.slice(0, 120)}”
                  </blockquote>
                )}
                <input
                  type="text"
                  className="floating-note-input"
                  value={floatingNote.title}
                  onChange={(event) =>
                    setFloatingNote((current) =>
                      current ? { ...current, title: event.target.value } : null,
                    )
                  }
                  placeholder="Título de la nota"
                />
                <textarea
                  className="floating-note-textarea"
                  value={floatingNote.body}
                  onChange={(event) =>
                    setFloatingNote((current) =>
                      current ? { ...current, body: event.target.value } : null,
                    )
                  }
                  placeholder="Escribe tu nota aquí…"
                  rows={5}
                />
                <div className="floating-note-footer">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void saveFloatingNote()}
                  >
                    Guardar nota
                  </button>
                  {floatingNote.noteId && (
                    <button
                      type="button"
                      className="secondary-button danger-button"
                      onClick={() => void deleteFloatingNote()}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {scripturePreview && (
          <div
            className="scripture-preview-card"
            style={{ left: scripturePreview.x, top: scripturePreview.y }}
            role="dialog"
            aria-label={`Vista rápida de ${scripturePreview.label}`}
          >
            <div className="scripture-preview-head">
              <div>
                <span className="eyebrow">
                  {currentBible?.abbreviation ?? "Biblia"} · Cita conectada
                </span>
                <strong>📖 {scripturePreview.label}</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setScripturePreview(null)}
                aria-label="Cerrar previsualización"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="scripture-preview-body">
              {scripturePreview.loading ? (
                <p className="empty-hint">Consultando pasaje…</p>
              ) : (
                <p>{scripturePreview.text}</p>
              )}
            </div>
            <div className="scripture-preview-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  openReference(
                    scripturePreview.book,
                    scripturePreview.chapter,
                    scripturePreview.verse,
                  );
                  setScripturePreview(null);
                }}
              >
                Ir a la Biblia
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setBook(scripturePreview.book);
                  setChapter(scripturePreview.chapter);
                  setActiveVerse(scripturePreview.verse);
                  setScripturePreview(null);
                  openAvanzadoModularPreset("seminary");
                }}
              >
                ⊞ Abrir en Entorno Seminario
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setBook(scripturePreview.book);
                  setChapter(scripturePreview.chapter);
                  setActiveVerse(scripturePreview.verse);
                  setScripturePreview(null);
                  setShowCompare(true);
                }}
              >
                Comparar versiones
              </button>
            </div>
          </div>
        )}

        {showCompare && (
          <CompareWorkspace
            bibles={bibles}
            books={books}
            initialBook={book}
            initialChapter={chapter}
            initialVerse={activeVerse}
            onClose={() => setShowCompare(false)}
            onOpenCustomization={() => setShowCustomization(true)}
          />
        )}

        {showTts && (
          <TtsPanel
            text={activeVerseText}
            label={`${passage?.book.name ?? currentBook?.name ?? "Biblia"} ${chapter}:${activeVerse}`}
            onClose={() => setShowTts(false)}
            onPrev={() =>
              setActiveVerse((current) => Math.max(1, current - 1))
            }
            onNext={() =>
              setActiveVerse((current) =>
                Math.min(
                  Math.max(1, chapterVerses.length),
                  current + 1,
                ),
              )
            }
          />
        )}

        {showWordStudy && (
          <WordStudyPanel
            strong={wordStudyStrong}
            query={wordStudyQuery}
            reference={wordStudyReference}
            books={books}
            onClose={() => setShowWordStudy(false)}
            onOpenDictionary={(strong) => {
              setTopic(strong);
              setPanelTab("dictionary");
              setPanelOpen(true);
              setShowWordStudy(false);
            }}
            onOpenReference={(nextBook, nextChapter, nextVerse) => {
              openReference(nextBook, nextChapter, nextVerse);
              setShowWordStudy(false);
            }}
            onAskAssistant={(question) => {
              setAssistantSeed(question);
              setShowAssistant(true);
              setShowWordStudy(false);
            }}
          />
        )}

        {showHermeneutics && (
          <HermeneuticsWorkspace
            initialBook={book}
            initialChapter={chapter}
            initialVerse={activeVerse}
            initialBookName={currentBook?.name ?? "Pasaje"}
            onOpenBible={(nextBook, nextChapter, nextVerse) => {
              openReference(nextBook, nextChapter, nextVerse);
              setShowHermeneutics(false);
            }}
            onClose={() => setShowHermeneutics(false)}
          />
        )}

        {showDocuments && (
          <DocumentsWorkspace
            onClose={() => setShowDocuments(false)}
            onOpenPrayer={() => {
              setShowDocuments(false);
              setFormationTab("prayer");
            }}
            onOpenGuides={() => {
              setShowDocuments(false);
              setFormationTab("guides");
            }}
          />
        )}

        {formationTab && (
          <FormationWorkspace
            initialTab={formationTab}
            onClose={() => setFormationTab(null)}
          />
        )}

        {showAssistant && (
          <StudyAssistant
            initialQuestion={assistantSeed}
            onClose={() => {
              setShowAssistant(false);
              setAssistantSeed("");
            }}
            onOpenContext={openRagContext}
            onOpenCustomization={() => setShowCustomization(true)}
          />
        )}

        {showNotes && (
          <NotesWorkspace
            books={books}
            initialAnchor={noteSeed}
            initialNoteId={noteFocusId}
            onClose={() => {
              setShowNotes(false);
              setNoteSeed(null);
              setNoteFocusId(null);
            }}
            onOpenAnchor={openAnchor}
            onChanged={() => setAnnotationsVersion((current) => current + 1)}
            onOpenCustomization={() => setShowCustomization(true)}
          />
        )}

        {showModular && resources.length > 0 && (
          useDockEngine ? (
            <DockWorkspaceCore
              resources={resources}
              books={books}
              initialReference={{ book, chapter, verse: activeVerse }}
              readerFont={readerFont}
              studyFont={studyFont}
              readerScale={fontScale}
              studyScale={studyFontScale}
              onExit={() => setShowModular(false)}
            />
          ) : (
            <ModularWorkspace
              resources={resources}
              books={books}
              initialReference={{ book, chapter, verse: activeVerse }}
              initialPreset={modularPreset}
              initialBookId={modularBook?.resourceId}
              initialBookSpine={modularBook?.spine}
              readerFont={readerFont}
              studyFont={studyFont}
              readerScale={fontScale}
              studyScale={studyFontScale}
              onOpenCustomization={() => setShowCustomization(true)}
              onExit={() => {
                setShowModular(false);
                setModularPreset(undefined);
                setModularBook(null);
              }}
            />
          )
        )}

        {bookmarksOpen && (
          <BookmarksDrawer
            ribbon={readingRibbon}
            bookmarks={bookmarks}
            history={jumpHistory}
            currentLabel={currentLabel()}
            progress={view === "book" ? bookProgress : Math.min(100, (chapter / 50) * 100)}
            onClose={() => setBookmarksOpen(false)}
            onGoRibbon={goToReadingRibbon}
            onPlaceRibbon={() => void placeReadingRibbon()}
            onRemoveRibbon={() => void removeReadingRibbon()}
            onSaveBookmark={(label, note, color) => void saveSecondaryBookmark(label, note, color)}
            onGoBookmark={(bookmark) => navigateToBookmark(bookmark.label, bookmark.resourceId, bookmark.spine)}
            onDeleteBookmark={(id) => void deleteBookmark(id)}
            onBack={(entry) => navigateToBookmark(entry.label, entry.resourceId, entry.spine)}
            onComplete={() => void completeCurrentUnit()}
          />
        )}

        {returnTarget && readingRibbon && currentLabel() !== readingRibbon.label && (
          <div className="kindle-return-pill">
            <button type="button" onClick={() => navigateToBookmark(returnTarget.label, returnTarget.resourceId, returnTarget.spine)}>
              ↩ Volver a {returnTarget.label}
            </button>
            <button type="button" onClick={goToReadingRibbon}>⇄ Punto de lectura</button>
            <button type="button" onClick={() => setReturnTarget(null)} aria-label="Ocultar">×</button>
          </div>
        )}

        {footnotePreview && (
          <div className="footnote-preview-card" style={{ left: footnotePreview.x, top: footnotePreview.y }}>
            <button type="button" onClick={() => setFootnotePreview(null)} aria-label="Cerrar">×</button>
            <p>{footnotePreview.text}</p>
          </div>
        )}


        {citationInfoTarget && (
          <CitationInfoModal
            resource={citationInfoTarget}
            onClose={() => setCitationInfoTarget(null)}
            onSave={saveCitationInfo}
          />
        )}

        {showSettings && (
        <div className="settings-backdrop" role="dialog" aria-modal="true">
          <section className="settings-panel">
            <header>
              <div>
                <span className="eyebrow">{tr("Aplicación", "Application")}</span>
                <h2>{tr("Configuración", "Settings")}</h2>
              </div>
              <button type="button" className="word-study-close" onClick={() => setShowSettings(false)} aria-label={tr("Cerrar", "Close")}>×</button>
            </header>
            <div className="settings-field">
              <span>{tr("Idioma de la interfaz", "Interface language")}</span>
              <div className="settings-language">
                <button type="button" className={language === "es" ? "active" : ""} onClick={() => {
                  setLanguage("es");
                  localStorage.setItem(LANGUAGE_KEY, "es");
                  window.location.reload();
                }}>Español</button>
                <button type="button" className={language === "en" ? "active" : ""} onClick={() => {
                  setLanguage("en");
                  localStorage.setItem(LANGUAGE_KEY, "en");
                  window.location.reload();
                }}>English</button>
              </div>
            </div>
            <div className="settings-field">
              <span>{tr("Apariencia y tipografía", "Appearance and typography")}</span>
              <button type="button" className="secondary-button" onClick={() => { setShowSettings(false); setShowCustomization(true); }}>
                {tr("Abrir Personalizar", "Open Customize")}
              </button>
            </div>
            <div className="settings-field">
              <span>{tr("Ancho de lectura", "Reading width")}</span>
              <select value={readerWidth} onChange={(event) => setReaderWidth(event.target.value as ReaderWidth)}>
                <option value="compact">{tr("Compacto", "Compact")}</option>
                <option value="normal">{tr("Normal", "Normal")}</option>
                <option value="wide">{tr("Ancho", "Wide")}</option>
                <option value="full">{tr("Completo", "Full")}</option>
              </select>
            </div>
            <div className="settings-field">
              <span>{tr("Estilo de cita", "Citation style")}</span>
              <select
                value={uiCustomization.citationStyle}
                onChange={(event) =>
                  uiCustomization.update({ citationStyle: event.target.value as CitationStyle })
                }
              >
                <option value="apa">APA 7ª ed.</option>
                <option value="sbl">SBL (Bíblico)</option>
                <option value="chicago">Chicago</option>
              </select>
            </div>
            <label className="settings-field settings-check">
              <span>{tr("Anexar cita al copiar libros y comentarios", "Append citation when copying books and commentaries")}</span>
              <input
                type="checkbox"
                checked={uiCustomization.autoCiteOnCopy}
                onChange={(event) => uiCustomization.update({ autoCiteOnCopy: event.target.checked })}
              />
            </label>
            <label className="settings-field settings-check">
              <span>{tr("Incluir ficha de traducción bíblica", "Include Bible translation entry")}</span>
              <input
                type="checkbox"
                checked={uiCustomization.includeTranslationEntry}
                onChange={(event) => uiCustomization.update({ includeTranslationEntry: event.target.checked })}
              />
            </label>
            <div className="settings-field settings-api-field">
              <span>{tr("Proveedor de IA del Asistente", "Assistant AI provider")}</span>
              <select value={assistantProvider} onChange={(event) => setAssistantProvider(event.target.value)}>
                <option value="deepseek">DeepSeek</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai-compatible">OpenAI / Ollama / compatible</option>
                <option value="harvard-local">Motor local (sin API)</option>
              </select>
            </div>
            {assistantProvider !== "harvard-local" && (
              <>
                <label className="settings-field settings-api-field">
                  <span>{tr("API Key", "API Key")}</span>
                  <input
                    type="password"
                    value={assistantApiKey}
                    onChange={(event) => setAssistantApiKey(event.target.value)}
                    placeholder="sk-…"
                  />
                </label>
                <label className="settings-field settings-api-field">
                  <span>{tr("Modelo", "Model")}</span>
                  <input value={assistantModel} onChange={(event) => setAssistantModel(event.target.value)} placeholder="deepseek-chat" />
                </label>
                <button type="button" className="secondary-button settings-api-save" onClick={saveAssistantApi}>
                  {tr("Guardar API del Asistente", "Save Assistant API")}
                </button>
              </>
            )}

            <details className="settings-credits">
              <summary>Créditos y fuentes de datos</summary>
              <p><strong>Texto hebreo (AT):</strong> Biblia Hebraica Stuttgartensia (BHS) / ETCBC & STEPBible TAHOT (Tyndale House, Cambridge) — CC BY 4.0.</p>
              <p><strong>Texto griego (NT):</strong> Tischendorf 8th Edition & STEPBible TAGNT — Dominio público / CC BY 4.0.</p>
              <p><strong>Diccionarios Strong:</strong> Strong's Exhaustive Concordance (CC0), STEPBible TBESH/TBESG (CC BY 4.0) y Strong-PLUS Español.</p>
              <p><strong>Nota textual:</strong> Algunos versículos del NT pueden variar de orden respecto a ediciones tradicionales por el texto crítico de Tischendorf (p. ej., Mateo 5:4 y 5:5).</p>
            </details>
            <p className="settings-note">Minelly 0.2.0 · {tr("Los cambios se guardan en este equipo.", "Changes are saved on this device.")}</p>
          </section>
        </div>
      )}

      {showPbb && (
          <PersonalBookBuilder
            onClose={() => setShowPbb(false)}
            onCatalogChanged={refreshCatalog}
            onOpenCustomization={() => setShowCustomization(true)}
            onOpenResource={(resourceId) => {
              setBookId(resourceId);
              setView("book");
              setShowPbb(false);
              void refreshCatalog();
            }}
          />
        )}

        {showSermons && (
          <SermonWorkspace
            books={books}
            bibles={bibles.map((resource) => ({
              id: resource.id,
              title: resource.title,
              abbreviation: resource.abbreviation,
            }))}
            activeBibleId={bibleId || bibles[0]?.id || ""}
            onClose={() => setShowSermons(false)}
            onOpenCustomization={() => setShowCustomization(true)}
          />
        )}

        {showIndexPrompt && indexStatus && (
          <div className="index-prompt-backdrop" role="dialog" aria-modal="true" aria-labelledby="index-prompt-title">
            <div className="index-prompt-card">
              <span className="eyebrow">Búsqueda instantánea</span>
              <h2 id="index-prompt-title">Indexar tu biblioteca</h2>
              <p>
                Minelly puede crear un índice FTS5 local con el texto limpio de tus
                Biblias, comentarios, diccionarios y libros. Así las búsquedas encuentran
                la palabra exacta en milisegundos, incluso en capítulos completos.
              </p>
              <div className="index-prompt-stats">
                <div>
                  <strong>{indexStatus.pendingResources}</strong>
                  <span>recursos pendientes</span>
                </div>
                <div>
                  <strong>{indexStatus.totalResources}</strong>
                  <span>recursos indexables</span>
                </div>
                <div>
                  <strong>{indexStatus.totalRows.toLocaleString("es")}</strong>
                  <span>fragmentos actuales</span>
                </div>
              </div>
              <div className="index-prompt-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void indexNow()}
                  disabled={indexing}
                >
                  {indexing ? "Indexando…" : "Indexar ahora"}
                </button>
                <button type="button" className="secondary-button" onClick={postponeIndexing}>
                  Más tarde
                </button>
                <button type="button" className="link-button" onClick={neverAskIndexing}>
                  No volver a preguntar
                </button>
              </div>
              <small>
                El índice se guarda en tu catálogo local. No se sube nada a internet y
                puedes posponerlo sin perder ninguna función de lectura.
              </small>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div
            className="delete-resource-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-resource-title"
            onClick={() => {
              if (!deleting) setDeleteTarget(null);
            }}
          >
            <div
              className="delete-resource-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="delete-resource-icon">
                <Icon name="trash" />
              </div>
              <span className="eyebrow">Biblioteca</span>
              <h2 id="delete-resource-title">
                {deleteTarget.kind === "book" ? "Eliminar libro" : "Eliminar recurso"}
              </h2>
              <p>
                ¿Eliminar <strong>«{deleteTarget.title}»</strong> de la biblioteca?
                Se borrarán sus datos locales y su entrada del índice. Esta acción
                no se puede deshacer.
              </p>
              <div className="delete-resource-meta">
                <span>{KIND_LABEL[deleteTarget.kind]}</span>
                <span>{deleteTarget.abbreviation || deleteTarget.sourceFormat}</span>
                <span>{deleteTarget.language || "—"}</span>
              </div>
              {deleteTarget.cloudSynced && (
                <div className="delete-resource-warning">
                  Este libro está sincronizado y es inmutable; no se puede eliminar.
                </div>
              )}
              <div className="delete-resource-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void confirmDeleteResource()}
                  disabled={deleting || deleteTarget.cloudSynced}
                >
                  {deleting ? "Eliminando…" : "Eliminar definitivamente"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showCustomization && (
          <CustomizationModal
            onClose={() => setShowCustomization(false)}
            readerFont={readerFont}
            onReaderFontChange={setReaderFont}
            fontScale={fontScale}
            onFontScaleChange={setFontScale}
            studyFont={studyFont}
            onStudyFontChange={setStudyFont}
            studyFontScale={studyFontScale}
            onStudyFontScaleChange={setStudyFontScale}
            theme={theme}
            onThemeChange={(next) => setTheme(next as Theme)}
            fontOptions={FONT_OPTIONS}
          />
        )}
      </main>
    </div>
  );
}

export default App;
