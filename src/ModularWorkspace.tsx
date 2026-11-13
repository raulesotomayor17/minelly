import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent as ReactUIEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { bibleAnchor, osisForBook, parseAnchor } from "./anchors";
import { PaperModePicker } from "./CustomizationModal";
import EreaderWorkspace from "./EreaderWorkspace";
import StudyAssistant from "./StudyAssistant";
import NotesWorkspace from "./NotesWorkspace";
import CanvasModuleMenu from "./CanvasModuleMenu";
import SermonWorkspace from "./SermonWorkspace";
import { processBookChapterHtml } from "./bookProcessor";
import InterlinearVerse, { type InterlinearVerseData } from "./InterlinearVerse";

export type PaneType =
  | "bible"
  | "compare"
  | "interlinear"
  | "commentary"
  | "dictionary"
  | "book"
  | "notes"
  | "search"
  | "ereader"
  | "assistant"
  | "sermons";
type LinkSet = "A" | "B" | "C" | "D" | "E" | "F" | "none";
type SplitDirection = "horizontal" | "vertical";

export interface Resource {
  id: string;
  kind: string;
  title: string;
  abbreviation: string;
  language: string;
  sourceFormat?: string;
  verseCount?: number;
  entryCount?: number;
}

export interface BookInfo {
  number: number;
  name: string;
  abbreviation: string;
}

export interface Reference {
  book: number;
  chapter: number;
  verse: number;
}

interface Verse {
  book: number;
  chapter: number;
  verse: number;
  html: string;
}

interface Passage {
  book: BookInfo;
  chapter: number;
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
  html: string;
}

interface ModAnchoredNote {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: number;
  anchors: { anchorUri: string; exactText: string }[];
}

interface ModSearchHit {
  resourceId: string;
  resourceTitle: string;
  kind: string;
  book: number;
  chapter: number;
  verse: number;
  label: string;
  snippet: string;
}

export interface PaneState {
  resourceId: string | null;
  reference: Reference;
  topic?: string;
  spine?: number;
  compareIds?: string[];
  showDiff?: boolean;
  searchQuery?: string;
  fontScale?: number;
  appearance?: "inherit" | "light" | "dark" | "sepia" | "contrast";
}

interface PaneTab {
  id: string;
  resourceType: PaneType;
  resourceId: string | null;
}

export interface PaneNode {
  type: "pane";
  id: string;
  resourceType: PaneType;
  linkSet: LinkSet;
  state: PaneState;
  tabs?: PaneTab[];
  activeTabId?: string;
}

interface LinkSyncEvent {
  sourcePaneId: string;
  linkSet: LinkSet;
  reference: Reference;
  canonicalBook: string;
  triggerType: "explicit_navigation" | "user_scroll";
}

interface SplitNode {
  type: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  children: [LayoutNode, LayoutNode];
}

type LayoutNode = PaneNode | SplitNode;

interface FloatingWindow {
  id: string;
  pane: PaneNode;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

interface LayoutProfile {
  id: string;
  name: string;
  createdAt: number;
  tree: LayoutNode;
  floating?: FloatingWindow[];
  readerFont?: string;
  studyFont?: string;
  readerScale?: number;
  studyScale?: number;
}

interface ModularWorkspaceProps {
  resources: Resource[];
  books: BookInfo[];
  initialReference: Reference;
  initialPreset?: string;
  initialBookId?: string;
  initialBookSpine?: number;
  readerFont: string;
  studyFont: string;
  readerScale: number;
  studyScale: number;
  onOpenCustomization?: () => void;
  onOpenModule?: (module: "compare" | "ereader" | "assistant" | "notes" | "sermons") => void;
  onExit: () => void;
}

const LAYOUT_KEY = "teoamoxtli.modular-layouts.v1";
const FONT_OPTIONS = [
  { value: "Literata", label: "Literata" },
  { value: "Crimson Pro", label: "Crimson Pro" },
  { value: "Cormorant Garamond", label: "Cormorant" },
  { value: "Libre Baskerville", label: "Baskerville" },
  { value: "Georgia", label: "Georgia" },
  { value: "Inter", label: "Inter" },
];

export const TYPE_LABEL: Record<PaneType, string> = {
  bible: "Biblia",
  compare: "Comparador",
  interlinear: "Interlineal",
  commentary: "Comentario",
  dictionary: "Diccionario",
  book: "Libro",
  notes: "Notas",
  search: "Buscador",
  ereader: "eReader",
  assistant: "Asistente",
  sermons: "Sermones",
};

function nextId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function loadProfiles(): LayoutProfile[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function firstResource(resources: Resource[], kind: PaneType) {
  if (kind === "compare") {
    return resources.find((resource) => resource.kind === "bible")?.id ?? "";
  }
  return resources.find((resource) => resource.kind === kind)?.id ?? "";
}

function defaultCompareIds(resources: Resource[], baseId: string): string[] {
  return resources
    .filter((r) => r.kind === "bible" && r.id !== baseId)
    .slice(0, 3)
    .map((r) => r.id);
}

export function makePane(
  resourceType: PaneType,
  resources: Resource[],
  reference: Reference,
  linkSet: LinkSet,
  autoSelect = true,
): PaneNode {
  const baseId = autoSelect ? firstResource(resources, resourceType) : null;
  const tabId = nextId();
  return {
    type: "pane",
    id: nextId(),
    resourceType,
    linkSet,
    tabs: [{ id: tabId, resourceType, resourceId: baseId }],
    activeTabId: tabId,
    state: {
      resourceId: baseId,
      reference: { ...reference },
      spine: 0,
      compareIds:
        resourceType === "compare"
          ? defaultCompareIds(resources, baseId ?? "")
          : undefined,
      showDiff: resourceType === "compare" ? true : undefined,
    },
  };
}

function buildPresetTree(
  preset: string | undefined,
  resources: Resource[],
  reference: Reference,
): LayoutNode {
  const bibles = resources.filter((r) => r.kind === "bible");
  const bible = (idx = 0) => {
    const p = makePane("bible", resources, reference, "A");
    if (bibles[idx]) {
      p.state.resourceId = bibles[idx].id;
      p.tabs = [{ ...p.tabs![0], resourceId: bibles[idx].id }];
    }
    return p;
  };
  const comparePane = () => makePane("compare", resources, reference, "A");
  const interlinearPane = () => makePane("interlinear", resources, reference, "A");
  const commentary = () => makePane("commentary", resources, reference, "A");
  const dictionary = () => makePane("dictionary", resources, reference, "none");
  const book = () => makePane("book", resources, reference, "A");

  if (preset === "bible") {
    return bible(0);
  }
  if (preset === "bible-commentary") {
    return {
      type: "split",
      id: nextId(),
      direction: "horizontal",
      ratio: 0.62,
      children: [bible(0), commentary()],
    };
  }
  if (preset === "compare") {
    return {
      type: "split",
      id: nextId(),
      direction: "horizontal",
      ratio: 0.66,
      children: [
        {
          type: "split",
          id: nextId(),
          direction: "horizontal",
          ratio: 0.5,
          children: [bible(0), bible(1)],
        },
        commentary(),
      ],
    };
  }
  if (preset === "avanzado-compare") {
    return {
      type: "split",
      id: nextId(),
      direction: "horizontal",
      ratio: 0.68,
      children: [
        {
          type: "split",
          id: nextId(),
          direction: "vertical",
          ratio: 0.46,
          children: [bible(0), comparePane()],
        },
        commentary(),
      ],
    };
  }
  if (preset === "avanzado-original") {
    return {
      type: "split",
      id: nextId(),
      direction: "horizontal",
      ratio: 0.56,
      children: [
        {
          type: "split",
          id: nextId(),
          direction: "vertical",
          ratio: 0.46,
          children: [bible(0), interlinearPane()],
        },
        {
          type: "split",
          id: nextId(),
          direction: "vertical",
          ratio: 0.56,
          children: [commentary(), dictionary()],
        },
      ],
    };
  }
  if (preset === "seminary") {
    return {
      type: "split",
      id: nextId(),
      direction: "horizontal",
      ratio: 0.45,
      children: [
        bible(0),
        {
          type: "split",
          id: nextId(),
          direction: "vertical",
          ratio: 0.58,
          children: [book(), commentary()],
        },
      ],
    };
  }
  if (preset === "grid4") {
    return {
      type: "split",
      id: nextId(),
      direction: "horizontal",
      ratio: 0.52,
      children: [
        {
          type: "split",
          id: nextId(),
          direction: "vertical",
          ratio: 0.58,
          children: [bible(0), commentary()],
        },
        {
          type: "split",
          id: nextId(),
          direction: "vertical",
          ratio: 0.58,
          children: [book(), dictionary()],
        },
      ],
    };
  }
  return defaultTree(resources, reference);
}

function defaultTree(resources: Resource[], reference: Reference): LayoutNode {
  const bible = makePane("bible", resources, reference, "A");
  const commentary = makePane("commentary", resources, reference, "A");
  const dictionary = makePane("dictionary", resources, reference, "none");
  return {
    type: "split",
    id: nextId(),
    direction: "horizontal",
    ratio: 0.62,
    children: [
      bible,
      {
        type: "split",
        id: nextId(),
        direction: "vertical",
        ratio: 0.55,
        children: [commentary, dictionary],
      },
    ],
  };
}

function findPane(node: LayoutNode, id: string): PaneNode | null {
  if (node.type === "pane") return node.id === id ? node : null;
  return findPane(node.children[0], id) ?? findPane(node.children[1], id);
}

function mapPanes(node: LayoutNode, fn: (pane: PaneNode) => PaneNode): LayoutNode {
  if (node.type === "pane") return fn(node);
  return {
    ...node,
    children: [mapPanes(node.children[0], fn), mapPanes(node.children[1], fn)],
  };
}

function updatePane(
  node: LayoutNode,
  id: string,
  fn: (pane: PaneNode) => PaneNode,
): LayoutNode {
  return mapPanes(node, (pane) => (pane.id === id ? fn(pane) : pane));
}

function splitPane(
  node: LayoutNode,
  paneId: string,
  direction: SplitDirection,
  newType: PaneType,
  resources: Resource[],
): LayoutNode {
  if (node.type === "pane") {
    if (node.id !== paneId) return node;
    const newPane = makePane(
      newType,
      resources,
      node.state.reference,
      newType === "bible" || newType === "commentary" ? node.linkSet : "none",
    );
    return {
      type: "split",
      id: nextId(),
      direction,
      ratio: 0.5,
      children: [node, newPane],
    };
  }
  return {
    ...node,
    children: [
      splitPane(node.children[0], paneId, direction, newType, resources),
      splitPane(node.children[1], paneId, direction, newType, resources),
    ],
  };
}

function closePane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === "pane") return node.id === paneId ? null : node;
  const left = closePane(node.children[0], paneId);
  const right = closePane(node.children[1], paneId);
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

function collectPaneIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [node.id];
  return [...collectPaneIds(node.children[0]), ...collectPaneIds(node.children[1])];
}

function swapWithNext(node: LayoutNode, paneId: string): LayoutNode {
  const ids = collectPaneIds(node);
  const index = ids.indexOf(paneId);
  if (index < 0 || index >= ids.length - 1) return node;
  const next = ids[index + 1];
  const first = findPane(node, paneId);
  const second = findPane(node, next);
  if (!first || !second) return node;
  return mapPanes(node, (pane) => {
    if (pane.id === first.id) return { ...second, id: first.id };
    if (pane.id === second.id) return { ...first, id: second.id };
    return pane;
  });
}

function collectPanes(node: LayoutNode): PaneNode[] {
  if (node.type === "pane") return [node];
  return [...collectPanes(node.children[0]), ...collectPanes(node.children[1])];
}

function paneTabs(pane: PaneNode): PaneTab[] {
  if (pane.tabs && pane.tabs.length > 0) return pane.tabs;
  return [
    {
      id: pane.activeTabId ?? `${pane.id}-tab`,
      resourceType: pane.resourceType,
      resourceId: pane.state.resourceId,
    },
  ];
}

function activeTabId(pane: PaneNode): string {
  return pane.activeTabId ?? paneTabs(pane)[0].id;
}

function resizeSplit(
  node: LayoutNode,
  splitId: string,
  ratio: number,
): LayoutNode {
  if (node.type === "pane") return node;
  if (node.id === splitId) return { ...node, ratio };
  return {
    ...node,
    children: [
      resizeSplit(node.children[0], splitId, ratio),
      resizeSplit(node.children[1], splitId, ratio),
    ],
  };
}

function nextType(type: PaneType): PaneType {
  if (type === "bible") return "commentary";
  if (type === "commentary") return "dictionary";
  if (type === "dictionary") return "bible";
  return "commentary";
}

function bookName(books: BookInfo[], number: number) {
  return books.find((book) => book.number === number)?.name ?? `Libro ${number}`;
}

function SplitView({
  node,
  onResize,
  children,
}: {
  node: SplitNode;
  onResize: (splitId: string, ratio: number) => void;
  children: (node: LayoutNode) => ReactNode;
}) {
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const splitElement = event.currentTarget.parentElement;
    const rect = splitElement?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const move = (moveEvent: PointerEvent) => {
      const raw =
        node.direction === "horizontal"
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height;
      onResize(node.id, Math.min(0.82, Math.max(0.18, raw)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className={`mod-split ${node.direction}`} data-split-id={node.id}>
      <div
        className="mod-child"
        style={{ flexBasis: `${node.ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}
      >
        {children(node.children[0])}
      </div>
      <div
        className="mod-divider"
        role="separator"
        aria-orientation={node.direction === "horizontal" ? "vertical" : "horizontal"}
        onPointerDown={startDrag}
      />
      <div className="mod-child grow">{children(node.children[1])}</div>
    </div>
  );
}

function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function renderModDiff(baseHtml: string, targetHtml: string, showDiff: boolean) {
  const targetPlain = stripHtmlToPlain(targetHtml);
  if (!showDiff) {
    return <span>{targetPlain}</span>;
  }
  const baseWords = new Set(
    stripHtmlToPlain(baseHtml)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter(Boolean),
  );
  const tokens = targetPlain.split(/(\s+)/);
  return (
    <>
      {tokens.map((tok, idx) => {
        const clean = tok.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        if (!clean || baseWords.has(clean)) {
          return <span key={idx}>{tok}</span>;
        }
        return (
          <mark key={idx} className="mod-compare-diff">
            {tok}
          </mark>
        );
      })}
    </>
  );
}

function EmptyResourcePicker({
  type,
  resources,
  onSelect,
}: {
  type: PaneType;
  resources: Resource[];
  onSelect: (resourceId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(
    () =>
      resources.filter(
        (resource) =>
          resource.kind === type &&
          (!query.trim() ||
            `${resource.title} ${resource.abbreviation} ${resource.language}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())),
      ),
    [resources, type, query],
  );
  const label =
    type === "bible"
      ? "Biblia"
      : type === "commentary"
        ? "comentario"
        : type === "dictionary"
          ? "diccionario"
          : "libro";
  return (
    <div className="mod-empty-picker">
      <div className="mod-empty-picker-head">
        <span className="eyebrow">Panel sin recurso</span>
        <h3>Selecciona un {label} para abrir</h3>
        <p>
          Elige un recurso de tu biblioteca. El panel quedará vinculado a él y
          podrás cambiarlo luego desde el selector superior.
        </p>
      </div>
      <label className="mod-empty-search">
        <span>⌕</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Buscar ${label} por título, idioma o formato…`}
          autoFocus
        />
      </label>
      <div className="mod-empty-list">
        {options.map((resource) => (
          <button
            type="button"
            key={resource.id}
            className="mod-empty-item"
            onClick={() => onSelect(resource.id)}
          >
            <span className={`mod-empty-item-kind ${resource.kind}`}>
              {resource.kind === "book" ? "LIBRO" : resource.kind.toUpperCase()}
            </span>
            <strong>{resource.title}</strong>
            <small>
              {resource.abbreviation || resource.sourceFormat} ·{" "}
              {resource.language || "—"} ·{" "}
              {resource.kind === "bible"
                ? `${(resource.verseCount ?? 0).toLocaleString("es")} versículos`
                : `${(resource.entryCount ?? 0).toLocaleString("es")} entradas`}
            </small>
          </button>
        ))}
        {options.length === 0 && (
          <p className="mod-empty-none">
            No hay recursos de tipo «{label}» que coincidan con la búsqueda.
          </p>
        )}
      </div>
    </div>
  );
}

export function PaneView({
  pane,
  canClose,
  resources,
  books,
  readerFont,
  readerScale,
  studyFont,
  studyScale,
  onReference,
  onResource,
  onType,
  onLink,
  onPaneState,
  onSplit,
  onClose,
  onSwap,
  onAddTab,
  onSwitchTab,
  onCloseTab,
  onDragStart,
  onOpenStrong,
  floating = false,
  canFloat = false,
  programmatic = false,
  onFloat,
  onDock,
}: {
  pane: PaneNode;
  canClose: boolean;
  resources: Resource[];
  books: BookInfo[];
  readerFont: string;
  readerScale: number;
  studyFont: string;
  studyScale: number;
  onReference: (
    paneId: string,
    reference: Reference,
    triggerType?: "explicit_navigation" | "user_scroll",
  ) => void;
  onResource: (paneId: string, resourceId: string) => void;
  onType: (paneId: string, type: PaneType) => void;
  onLink: (paneId: string, linkSet: LinkSet) => void;
  onPaneState: (paneId: string, patch: Partial<PaneState>) => void;
  onSplit: (paneId: string, direction: SplitDirection) => void;
  onClose: (paneId: string) => void;
  onSwap: (paneId: string) => void;
  onAddTab: (paneId: string, resourceId: string, resourceType: PaneType) => void;
  onSwitchTab: (paneId: string, tabId: string) => void;
  onCloseTab: (paneId: string, tabId: string) => void;
  onDragStart: (paneId: string, event: ReactPointerEvent<HTMLElement>) => void;
  onOpenStrong?: (strong: string) => void;
  floating?: boolean;
  canFloat?: boolean;
  programmatic?: boolean;
  onFloat?: (paneId: string) => void;
  onDock?: (paneId: string, side: "left" | "right") => void;
}) {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [comparePassages, setComparePassages] = useState<Record<string, Passage>>({});
  const [interlinearVerses, setInterlinearVerses] = useState<InterlinearVerseData[]>([]);
  const [commentaries, setCommentaries] = useState<CommentaryEntry[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState(pane.state.topic ?? "");
  const [dictionaryEntry, setDictionaryEntry] = useState<DictionaryEntry | null>(null);
  const [chapters, setChapters] = useState<EpubChapterSummary[]>([]);
  const [chapter, setChapter] = useState<EpubChapter | null>(null);
  const [modNotes, setModNotes] = useState<ModAnchoredNote[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [searchInput, setSearchInput] = useState(pane.state.searchQuery ?? "");
  const [searchHits, setSearchHits] = useState<ModSearchHit[]>([]);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [compareVersionsOpen, setCompareVersionsOpen] = useState(false);
  const [paneContextMenu, setPaneContextMenu] = useState<{ x: number; y: number; text: string; verse: number } | null>(null);
  useEffect(() => {
    if (!paneContextMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPaneContextMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paneContextMenu]);
  const [paneScale, setPaneScale] = useState(1);
  const [showTopics, setShowTopics] = useState(true);
  const [showRecentTopics, setShowRecentTopics] = useState(false);
  const [recentTopics, setRecentTopics] = useState<string[]>([]);
  const dictionaryInputRef = useRef<HTMLInputElement>(null);
  const bookChapterRef = useRef<HTMLSelectElement>(null);
  const bookOutlineRef = useRef<HTMLSelectElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const pendingBookAnchorRef = useRef<string | null>(null);
  const suppressScrollRef = useRef(false);
  const scrollTimerRef = useRef<number | null>(null);

  const bibles = useMemo(
    () => resources.filter((resource) => resource.kind === "bible"),
    [resources],
  );

  const resourceOptions = useMemo(() => {
    if (pane.resourceType === "compare") {
      return bibles;
    }
    if (
      pane.resourceType === "interlinear" ||
      pane.resourceType === "notes" ||
      pane.resourceType === "search" ||
      pane.resourceType === "ereader" ||
      pane.resourceType === "assistant" ||
      pane.resourceType === "sermons"
    ) {
      return [];
    }
    return resources.filter((resource) => resource.kind === pane.resourceType);
  }, [resources, bibles, pane.resourceType]);

  const needsResourcePicker =
    (pane.resourceType === "bible" ||
      pane.resourceType === "commentary" ||
      pane.resourceType === "dictionary" ||
      pane.resourceType === "book") &&
    !pane.state.resourceId;

  useEffect(() => {
    const nextTopic = pane.state.topic ?? "";
    setTopic(nextTopic);
    if (
      pane.resourceType === "dictionary" &&
      nextTopic.trim() &&
      pane.state.resourceId
    ) {
      void invoke<DictionaryEntry | null>("lookup_dictionary", {
        resourceId: pane.state.resourceId,
        topic: nextTopic.trim(),
      })
        .then(setDictionaryEntry)
        .catch((value) => setError(String(value)));
    }
  }, [pane.state.topic, pane.resourceType, pane.state.resourceId]);

  useEffect(() => {
    if (pane.resourceType !== "bible" || !pane.state.resourceId) return;
    let cancelled = false;
    setLoading(true);
    invoke<Passage>("get_passage", {
      resourceId: pane.state.resourceId,
      book: pane.state.reference.book,
      chapter: pane.state.reference.chapter,
    })
      .then((value) => !cancelled && setPassage(value))
      .catch((value) => !cancelled && setError(String(value)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [
    pane.resourceType,
    pane.state.resourceId,
    pane.state.reference.book,
    pane.state.reference.chapter,
  ]);

  const activeCompareIds = useMemo(() => {
    const baseId = pane.state.resourceId || bibles[0]?.id || "";
    const extra =
      pane.state.compareIds ??
      defaultCompareIds(resources, baseId);
    return [baseId, ...extra.filter((id) => id !== baseId)].filter(Boolean);
  }, [pane.state.resourceId, pane.state.compareIds, bibles, resources]);

  useEffect(() => {
    if (pane.resourceType !== "compare" || activeCompareIds.length === 0) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(
      activeCompareIds.map(async (id) => {
        const p = await invoke<Passage>("get_passage", {
          resourceId: id,
          book: pane.state.reference.book,
          chapter: pane.state.reference.chapter,
        });
        return [id, p] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        const map: Record<string, Passage> = {};
        for (const [id, p] of entries) {
          map[id] = p;
        }
        setComparePassages(map);
      })
      .catch((value) => !cancelled && setError(String(value)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [
    pane.resourceType,
    activeCompareIds,
    pane.state.reference.book,
    pane.state.reference.chapter,
  ]);

  useEffect(() => {
    if (pane.resourceType !== "interlinear") return;
    let cancelled = false;
    setLoading(true);
    invoke<InterlinearVerseData[]>("get_interlinear_chapter", {
      book: pane.state.reference.book,
      chapter: pane.state.reference.chapter,
    })
      .then((value) => !cancelled && setInterlinearVerses(value))
      .catch((value) => !cancelled && setError(String(value)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [
    pane.resourceType,
    pane.state.reference.book,
    pane.state.reference.chapter,
  ]);

  useEffect(() => {
    if (pane.resourceType !== "notes") return;
    let cancelled = false;
    setLoading(true);
    invoke<{ notes: ModAnchoredNote[] }>("annotations_for_prefix", {
      prefix: `bible:${osisForBook(pane.state.reference.book)}:${pane.state.reference.chapter}:`,
    })
      .then((bundle) => !cancelled && setModNotes(bundle.notes ?? []))
      .catch((value) => !cancelled && setError(String(value)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [
    pane.resourceType,
    pane.state.reference.book,
    pane.state.reference.chapter,
    pane.state.reference.verse,
  ]);

  useEffect(() => {
    if (pane.resourceType !== "commentary" || !pane.state.resourceId) return;
    let cancelled = false;
    setLoading(true);
    invoke<CommentaryEntry[]>("get_commentaries", {
      resourceId: pane.state.resourceId,
      book: pane.state.reference.book,
      chapter: pane.state.reference.chapter,
      verse: pane.state.reference.verse,
    })
      .then((value) => !cancelled && setCommentaries(value))
      .catch((value) => !cancelled && setError(String(value)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pane.resourceType, pane.state.resourceId, pane.state.reference]);

  useEffect(() => {
    if (pane.resourceType !== "dictionary" || !pane.state.resourceId) return;
    invoke<string[]>("dictionary_topics", {
      resourceId: pane.state.resourceId,
      limit: 40,
    })
      .then(setTopics)
      .catch((value) => setError(String(value)));
  }, [pane.resourceType, pane.state.resourceId]);

  useEffect(() => {
    if (pane.resourceType !== "book" || !pane.state.resourceId) return;
    invoke<EpubChapterSummary[]>("epub_chapters", {
      resourceId: pane.state.resourceId,
    })
      .then((value) => {
        setChapters(value);
        if (value.length > 0 && pane.state.spine === undefined) {
          onPaneState(pane.id, { spine: value[0].spine });
        }
      })
      .catch((value) => setError(String(value)));
  }, [pane.resourceType, pane.state.resourceId, pane.state.spine, pane.id]);

  useEffect(() => {
    if (pane.resourceType !== "book" || !pane.state.resourceId) return;
    invoke<EpubChapter | null>("get_epub_chapter", {
      resourceId: pane.state.resourceId,
      spine: pane.state.spine ?? 0,
    })
      .then((loaded) => {
        setChapter(loaded);
        if (pendingBookAnchorRef.current) {
          const anchorId = pendingBookAnchorRef.current;
          pendingBookAnchorRef.current = null;
          window.setTimeout(() => {
            const el = bodyRef.current?.querySelector<HTMLElement>(
              `#${CSS.escape(anchorId)}`,
            );
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 80);
        }
      })
      .catch((value) => setError(String(value)));
  }, [pane.resourceType, pane.state.resourceId, pane.state.spine]);

  const reference = pane.state.reference;
  const referenceLabel = `${bookName(books, reference.book)} ${reference.chapter}:${reference.verse}`;

  useEffect(() => {
    if (
      !programmatic ||
      (pane.resourceType !== "bible" &&
        pane.resourceType !== "compare" &&
        pane.resourceType !== "interlinear")
    ) {
      return;
    }
    const container = bodyRef.current;
    const selector =
      pane.resourceType === "interlinear"
        ? `[data-interlinear-verse="${pane.state.reference.verse}"]`
        : `[data-chapter="${pane.state.reference.chapter}"][data-verse="${pane.state.reference.verse}"]`;
    const target = container?.querySelector<HTMLElement>(selector);
    if (!target) return;
    suppressScrollRef.current = true;
    target.scrollIntoView({ block: "center" });
    const timer = window.setTimeout(() => {
      suppressScrollRef.current = false;
    }, 320);
    return () => window.clearTimeout(timer);
  }, [
    programmatic,
    pane.resourceType,
    pane.state.reference.chapter,
    pane.state.reference.verse,
    passage,
    comparePassages,
    interlinearVerses,
  ]);

  useEffect(
    () => () => {
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    },
    [],
  );

  function handleBodyScroll(event: ReactUIEvent<HTMLDivElement>) {
    if (pane.resourceType !== "bible" || programmatic || suppressScrollRef.current) {
      return;
    }
    const container = event.currentTarget;
    const threshold = container.getBoundingClientRect().top + 8;
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(".mod-verse"),
    );
    const current = rows.find(
      (row) => row.getBoundingClientRect().bottom > threshold,
    );
    if (!current) return;
    const chapter = Number(current.dataset.chapter);
    const verse = Number(current.dataset.verse);
    if (!chapter || !verse) return;
    if (
      chapter === pane.state.reference.chapter &&
      verse === pane.state.reference.verse
    ) {
      return;
    }
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      onReference(
        pane.id,
        {
          ...pane.state.reference,
          chapter,
          verse,
        },
        "user_scroll",
      );
    }, 140);
  }

  async function lookupDictionary() {
    if (!topic.trim() || !pane.state.resourceId) return;
    try {
      const entry = await invoke<DictionaryEntry | null>("lookup_dictionary", {
        resourceId: pane.state.resourceId,
        topic: topic.trim(),
      });
      setDictionaryEntry(entry);
      setRecentTopics((current) => [
        topic.trim(),
        ...current.filter((item) => item !== topic.trim()),
      ].slice(0, 8));
      onPaneState(pane.id, { topic: topic.trim() });
    } catch (value) {
      setError(String(value));
    }
  }

  void modNotes;
  void saveModNote;

  async function deletePaneHighlights() {
    if (!paneContextMenu) return;
    try {
      const prefix = `bible:${osisForBook(reference.book)}:${reference.chapter}:`;
      const bundle = await invoke<{ highlights: Array<{ id: string; anchorUri: string }> }>("annotations_for_prefix", { prefix });
      const anchor = bibleAnchor(reference.book, reference.chapter, paneContextMenu.verse);
      const matches = (bundle.highlights ?? []).filter((item) => item.anchorUri.startsWith(anchor));
      for (const item of matches) await invoke("highlight_delete", { id: item.id });
      setPaneContextMenu(null);
    } catch (value) { setError(String(value)); }
  }

  function copyPaneReference(withText: boolean) {
    if (!paneContextMenu) return;
    const label = `${bookName(books, reference.book)} ${reference.chapter}:${paneContextMenu.verse}`;
    void navigator.clipboard.writeText(withText ? `${label} — «${paneContextMenu.text}»` : label);
    setPaneContextMenu(null);
  }

  async function savePaneHighlight(styleId: string) {
    if (!paneContextMenu) return;
    try {
      await invoke("highlight_create", {
        anchorUri: bibleAnchor(reference.book, reference.chapter, paneContextMenu.verse),
        exactText: paneContextMenu.text,
        styleId,
        startOffset: 0,
        endOffset: 0,
      });
      setPaneContextMenu(null);
    } catch (value) { setError(String(value)); }
  }

  async function savePaneNote() {
    if (!paneContextMenu) return;
    const body = window.prompt("Nota sobre este versículo", "");
    if (!body?.trim()) return;
    try {
      await invoke("note_upsert", { input: {
        id: null,
        title: body.slice(0, 80),
        contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] }),
        plainText: body,
        anchors: [{ anchorUri: bibleAnchor(reference.book, reference.chapter, paneContextMenu.verse), exactText: paneContextMenu.text, startOffset: 0, endOffset: 0 }],
        tagIds: [],
      }});
      setPaneContextMenu(null);
    } catch (value) { setError(String(value)); }
  }

  async function saveModNote() {
    if (!noteTitle.trim() && !noteBody.trim()) return;
    const anchorUri = bibleAnchor(reference.book, reference.chapter, reference.verse);
    const doc = {
      type: "doc",
      content: (noteBody.trim() || noteTitle.trim())
        .split(/\n+/)
        .map((line) => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : [],
        })),
    };
    try {
      await invoke("note_upsert", {
        input: {
          id: null,
          title: noteTitle.trim() || `Nota en ${referenceLabel}`,
          contentJson: JSON.stringify(doc),
          plainText: noteBody.trim(),
          anchors: [
            {
              anchorUri,
              exactText: referenceLabel,
              startOffset: 0,
              endOffset: 0,
            },
          ],
          tagIds: [],
        },
      });
      setNoteTitle("");
      setNoteBody("");
      const bundle = await invoke<{ notes: ModAnchoredNote[] }>(
        "annotations_for_prefix",
        {
          prefix: `bible:${osisForBook(reference.book)}:${reference.chapter}:`,
        },
      );
      setModNotes(bundle.notes ?? []);
    } catch (err) {
      setError(String(err));
    }
  }

  const tabCatalog = useMemo(() => {
    const entries: Array<{ key: string; type: PaneType; resourceId: string; label: string; hint: string }> = [];
    for (const resource of resources) {
      const type =
        resource.kind === "bible" ||
        resource.kind === "commentary" ||
        resource.kind === "dictionary" ||
        resource.kind === "book"
          ? (resource.kind as PaneType)
          : null;
      if (!type) continue;
      entries.push({
        key: `${type}:${resource.id}`,
        type,
        resourceId: resource.id,
        label: resource.title,
        hint: TYPE_LABEL[type],
      });
    }
    for (const type of ["interlinear", "compare", "notes", "search"] as PaneType[]) {
      entries.push({
        key: `tool:${type}`,
        type,
        resourceId: "",
        label: TYPE_LABEL[type],
        hint: "Herramienta",
      });
    }
    return entries;
  }, [resources]);

  async function runModSearch() {
    if (!searchInput.trim()) return;
    setLoading(true);
    try {
      const hits = await invoke<ModSearchHit[]>("search", {
        query: searchInput.trim(),
        limit: 45,
      });
      setSearchHits(hits);
      onPaneState(pane.id, { searchQuery: searchInput.trim() });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`mod-pane pane-appearance-${pane.state.appearance ?? "inherit"}`}
      style={{ "--pane-scale": pane.state.fontScale ?? 1 } as CSSProperties}
    >
      <div className="mod-pane-tabs">
        <button
          type="button"
          className="mod-pane-drag"
          onPointerDown={(event) => onDragStart(pane.id, event)}
          title="Arrastrar panel libremente"
          aria-label="Arrastrar panel libremente"
        >
          ⠿
        </button>
        <div className="mod-pane-tab-list" role="tablist" aria-label="Pestañas del panel">
          {paneTabs(pane).map((tab) => {
            const tabResource = resources.find((resource) => resource.id === tab.resourceId);
            const isActive = tab.id === activeTabId(pane);
            return (
              <button
                type="button"
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                className={isActive ? "mod-pane-tab active" : "mod-pane-tab"}
                onClick={() => onSwitchTab(pane.id, tab.id)}
                title={tabResource?.title ?? TYPE_LABEL[tab.resourceType]}
              >
                <span>{tabResource?.abbreviation || tabResource?.title || TYPE_LABEL[tab.resourceType]}</span>
                {paneTabs(pane).length > 1 && (
                  <span
                    className="mod-tab-close"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseTab(pane.id, tab.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                        onCloseTab(pane.id, tab.id);
                      }
                    }}
                    title="Cerrar pestaña"
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mod-pane-tab-add-wrap">
          <button
            type="button"
            className={tabMenuOpen ? "mod-pane-tab-add active" : "mod-pane-tab-add"}
            onClick={() => setTabMenuOpen((current) => !current)}
            title="Añadir pestaña con otro recurso"
            aria-expanded={tabMenuOpen}
          >
            +
          </button>
          {tabMenuOpen && (
            <div className="mod-tab-menu">
              <strong>Nueva pestaña</strong>
              {tabCatalog.map((entry) => (
                <button
                  type="button"
                  key={entry.key}
                  onClick={() => {
                    onAddTab(pane.id, entry.resourceId, entry.type);
                    setTabMenuOpen(false);
                  }}
                >
                  <span>{entry.label}</span>
                  <small>{entry.hint}</small>
                </button>
              ))}
              {tabCatalog.length === 0 && <small>No hay recursos disponibles.</small>}
            </div>
          )}
        </div>
      </div>
      <div className="mod-pane-header">
        <select
          className="mod-type-select"
          value={pane.resourceType}
          onChange={(event) => onType(pane.id, event.target.value as PaneType)}
          aria-label="Tipo de panel"
        >
          {Object.entries(TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="mod-pane-display" role="group" aria-label="Visualización del panel">
          <button
            type="button"
            onClick={() => onPaneState(pane.id, { fontScale: Math.max(0.75, (pane.state.fontScale ?? 1) - 0.1) })}
            title="Reducir letra del panel"
          >
            A−
          </button>
          <button
            type="button"
            onClick={() => onPaneState(pane.id, { fontScale: Math.min(1.8, (pane.state.fontScale ?? 1) + 0.1) })}
            title="Aumentar letra del panel"
          >
            A+
          </button>
          <select
            value={pane.state.appearance ?? "inherit"}
            onChange={(event) => onPaneState(pane.id, { appearance: event.target.value as PaneState["appearance"] })}
            aria-label="Aspecto del panel"
            title="Aspecto visual del panel"
          >
            <option value="inherit">Tema</option>
            <option value="light">Claro</option>
            <option value="sepia">Sepia</option>
            <option value="dark">Oscuro</option>
            <option value="contrast">Contraste</option>
          </select>
        </div>
        {resourceOptions.length > 0 ? (
          <select
            className="mod-resource-select"
            value={pane.state.resourceId ?? ""}
            onChange={(event) => {
              const nextIdVal = event.target.value;
              if (pane.resourceType === "compare") {
                const prevBase = pane.state.resourceId;
                const currentExtras =
                  pane.state.compareIds ??
                  defaultCompareIds(resources, prevBase ?? "");
                const nextExtras = currentExtras.includes(nextIdVal)
                  ? currentExtras.map((id) => (id === nextIdVal ? prevBase ?? "" : id))
                  : currentExtras;
                onPaneState(pane.id, {
                  resourceId: nextIdVal,
                  compareIds: nextExtras.filter((id) => id && id !== nextIdVal),
                });
              } else {
                onResource(pane.id, nextIdVal);
              }
            }}
            aria-label="Recurso del panel"
            title={
              pane.resourceType === "compare"
                ? "Seleccionar Biblia Base del Comparador"
                : "Seleccionar recurso"
            }
          >
            {!pane.state.resourceId && (
              <option value="" disabled>
                Selecciona un recurso…
              </option>
            )}
            {resourceOptions.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {pane.resourceType === "compare"
                  ? `★ Base: ${resource.title}`
                  : resource.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="mod-resource-badge">
            {pane.resourceType === "interlinear"
              ? "STEPBible AT/NT (Heb/Gr)"
              : pane.resourceType === "notes"
                ? `Notas · ${referenceLabel}`
                : "Biblioteca completa"}
          </span>
        )}
        <select
          className="mod-link-select"
          value={pane.linkSet}
          onChange={(event) => onLink(pane.id, event.target.value as LinkSet)}
          disabled={pane.resourceType === "dictionary"}
          aria-label="Grupo de enlace"
          title="Grupo de enlace (A–F): sincroniza pasajes entre Biblia, Comparador, Interlineal, Comentario, Notas y Libros"
        >
          {(["A", "B", "C", "D", "E", "F"] as LinkSet[]).map((set) => (
            <option key={set} value={set}>
              {set}
            </option>
          ))}
          <option value="none">—</option>
        </select>
        {floating ? (
          <>
            <button
              className="mod-icon"
              onClick={() => onDock?.(pane.id, "left")}
              title="Acoplar a la izquierda"
              aria-label="Acoplar a la izquierda"
            >
              ⇤
            </button>
            <button
              className="mod-icon"
              onClick={() => onDock?.(pane.id, "right")}
              title="Acoplar a la derecha"
              aria-label="Acoplar a la derecha"
            >
              ⇥
            </button>
          </>
        ) : (
          <>
            <button
              className="mod-icon"
              onClick={() => onFloat?.(pane.id)}
              disabled={!canFloat}
              title={
                canFloat
                  ? "Sacar a ventana flotante"
                  : "Deja al menos un panel acoplado"
              }
              aria-label="Sacar a ventana flotante"
            >
              ⧉
            </button>
            <button
              className="mod-icon"
              onClick={() => onSplit(pane.id, "horizontal")}
              title="Dividir horizontalmente"
              aria-label="Dividir horizontalmente"
            >
              ⇔
            </button>
            <button
              className="mod-icon"
              onClick={() => onSplit(pane.id, "vertical")}
              title="Dividir verticalmente"
              aria-label="Dividir verticalmente"
            >
              ⇕
            </button>
            <button
              className="mod-icon"
              onClick={() => onSwap(pane.id)}
              title="Intercambiar con el siguiente panel"
              aria-label="Intercambiar con el siguiente panel"
            >
              ⇄
            </button>
          </>
        )}
        <button
          className="mod-icon"
          onClick={() => onClose(pane.id)}
          disabled={!canClose}
          title={floating ? "Cerrar ventana flotante" : "Cerrar panel"}
          aria-label={floating ? "Cerrar ventana flotante" : "Cerrar panel"}
        >
          ×
        </button>
      </div>

      {!needsResourcePicker && (pane.resourceType === "commentary" ||
        pane.resourceType === "dictionary" ||
        pane.resourceType === "book") && (
        <div className="mod-special-toolbar" role="toolbar" aria-label={`Herramientas de ${TYPE_LABEL[pane.resourceType]}`}>
          <span className="mod-special-label">{TYPE_LABEL[pane.resourceType]}</span>
          <button
            type="button"
            onClick={() => bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          >
            Inicio
          </button>
          {pane.resourceType === "dictionary" && (
            <>
              <button type="button" onClick={() => dictionaryInputRef.current?.focus()}>
                Buscar
              </button>
              <button
                type="button"
                className={showTopics ? "active" : ""}
                onClick={() => setShowTopics((current) => !current)}
              >
                Temas
              </button>
              <button
                type="button"
                className={showRecentTopics ? "active" : ""}
                onClick={() => setShowRecentTopics((current) => !current)}
              >
                Recientes
              </button>
            </>
          )}
          {pane.resourceType === "book" && (
            <>
              <button type="button" onClick={() => bookChapterRef.current?.focus()}>
                Capítulos
              </button>
              <button type="button" onClick={() => bookOutlineRef.current?.focus()}>
                Contenido
              </button>
            </>
          )}
          {pane.resourceType === "commentary" && (
            <button
              type="button"
              onClick={() => {
                const text = bodyRef.current?.innerText ?? "";
                if (text.trim()) void writeText(text);
              }}
            >
              Copiar
            </button>
          )}
          <span className="mod-special-spacer" />
          <button
            type="button"
            onClick={() => setPaneScale((current) => Math.max(0.8, current - 0.08))}
            title="Disminuir texto del panel"
          >
            A−
          </button>
          <button
            type="button"
            onClick={() => setPaneScale((current) => Math.min(1.6, current + 0.08))}
            title="Aumentar texto del panel"
          >
            A+
          </button>
        </div>
      )}
      {pane.resourceType === "dictionary" && showRecentTopics && recentTopics.length > 0 && (
        <div className="mod-recent-topics">
          {recentTopics.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => {
                setTopic(item);
                onPaneState(pane.id, { topic: item });
                void invoke<DictionaryEntry | null>("lookup_dictionary", {
                  resourceId: pane.state.resourceId,
                  topic: item,
                })
                  .then(setDictionaryEntry)
                  .catch((value) => setError(String(value)));
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      <div
        className="mod-pane-body"
        ref={bodyRef}
        onScroll={pane.resourceType === "bible" ? handleBodyScroll : undefined}
        onClick={(event) => {
          const rawTarget = event.target as HTMLElement | null;
          const tocLink = rawTarget?.closest<HTMLAnchorElement>(
            "a.book-toc-link, a[data-toc-anchor], a[href^='#']",
          );
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
              if (!Number.isNaN(targetSpine) && targetSpine !== (pane.state.spine ?? 0)) {
                pendingBookAnchorRef.current = rawAnchor || null;
                onPaneState(pane.id, { spine: targetSpine });
                return;
              }
            }
            if (rawAnchor) {
              const el = bodyRef.current?.querySelector<HTMLElement>(
                `#${CSS.escape(rawAnchor)}`,
              );
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                return;
              }
            }
            return;
          }

          const target = rawTarget?.closest<HTMLAnchorElement>("a.scripture-ref-link");
          if (!target) return;
          event.preventDefault();
          const b = Number(target.dataset.book);
          const c = Number(target.dataset.chapter);
          const v = Number(target.dataset.verse) || 1;
          if (b && c) {
            onReference(pane.id, { book: b, chapter: c, verse: v }, "explicit_navigation");
          }
        }}
        style={
          {
            "--reader-font": `"${readerFont}", Georgia, serif`,
            "--reader-font-size": `${16.5 * readerScale}px`,
            "--study-font": `"${studyFont}", Georgia, serif`,
            "--study-font-size": `${13 * studyScale * (pane.state.fontScale ?? paneScale)}px`,
            zoom: "var(--pane-scale)",
          } as CSSProperties
        }
      >
        {error && <p className="mod-error">{error}</p>}

        {needsResourcePicker && (
          <EmptyResourcePicker
            type={pane.resourceType}
            resources={resourceOptions}
            onSelect={(resourceId) => onResource(pane.id, resourceId)}
          />
        )}

        {!needsResourcePicker && pane.resourceType === "assistant" && (
          <StudyAssistant
            embedded
            onClose={() => undefined}
            onOpenContext={(context) => onReference(
              pane.id,
              { book: context.book || 1, chapter: context.chapter || 1, verse: context.verse || 1 },
              "explicit_navigation",
            )}
          />
        )}

        {!needsResourcePicker && pane.resourceType === "sermons" && (
          <SermonWorkspace
            books={books}
            bibles={resources.filter((resource) => resource.kind === "bible").map((resource) => ({ id: resource.id, title: resource.title, abbreviation: resource.abbreviation }))}
            activeBibleId={resources.find((resource) => resource.kind === "bible")?.id ?? ""}
            onClose={() => undefined}
            onOpenCustomization={() => undefined}
          />
        )}

        {!needsResourcePicker && pane.resourceType === "ereader" && (
          <EreaderWorkspace
            embedded
            resources={resources}
            onClose={() => undefined}
            onOpenScripture={(refBook, refChapter, refVerse) =>
              onReference(pane.id, { book: refBook, chapter: refChapter, verse: refVerse }, "explicit_navigation")
            }
          />
        )}

        {!needsResourcePicker && pane.resourceType === "bible" && (
          <>
            <div className="mod-passage-controls">
              <select
                value={reference.book}
                onChange={(event) =>
                  onReference(pane.id, {
                    book: Number(event.target.value),
                    chapter: 1,
                    verse: 1,
                  })
                }
                aria-label="Libro bíblico"
              >
                {books.map((book) => (
                  <option key={book.number} value={book.number}>
                    {book.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={reference.chapter}
                onChange={(event) =>
                  onReference(pane.id, {
                    ...reference,
                    chapter: Math.max(1, Number(event.target.value) || 1),
                    verse: 1,
                  })
                }
                aria-label="Capítulo"
              />
              <select
                value={reference.verse}
                onChange={(event) =>
                  onReference(pane.id, {
                    ...reference,
                    verse: Number(event.target.value),
                  })
                }
                aria-label="Versículo"
              >
                {(passage?.verses ?? []).map((verse) => (
                  <option key={verse.verse} value={verse.verse}>
                    {verse.verse}
                  </option>
                ))}
              </select>
            </div>
            <div className="mod-verses">
              {loading && <p className="mod-muted">Cargando…</p>}
              {(passage?.verses ?? []).map((verse) => (
                <div
                  key={verse.verse}
                  data-chapter={verse.chapter}
                  data-verse={verse.verse}
                  className={
                    verse.verse === reference.verse ? "mod-verse active" : "mod-verse"
                  }
                  onClick={() =>
                    onReference(pane.id, {
                      ...reference,
                      verse: verse.verse,
                    })
                  }
                >
                  <span className="mod-verse-number">{verse.verse}</span>
                  <div
                    className="mod-verse-text"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      const selected = window.getSelection()?.toString().trim();
                      setPaneContextMenu({
                        x: Math.min(window.innerWidth - 230, event.clientX),
                        y: Math.min(window.innerHeight - 220, event.clientY),
                        text: selected || (event.currentTarget.textContent ?? "").trim(),
                        verse: verse.verse,
                      });
                    }}
                    dangerouslySetInnerHTML={{ __html: verse.html }}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {pane.resourceType === "compare" && (
          <>
            <div className="mod-passage-controls">
              <select
                value={reference.book}
                onChange={(event) =>
                  onReference(pane.id, {
                    book: Number(event.target.value),
                    chapter: 1,
                    verse: 1,
                  })
                }
                aria-label="Libro bíblico"
              >
                {books.map((book) => (
                  <option key={book.number} value={book.number}>
                    {book.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={reference.chapter}
                onChange={(event) =>
                  onReference(pane.id, {
                    ...reference,
                    chapter: Math.max(1, Number(event.target.value) || 1),
                    verse: 1,
                  })
                }
                aria-label="Capítulo"
              />
              <button
                type="button"
                className={
                  pane.state.showDiff !== false
                    ? "mod-diff-toggle active"
                    : "mod-diff-toggle"
                }
                onClick={() =>
                  onPaneState(pane.id, {
                    showDiff: pane.state.showDiff === false,
                  })
                }
                title="Resaltar diferencias léxicas frente a la Biblia Base"
              >
                Δ Diferencias
              </button>
            </div>
            <div className="mod-compare-picker">
              <button type="button" className="mod-compare-picker-toggle" onClick={() => setCompareVersionsOpen((value) => !value)}>
                {compareVersionsOpen ? "▾" : "▸"} Versiones comparadas ({activeCompareIds.length + 1})
              </button>
              {compareVersionsOpen && (
                <>
            <label className="mod-compare-base-select">
              <span>Biblia preferida / base</span>
              <select
                value={pane.state.resourceId ?? bibles[0]?.id ?? ""}
                onChange={(event) => onResource(pane.id, event.target.value)}
              >
                {bibles.map((bible) => (
                  <option key={bible.id} value={bible.id}>{bible.abbreviation || bible.title}</option>
                ))}
              </select>
            </label>
            <div className="mod-compare-version-pills">
              {bibles.map((b) => {
                const isBase = b.id === (pane.state.resourceId || bibles[0]?.id);
                const isSelected = activeCompareIds.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={
                      isBase
                        ? "mod-version-pill base"
                        : isSelected
                          ? "mod-version-pill active"
                          : "mod-version-pill"
                    }
                    onClick={() => {
                      if (isBase) return;
                      const currentExtras =
                        pane.state.compareIds ??
                        defaultCompareIds(resources, pane.state.resourceId ?? "");
                      const nextExtras = isSelected
                        ? currentExtras.filter((id) => id !== b.id)
                        : [...currentExtras, b.id];
                      onPaneState(pane.id, { compareIds: nextExtras });
                    }}
                    title={
                      isBase
                        ? `${b.title} (Biblia Base)`
                        : isSelected
                          ? `Ocultar ${b.title}`
                          : `Añadir ${b.title} a la comparación`
                    }
                  >
                    {isBase ? `★ ${b.abbreviation || b.title}` : b.abbreviation || b.title}
                  </button>
                );
              })}
            </div>
                </>
              )}
            </div>
            {loading && <p className="mod-muted">Cargando comparación…</p>}
            {(() => {
              const baseId = activeCompareIds[0];
              const basePassage = baseId ? comparePassages[baseId] : undefined;
              const versesList = basePassage?.verses ?? [];
              return (
                <div className="mod-compare-table-wrap">
                  <table className="mod-compare-table">
                    <thead>
                      <tr>
                        <th>V.</th>
                        {activeCompareIds.map((id, idx) => {
                          const res = bibles.find((b) => b.id === id);
                          return (
                            <th key={id}>
                              {idx === 0 ? "★ " : ""}
                              {res?.abbreviation || res?.title || id}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {versesList.map((baseVerse) => (
                        <tr
                          key={baseVerse.verse}
                          data-chapter={baseVerse.chapter}
                          data-verse={baseVerse.verse}
                          className={
                            baseVerse.verse === reference.verse
                              ? "mod-compare-row active"
                              : "mod-compare-row"
                          }
                          onClick={() =>
                            onReference(pane.id, {
                              ...reference,
                              verse: baseVerse.verse,
                            })
                          }
                        >
                          <td className="mod-compare-vnum">{baseVerse.verse}</td>
                          {activeCompareIds.map((id, idx) => {
                            const vObj = comparePassages[id]?.verses.find(
                              (v) => v.verse === baseVerse.verse,
                            );
                            if (!vObj) {
                              return <td key={id} className="mod-muted">—</td>;
                            }
                            return (
                              <td key={id} className="mod-compare-cell">
                                {idx === 0
                                  ? stripHtmlToPlain(vObj.html)
                                  : renderModDiff(
                                      baseVerse.html,
                                      vObj.html,
                                      pane.state.showDiff !== false,
                                    )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </>
        )}

        {pane.resourceType === "interlinear" && (
          <>
            <div className="mod-passage-controls">
              <select
                value={reference.book}
                onChange={(event) =>
                  onReference(pane.id, {
                    book: Number(event.target.value),
                    chapter: 1,
                    verse: 1,
                  })
                }
                aria-label="Libro bíblico"
              >
                {books.map((book) => (
                  <option key={book.number} value={book.number}>
                    {book.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={reference.chapter}
                onChange={(event) =>
                  onReference(pane.id, {
                    ...reference,
                    chapter: Math.max(1, Number(event.target.value) || 1),
                    verse: 1,
                  })
                }
                aria-label="Capítulo"
              />
              <span className="mod-reference">{referenceLabel}</span>
            </div>
            {loading && <p className="mod-muted">Cargando interlineal Hebreo/Griego…</p>}
            <div className="mod-interlinear-list">
              {interlinearVerses.map((vData) => (
                <div
                  key={vData.verse}
                  className={
                    vData.verse === reference.verse
                      ? "mod-interlinear-item active"
                      : "mod-interlinear-item"
                  }
                  onClick={() =>
                    onReference(pane.id, {
                      ...reference,
                      verse: vData.verse,
                    })
                  }
                >
                  <InterlinearVerse
                    verse={vData.verse}
                    tokens={vData.tokens}
                    onStrong={(strong) => onOpenStrong?.(strong)}
                  />
                </div>
              ))}
              {!loading && interlinearVerses.length === 0 && (
                <p className="mod-muted">
                  Sin datos interlineales para este capítulo.
                </p>
              )}
            </div>
          </>
        )}

        {!needsResourcePicker && pane.resourceType === "commentary" && (
          <>
            <div className="mod-reference">{referenceLabel}</div>
            {loading && <p className="mod-muted">Cargando…</p>}
            {commentaries.map((entry, index) => (
              <article className="mod-commentary" key={index}>
                {entry.chapterStart > 0 && (
                  <div className="mod-entry-range">
                    {entry.chapterStart}:{entry.verseStart}
                    {entry.chapterEnd !== entry.chapterStart ||
                    entry.verseEnd !== entry.verseStart
                      ? `–${entry.chapterEnd}:${entry.verseEnd}`
                      : ""}
                  </div>
                )}
                <div
                  className="mod-rich-text"
                  dangerouslySetInnerHTML={{
                    __html: processBookChapterHtml(entry.html).html,
                  }}
                />
              </article>
            ))}
            {!loading && commentaries.length === 0 && (
              <p className="mod-muted">Sin comentario para esta referencia.</p>
            )}
          </>
        )}

        {!needsResourcePicker && pane.resourceType === "dictionary" && (
          <>
            <form
              className="mod-dictionary-search"
              onSubmit={(event) => {
                event.preventDefault();
                void lookupDictionary();
              }}
            >
              <input
                ref={dictionaryInputRef}
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="Buscar tema o código Strong (ej. H430, G3056)…"
                aria-label="Tema del diccionario"
              />
              <button type="submit">Ir</button>
            </form>
            {showTopics && (
            <div className="mod-topic-chips">
              {topics.slice(0, 18).map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setTopic(item);
                    onPaneState(pane.id, { topic: item });
                    void invoke<DictionaryEntry | null>("lookup_dictionary", {
                      resourceId: pane.state.resourceId,
                      topic: item,
                    })
                      .then(setDictionaryEntry)
                      .catch((value) => setError(String(value)));
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            )}
            {dictionaryEntry && (
              <article className="mod-commentary">
                <h3>{dictionaryEntry.topic}</h3>
                <div
                  className="mod-rich-text"
                  dangerouslySetInnerHTML={{ __html: dictionaryEntry.html }}
                />
              </article>
            )}
          </>
        )}

        {!needsResourcePicker && pane.resourceType === "book" && (
          <>
            {chapter ? (
              (() => {
                const processed = processBookChapterHtml(chapter.html);
                return (
                  <>
                    <div className="mod-book-nav-row">
                      <select
                        ref={bookChapterRef}
                        className="mod-book-select"
                        value={pane.state.spine ?? 0}
                        onChange={(event) =>
                          onPaneState(pane.id, { spine: Number(event.target.value) })
                        }
                        aria-label="Capítulo del libro"
                      >
                        {chapters.map((item, index) => (
                          <option key={item.spine} value={item.spine}>
                            {index + 1}. {item.title}
                          </option>
                        ))}
                      </select>
                      {processed.outline.length > 0 && (
                        <select
                          ref={bookOutlineRef}
                          className="mod-book-select mod-book-outline-select"
                          defaultValue=""
                          onChange={(event) => {
                            const selectedIdx = Number(event.target.value);
                            event.target.value = "";
                            const item = processed.outline[selectedIdx];
                            if (!item) return;
                            if (
                              item.tocSpine !== undefined &&
                              item.tocSpine !== (pane.state.spine ?? 0)
                            ) {
                              pendingBookAnchorRef.current = item.tocAnchor || item.id;
                              onPaneState(pane.id, { spine: item.tocSpine });
                              return;
                            }
                            const targetId = item.tocAnchor || item.id;
                            const el = bodyRef.current?.querySelector<HTMLElement>(
                              `#${CSS.escape(targetId)}`,
                            );
                            el?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          aria-label="Saltar a sección del capítulo"
                        >
                          <option value="">
                            Secciones ({processed.outline.length})…
                          </option>
                          {processed.outline.map((sec, idx) => (
                            <option key={sec.id} value={idx}>
                              {"\u00A0".repeat(Math.max(0, sec.level - 1) * 2)}
                              {sec.text}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {processed.scriptureRefs.length > 0 && (
                      <div className="mod-book-refs-bar">
                        <span className="mod-book-refs-label">
                          {processed.scriptureRefs.length} citas bíblicas conectadas:
                        </span>
                        <div className="mod-book-refs-chips">
                          {processed.scriptureRefs.slice(0, 12).map((refItem) => (
                            <button
                              key={refItem.id}
                              type="button"
                              className="mod-book-ref-chip"
                              onClick={() =>
                                onReference(
                                  pane.id,
                                  {
                                    book: refItem.book,
                                    chapter: refItem.chapter,
                                    verse: refItem.verse,
                                  },
                                  "explicit_navigation",
                                )
                              }
                              title={`Sincronizar paneles enlazados a ${refItem.label}`}
                            >
                              {refItem.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div
                      className="mod-epub-content book-typeset-surface"
                      dangerouslySetInnerHTML={{ __html: processed.html }}
                    />
                  </>
                );
              })()
            ) : (
              <p className="mod-muted">Cargando libro…</p>
            )}
          </>
        )}

        {pane.resourceType === "notes" && (
          <NotesWorkspace
            key={`${reference.book}:${reference.chapter}:${reference.verse}`}
            books={books}
            initialAnchor={{
              anchorUri: bibleAnchor(reference.book, reference.chapter, reference.verse),
              exactText: referenceLabel,
              startOffset: 0,
              endOffset: 0,
              label: referenceLabel,
            }}
            onClose={() => undefined}
            onOpenAnchor={(anchorUri) => {
              const parsed = parseAnchor(anchorUri);
              if (parsed?.kind === "bible") onReference(pane.id, { book: parsed.book, chapter: parsed.chapter, verse: parsed.verse }, "explicit_navigation");
            }}
            onChanged={() => undefined}
          />
        )}

        {pane.resourceType === "search" && (
          <div className="mod-search-pane">
            <form
              className="mod-dictionary-search"
              onSubmit={(event) => {
                event.preventDefault();
                void runModSearch();
              }}
            >
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Buscar palabra o frase en toda la biblioteca…"
                aria-label="Consulta de búsqueda"
              />
              <button type="submit">Buscar</button>
            </form>
            {loading && <p className="mod-muted">Buscando en la biblioteca…</p>}
            <div className="mod-search-results">
              {searchHits.map((hit, idx) => (
                <button
                  key={`${hit.resourceId}-${hit.book}-${hit.chapter}-${hit.verse}-${idx}`}
                  type="button"
                  className="mod-search-hit"
                  onClick={() => {
                    if (hit.book >= 1 && hit.book <= 66) {
                      onReference(
                        pane.id,
                        {
                          book: hit.book,
                          chapter: hit.chapter || 1,
                          verse: hit.verse || 1,
                        },
                        "explicit_navigation",
                      );
                    }
                  }}
                >
                  <div className="mod-search-hit-head">
                    <strong>{hit.label}</strong>
                    <span>{hit.resourceTitle}</span>
                  </div>
                  <div
                    className="mod-search-hit-snippet"
                    dangerouslySetInnerHTML={{ __html: hit.snippet }}
                  />
                </button>
              ))}
              {!loading && searchHits.length === 0 && (
                <p className="mod-muted">
                  Escribe una consulta para buscar y haz clic en cualquier resultado para sincronizar los paneles del grupo {pane.linkSet}.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      {paneContextMenu && (
        <div className="mod-verse-context-menu" style={{ left: paneContextMenu.x, top: paneContextMenu.y }}>
          <strong>Referencia {reference.book}:{reference.chapter}:{paneContextMenu.verse}</strong>
          <button type="button" onClick={() => { void navigator.clipboard.writeText(paneContextMenu.text); setPaneContextMenu(null); }}>Copiar texto</button>
          <button type="button" onClick={() => copyPaneReference(false)}>Copiar referencia</button>
          <button type="button" onClick={() => copyPaneReference(true)}>Copiar referencia + texto</button>
          <div className="mod-context-colors">
            {["yellow", "green", "blue", "pink", "orange"].map((color) => (
              <button key={color} type="button" className={`mod-context-color ${color}`} onClick={() => void savePaneHighlight(color)} aria-label={`Resaltar ${color}`} />
            ))}
          </div>
          <button type="button" onClick={() => void deletePaneHighlights()}>Quitar resaltado</button>
          <button type="button" onClick={() => void savePaneNote()}>Crear nota</button>
        </div>
      )}
    </div>
  );
}

export default function ModularWorkspace({
  resources,
  books,
  initialReference,
  initialPreset,
  initialBookId,
  initialBookSpine,
  readerFont,
  studyFont,
  readerScale,
  studyScale,
  onOpenCustomization,
  onExit,
}: ModularWorkspaceProps) {
  const [tree, setTree] = useState<LayoutNode>(() => {
    const base = buildPresetTree(
      initialBookId ? "seminary" : initialPreset,
      resources,
      initialReference,
    );
    if (!initialBookId) return base;
    return mapPanes(base, (pane) =>
      pane.resourceType === "book"
        ? {
            ...pane,
            state: {
              ...pane.state,
              resourceId: initialBookId,
              spine: initialBookSpine ?? 0,
            },
            tabs: pane.tabs?.map((tab) => ({
              ...tab,
              resourceId: initialBookId,
            })),
          }
        : pane,
    );
  });
  const [floating, setFloating] = useState<FloatingWindow[]>([]);
  const [nextZ, setNextZ] = useState(10);
  const [addType, setAddType] = useState<PaneType>("compare");
  const [programmaticPanes, setProgrammaticPanes] = useState<Set<string>>(
    () => new Set(),
  );
  const syncTimerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [profiles, setProfiles] = useState<LayoutProfile[]>(loadProfiles);
  const [profileName, setProfileName] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [localReaderFont, setLocalReaderFont] = useState(readerFont);
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);
  useEffect(() => {
    if (!moduleMenuOpen) return;
    const onModuleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModuleMenuOpen(false);
    };
    window.addEventListener("keydown", onModuleKey);
    return () => window.removeEventListener("keydown", onModuleKey);
  }, [moduleMenuOpen]);
  const [localStudyFont, setLocalStudyFont] = useState(studyFont);
  const [localReaderScale, setLocalReaderScale] = useState(readerScale);
  const [localStudyScale, setLocalStudyScale] = useState(studyScale);
  const [status, setStatus] = useState("");
  const [maximizedFloating, setMaximizedFloating] = useState<string | null>(null);
  const floatingRestoreRef = useRef<Map<string, { x: number; y: number; width: number; height: number }>>(new Map());
  const [dragPane, setDragPane] = useState<{
    id: string;
    title: string;
    x: number;
    y: number;
    dropSide: "left" | "right" | "top" | "bottom" | null;
  } | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    moved: boolean;
    dropSide: "left" | "right" | "top" | "bottom" | null;
  } | null>(null);

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(profiles));
  }, [profiles]);

  useEffect(
    () => () => {
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    },
    [],
  );

  const dockedPanes = collectPanes(tree);
  const activePanes = [...dockedPanes, ...floating.map((window) => window.pane)];

  function allPaneValues() {
    return [...collectPanes(tree), ...floating.map((window) => window.pane)];
  }

  function applyPaneChange(paneId: string, updater: (pane: PaneNode) => PaneNode) {
    setTree((current) => updatePane(current, paneId, updater));
    setFloating((current) =>
      current.map((window) =>
        window.pane.id === paneId
          ? { ...window, pane: updater(window.pane) }
          : window,
      ),
    );
  }

  function handleOpenStrongInWorkspace(strong: string) {
    const dictPane = allPaneValues().find((p) => p.resourceType === "dictionary");
    if (dictPane) {
      applyPaneChange(dictPane.id, (pane) => ({
        ...pane,
        state: { ...pane.state, topic: strong },
      }));
      setStatus(`Código Strong ${strong} enviado al panel de Diccionario.`);
    } else {
      const reference = allPaneValues()[0]?.state.reference ?? initialReference;
      const newDict = makePane("dictionary", resources, reference, "none");
      newDict.state.topic = strong;
      setTree((current) => insertDocked(current, newDict, "right"));
      setStatus(`Panel de Diccionario abierto en ${strong}.`);
    }
  }

  function updateReference(
    paneId: string,
    reference: Reference,
    triggerType: "explicit_navigation" | "user_scroll" = "explicit_navigation",
  ) {
    const target = allPaneValues().find((pane) => pane.id === paneId);
    if (!target) return;
    const event: LinkSyncEvent = {
      sourcePaneId: paneId,
      linkSet: target.linkSet,
      reference,
      canonicalBook: osisForBook(reference.book),
      triggerType,
    };
    dispatchLinkEvent(event);
  }

  function dispatchLinkEvent(event: LinkSyncEvent) {
    const sourcePane = allPaneValues().find((p) => p.id === event.sourcePaneId);
    const effectiveLinkSet =
      event.linkSet === "none" && sourcePane?.resourceType === "book"
        ? "A"
        : event.linkSet;

    if (effectiveLinkSet === "none") {
      const updater = (pane: PaneNode) =>
        pane.id === event.sourcePaneId
          ? { ...pane, state: { ...pane.state, reference: { ...event.reference } } }
          : pane;
      setTree((current) => mapPanes(current, updater));
      setFloating((current) =>
        current.map((window) => ({ ...window, pane: updater(window.pane) })),
      );
      return;
    }
    const targets = allPaneValues().filter(
      (pane) =>
        pane.id !== event.sourcePaneId && pane.linkSet === effectiveLinkSet,
    );
    const targetIds = new Set(targets.map((pane) => pane.id));
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
    }
    setProgrammaticPanes(targetIds);
    const updater = (pane: PaneNode) => {
      if (pane.id === event.sourcePaneId || targetIds.has(pane.id)) {
        return {
          ...pane,
          state: { ...pane.state, reference: { ...event.reference } },
        };
      }
      return pane;
    };
    setTree((current) => mapPanes(current, updater));
    setFloating((current) =>
      current.map((window) => ({ ...window, pane: updater(window.pane) })),
    );
    syncTimerRef.current = window.setTimeout(() => {
      setProgrammaticPanes(new Set());
      syncTimerRef.current = null;
    }, 500);
  }

  function updateResource(paneId: string, resourceId: string) {
    applyPaneChange(paneId, (pane) => {
      const tabId = activeTabId(pane);
      const tabs = paneTabs(pane).map((tab) =>
        tab.id === tabId ? { ...tab, resourceId } : tab,
      );
      return {
        ...pane,
        tabs,
        activeTabId: tabId,
        state: { ...pane.state, resourceId, spine: 0 },
      };
    });
  }

  function updateType(paneId: string, type: PaneType) {
    const pickerTypes: PaneType[] = ["bible", "commentary", "dictionary", "book"];
    const baseId = pickerTypes.includes(type) ? null : firstResource(resources, type);
    applyPaneChange(paneId, (pane) => {
      const tabId = activeTabId(pane);
      const tabs = paneTabs(pane).map((tab) =>
        tab.id === tabId
          ? { ...tab, resourceType: type, resourceId: baseId }
          : tab,
      );
      return {
        ...pane,
        resourceType: type,
        tabs,
        activeTabId: tabId,
        linkSet: type === "dictionary" ? "none" : pane.linkSet === "none" ? "A" : pane.linkSet,
        state: {
          ...pane.state,
          resourceId: baseId,
          spine: 0,
          compareIds:
            type === "compare"
              ? defaultCompareIds(resources, baseId ?? "")
              : pane.state.compareIds,
          showDiff: type === "compare" ? true : pane.state.showDiff,
        },
      };
    });
  }

  function addTab(paneId: string, resourceId: string, resourceType: PaneType) {
    applyPaneChange(paneId, (pane) => {
      const tabId = nextId();
      const id = resourceId || null;
      const tabs = [
        ...paneTabs(pane),
        { id: tabId, resourceType, resourceId: id },
      ];
      return {
        ...pane,
        tabs,
        activeTabId: tabId,
        resourceType,
        linkSet: resourceType === "dictionary" ? "none" : pane.linkSet,
        state: {
          ...pane.state,
          resourceId: id,
          spine: 0,
          compareIds:
            resourceType === "compare"
              ? defaultCompareIds(resources, id ?? "")
              : pane.state.compareIds,
          showDiff: resourceType === "compare" ? true : pane.state.showDiff,
        },
      };
    });
  }

  function switchTab(paneId: string, tabId: string) {
    applyPaneChange(paneId, (pane) => {
      const currentId = activeTabId(pane);
      const tabs = paneTabs(pane).map((tab) =>
        tab.id === currentId
          ? {
              ...tab,
              resourceType: pane.resourceType,
              resourceId: pane.state.resourceId,
            }
          : tab,
      );
      const target = tabs.find((tab) => tab.id === tabId);
      if (!target) return pane;
      return {
        ...pane,
        tabs,
        activeTabId: tabId,
        resourceType: target.resourceType,
        state: {
          ...pane.state,
          resourceId: target.resourceId,
          spine: 0,
        },
      };
    });
  }

  function closeTab(paneId: string, tabId: string) {
    applyPaneChange(paneId, (pane) => {
      const tabs = paneTabs(pane);
      if (tabs.length <= 1) return pane;
      const index = tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return pane;
      const remaining = tabs.filter((tab) => tab.id !== tabId);
      if (activeTabId(pane) !== tabId) {
        return { ...pane, tabs: remaining };
      }
      const next = remaining[Math.min(index, remaining.length - 1)];
      return {
        ...pane,
        tabs: remaining,
        activeTabId: next.id,
        resourceType: next.resourceType,
        state: { ...pane.state, resourceId: next.resourceId, spine: 0 },
      };
    });
  }

  function updateLink(paneId: string, linkSet: LinkSet) {
    const target = allPaneValues().find((pane) => pane.id === paneId);
    if (!target) return;
    const linkedPane =
      linkSet === "none"
        ? undefined
        : allPaneValues().find(
            (pane) => pane.id !== paneId && pane.linkSet === linkSet,
          );
    const reference = linkedPane?.state.reference ?? target.state.reference;
    const updater = (pane: PaneNode) => {
      if (pane.id === paneId) {
        return {
          ...pane,
          linkSet,
          state: { ...pane.state, reference: { ...reference } },
        };
      }
      if (linkSet !== "none" && pane.linkSet === linkSet) {
        return { ...pane, state: { ...pane.state, reference: { ...reference } } };
      }
      return pane;
    };
    setTree((current) => mapPanes(current, updater));
    setFloating((current) =>
      current.map((window) => ({ ...window, pane: updater(window.pane) })),
    );
  }

  function updateState(paneId: string, patch: Partial<PaneState>) {
    applyPaneChange(paneId, (pane) => ({
      ...pane,
      state: { ...pane.state, ...patch },
    }));
  }

  function dockPaneAt(
    paneId: string,
    side: "left" | "right" | "top" | "bottom",
  ) {
    const floatingPane = floating.find((window) => window.id === paneId);
    const dockedPane = findPane(tree, paneId);
    if (!floatingPane && !dockedPane) return;
    const pane = floatingPane?.pane ?? dockedPane;
    if (!pane) return;
    let remaining: LayoutNode | null = tree;
    if (floatingPane) {
      setFloating((current) => current.filter((window) => window.id !== paneId));
    } else {
      remaining = closePane(tree, paneId);
      if (!remaining) {
        setStatus("Deja al menos un panel acoplado para poder dividir el lienzo.");
        return;
      }
      setTree(remaining);
    }
    if (!remaining) return;
    const direction: SplitDirection =
      side === "left" || side === "right" ? "horizontal" : "vertical";
    const ratio = side === "left" || side === "top" ? 0.4 : 0.6;
    setTree({
      type: "split",
      id: nextId(),
      direction,
      ratio,
      children:
        side === "left" || side === "top"
          ? [pane, remaining]
          : [remaining, pane],
    });
    setStatus(
      `Panel acoplado a ${side === "left" ? "la izquierda" : side === "right" ? "la derecha" : side === "top" ? "arriba" : "abajo"}.`,
    );
  }

  function floatPaneAt(paneId: string, clientX: number, clientY: number) {
    const canvas = canvasRef.current?.getBoundingClientRect();
    const pane = findPane(tree, paneId);
    if (pane) {
      if (dockedPanes.length <= 1) {
        setStatus("Deja al menos un panel acoplado para poder flotar otro.");
        return;
      }
      const nextTree = closePane(tree, paneId);
      if (!nextTree) return;
      const width = Math.min(540, Math.max(340, (canvas?.width ?? 900) * 0.48));
      const height = Math.min(460, Math.max(280, (canvas?.height ?? 600) * 0.6));
      setTree(nextTree);
      setFloating((current) => [
        ...current,
        {
          id: pane.id,
          pane,
          x: Math.max(8, clientX - (canvas?.left ?? 0) - 90),
          y: Math.max(8, clientY - (canvas?.top ?? 0) - 24),
          width,
          height,
          z: nextZ,
        },
      ]);
      setNextZ((current) => current + 1);
      setStatus("Panel convertido en ventana flotante.");
      return;
    }
    const target = floating.find((window) => window.id === paneId);
    if (!target) return;
    setFloating((current) =>
      current.map((window) =>
        window.id === paneId
          ? {
              ...window,
              x: Math.max(0, clientX - (canvas?.left ?? 0) - 90),
              y: Math.max(0, clientY - (canvas?.top ?? 0) - 24),
              z: nextZ,
            }
          : window,
      ),
    );
    setNextZ((current) => current + 1);
  }

  function startPaneDrag(paneId: string, event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const pane = allPaneValues().find((item) => item.id === paneId);
    dragRef.current = {
      id: paneId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      dropSide: null,
    };
    setDragPane({
      id: paneId,
      title: pane
        ? TYPE_LABEL[pane.resourceType]
        : "Panel",
      x: event.clientX,
      y: event.clientY,
      dropSide: null,
    });
    const move = (moveEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (
        Math.abs(moveEvent.clientX - drag.startX) > 5 ||
        Math.abs(moveEvent.clientY - drag.startY) > 5
      ) {
        drag.moved = true;
      }
      const canvas = canvasRef.current?.getBoundingClientRect();
      let dropSide: "left" | "right" | "top" | "bottom" | null = null;
      if (canvas) {
        const edgeX = Math.max(70, canvas.width * 0.14);
        const edgeY = Math.max(55, canvas.height * 0.13);
        if (moveEvent.clientX < canvas.left + edgeX) dropSide = "left";
        else if (moveEvent.clientX > canvas.right - edgeX) dropSide = "right";
        else if (moveEvent.clientY < canvas.top + edgeY) dropSide = "top";
        else if (moveEvent.clientY > canvas.bottom - edgeY) dropSide = "bottom";
      }
      drag.dropSide = dropSide;
      setDragPane((current) =>
        current
          ? {
              ...current,
              x: moveEvent.clientX,
              y: moveEvent.clientY,
              dropSide,
            }
          : current,
      );
    };
    const up = (upEvent: PointerEvent) => {
      const drag = dragRef.current;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragRef.current = null;
      setDragPane(null);
      if (drag?.moved) {
        if (drag.dropSide) {
          dockPaneAt(paneId, drag.dropSide);
        } else {
          floatPaneAt(paneId, upEvent.clientX, upEvent.clientY);
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function floatPane(paneId: string) {
    if (dockedPanes.length <= 1) {
      setStatus("Deja al menos un panel acoplado para poder flotar otro.");
      return;
    }
    const pane = findPane(tree, paneId);
    if (!pane) return;
    const nextTree = closePane(tree, paneId);
    if (!nextTree) return;
    const canvas = canvasRef.current?.getBoundingClientRect();
    const width = Math.min(540, Math.max(340, (canvas?.width ?? 900) * 0.48));
    const height = Math.min(460, Math.max(280, (canvas?.height ?? 600) * 0.6));
    setTree(nextTree);
    setFloating((current) => [
      ...current,
      {
        id: pane.id,
        pane,
        x: 24 + current.length * 20,
        y: 34 + current.length * 18,
        width,
        height,
        z: nextZ,
      },
    ]);
    setNextZ((current) => current + 1);
    setStatus("Panel flotante. Arrástralo desde la barra superior o acóplalo con ⇤/⇥.");
  }

  function closeFloating(paneId: string) {
    setFloating((current) => current.filter((window) => window.id !== paneId));
  }

  function insertDocked(tree: LayoutNode, pane: PaneNode, side: "left" | "right"): LayoutNode {
    return {
      type: "split",
      id: nextId(),
      direction: "horizontal",
      ratio: 0.65,
      children: side === "left" ? [pane, tree] : [tree, pane],
    };
  }

  function dockPane(paneId: string, side: "left" | "right") {
    const target = floating.find((window) => window.id === paneId);
    if (!target) return;
    setTree((current) => insertDocked(current, target.pane, side));
    setFloating((current) => current.filter((window) => window.id !== paneId));
    setStatus("Panel acoplado de nuevo al lienzo.");
  }

  function dockAllFloating() {
    if (floating.length === 0) return;
    let next = tree;
    for (const window of floating) {
      next = insertDocked(next, window.pane, "right");
    }
    setTree(next);
    setFloating([]);
    setStatus("Todas las ventanas flotantes se acoplaron al lienzo.");
  }

  function addPane(mode: "docked" | "floating", paneType: PaneType = addType) {
    const reference =
      allPaneValues()[0]?.state.reference ?? initialReference;
    const pickerTypes: PaneType[] = ["bible", "commentary", "dictionary", "book"];
    const pane = makePane(
      paneType,
      resources,
      reference,
      paneType === "dictionary" ? "none" : "A",
      !pickerTypes.includes(paneType),
    );
    if (mode === "floating") {
      const canvas = canvasRef.current?.getBoundingClientRect();
      setFloating((current) => [
        ...current,
        {
          id: pane.id,
          pane,
          x: 36 + current.length * 22,
          y: 54 + current.length * 20,
          width: Math.min(520, Math.max(340, (canvas?.width ?? 900) * 0.46)),
          height: Math.min(440, Math.max(260, (canvas?.height ?? 600) * 0.56)),
          z: nextZ,
        },
      ]);
      setNextZ((current) => current + 1);
      setStatus(`Panel de ${TYPE_LABEL[addType]} añadido como ventana flotante.`);
    } else {
      setTree((current) => insertDocked(current, pane, "right"));
      setStatus(`Panel de ${TYPE_LABEL[addType]} añadido al lienzo.`);
    }
  }

  function applyLayoutPreset(preset: string) {
    const reference = allPaneValues()[0]?.state.reference ?? initialReference;
    setTree(buildPresetTree(preset, resources, reference));
    setFloating([]);
    const labels: Record<string, string> = {
      bible: "Entorno Integrado: Lectura bíblica focalizada (1 panel).",
      "bible-commentary": "Entorno Integrado: Biblia + Comentario sincronizados (Enlace A).",
      study: "Entorno Integrado: Exégesis (Biblia + Comentario + Diccionario).",
      seminary: "Entorno Integrado: Seminario (Biblia + Libro conectado + Comentario).",
      compare: "Entorno Integrado: Paralelo bíblico (2 Biblias + Comentario).",
      "avanzado-compare":
        "Entorno Comparativo Avanzado: Biblia + Comparador de Versiones + Comentario (Enlace A).",
      "avanzado-original":
        "Entorno de Idiomas Originales Pro: Biblia + Interlineal Hebreo/Griego + Comentario + Diccionario.",
      grid4: "Entorno Integrado: Cuadrícula 2×2 (Biblia + Comentario + Libro + Diccionario).",
    };
    setStatus(labels[preset] ?? "Entorno aplicado.");
  }

  function focusFloating(paneId: string) {
    setFloating((current) =>
      current.map((window) =>
        window.id === paneId ? { ...window, z: nextZ } : window,
      ),
    );
    setNextZ((current) => current + 1);
  }

  function moveFloating(
    event: ReactPointerEvent<HTMLDivElement>,
    paneId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const target = floating.find((window) => window.id === paneId);
    if (!target) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const originalX = target.x;
    const originalY = target.y;
    const move = (moveEvent: PointerEvent) => {
      setMaximizedFloating(null);
      const canvas = canvasRef.current?.getBoundingClientRect();
      const maxX = Math.max(0, (canvas?.width ?? 1200) - target.width - 8);
      const maxY = Math.max(0, (canvas?.height ?? 720) - target.height - 8);
      let nextX = Math.max(0, originalX + moveEvent.clientX - startX);
      let nextY = Math.max(0, originalY + moveEvent.clientY - startY);
      if (nextX < 14) nextX = 0;
      else if (nextX > maxX - 14) nextX = maxX;
      if (nextY < 14) nextY = 0;
      else if (nextY > maxY - 14) nextY = maxY;
      setFloating((current) =>
        current.map((window) =>
          window.id === paneId ? { ...window, x: nextX, y: nextY } : window,
        ),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function resizeFloating(
    event: ReactPointerEvent<HTMLDivElement>,
    paneId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const target = floating.find((window) => window.id === paneId);
    if (!target) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const originalWidth = target.width;
    const originalHeight = target.height;
    const move = (moveEvent: PointerEvent) => {
      setMaximizedFloating(null);
      const canvas = canvasRef.current?.getBoundingClientRect();
      const maxWidth = Math.max(270, (canvas?.width ?? 1200) - target.x - 8);
      const maxHeight = Math.max(210, (canvas?.height ?? 720) - target.y - 8);
      setFloating((current) =>
        current.map((window) =>
          window.id === paneId
            ? {
                ...window,
                width: Math.min(
                  maxWidth,
                  Math.max(270, originalWidth + moveEvent.clientX - startX),
                ),
                height: Math.min(
                  maxHeight,
                  Math.max(210, originalHeight + moveEvent.clientY - startY),
                ),
              }
            : window,
        ),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function toggleFloatingMaximize(paneId: string) {
    const target = floating.find((window) => window.id === paneId);
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!target || !canvas) return;
    if (maximizedFloating === paneId) {
      const restore = floatingRestoreRef.current.get(paneId);
      setFloating((current) =>
        current.map((window) =>
          window.id === paneId && restore ? { ...window, ...restore } : window,
        ),
      );
      setMaximizedFloating(null);
      setStatus("Ventana restaurada.");
      return;
    }
    floatingRestoreRef.current.set(paneId, {
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
    });
    setFloating((current) =>
      current.map((window) =>
        window.id === paneId
          ? {
              ...window,
              x: 4,
              y: 4,
              width: Math.max(320, canvas.width - 8),
              height: Math.max(220, canvas.height - 8),
              z: nextZ,
            }
          : window,
      ),
    );
    setMaximizedFloating(paneId);
    setNextZ((current) => current + 1);
    setStatus("Ventana maximizada dentro del lienzo.");
  }

  function split(paneId: string, direction: SplitDirection) {
    const pane = findPane(tree, paneId);
    if (!pane) return;
    setTree((current) =>
      splitPane(current, paneId, direction, nextType(pane.resourceType), resources),
    );
  }

  function close(paneId: string) {
    setTree((current) => closePane(current, paneId) ?? defaultTree(resources, initialReference));
  }

  function swap(paneId: string) {
    setTree((current) => swapWithNext(current, paneId));
  }

  function resize(splitId: string, ratio: number) {
    setTree((current) => resizeSplit(current, splitId, ratio));
  }

  function saveProfile() {
    const profile: LayoutProfile = {
      id: nextId(),
      name: profileName.trim() || `Diseño ${profiles.length + 1}`,
      createdAt: Date.now(),
      tree,
      floating,
      readerFont: localReaderFont,
      studyFont: localStudyFont,
      readerScale: localReaderScale,
      studyScale: localStudyScale,
    };
    setProfiles((current) => [profile, ...current].slice(0, 30));
    setProfileName("");
    setStatus(`Diseño “${profile.name}” guardado.`);
  }

  function applyProfile(id: string) {
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    setTree(profile.tree);
    setFloating(profile.floating ?? []);
    setNextZ(
      Math.max(
        10,
        ...(profile.floating ?? []).map((window) => window.z + 1),
      ),
    );
    setLocalReaderFont(profile.readerFont ?? localReaderFont);
    setLocalStudyFont(profile.studyFont ?? localStudyFont);
    setLocalReaderScale(profile.readerScale ?? localReaderScale);
    setLocalStudyScale(profile.studyScale ?? localStudyScale);
    setStatus(`Diseño “${profile.name}” cargado.`);
  }

  async function exportLayout() {
    try {
      await writeText(
        JSON.stringify(
          {
            version: 1,
            tree,
            floating,
            profiles,
            readerFont: localReaderFont,
            studyFont: localStudyFont,
          },
          null,
          2,
        ),
      );
      setStatus("Diseño copiado al portapapeles como JSON.");
    } catch (error) {
      setStatus(`No se pudo exportar: ${String(error)}`);
    }
  }

  async function importLayout() {
    try {
      const text = await readText();
      const parsed = JSON.parse(text);
      if (parsed?.tree) {
        setTree(parsed.tree);
        if (Array.isArray(parsed.floating)) {
          setFloating(parsed.floating);
          setNextZ(
            Math.max(
              10,
              ...parsed.floating.map(
                (window: FloatingWindow) => window.z + 1,
              ),
            ),
          );
        }
        if (Array.isArray(parsed.profiles)) setProfiles(parsed.profiles);
        if (typeof parsed.readerFont === "string") setLocalReaderFont(parsed.readerFont);
        if (typeof parsed.studyFont === "string") setLocalStudyFont(parsed.studyFont);
        setStatus("Diseño importado desde el portapapeles.");
      } else {
        setStatus("El JSON no contiene un árbol de diseño válido.");
      }
    } catch (error) {
      setStatus(`No se pudo importar: ${String(error)}`);
    }
  }

  function renderNode(node: LayoutNode): ReactNode {
    if (node.type === "split") {
      return (
        <SplitView node={node} onResize={resize}>
          {(child) => renderNode(child)}
        </SplitView>
      );
    }
    return (
      <PaneView
        pane={node}
        canClose={tree.type === "split"}
        resources={resources}
        books={books}
        readerFont={localReaderFont}
        readerScale={localReaderScale}
        studyFont={localStudyFont}
        studyScale={localStudyScale}
        onReference={updateReference}
        onResource={updateResource}
        onType={updateType}
        onLink={updateLink}
        onPaneState={updateState}
        onSplit={split}
        onClose={close}
        onSwap={swap}
        onAddTab={addTab}
        onSwitchTab={switchTab}
        onCloseTab={closeTab}
        onDragStart={startPaneDrag}
        onOpenStrong={handleOpenStrongInWorkspace}
        canFloat={dockedPanes.length > 1}
        programmatic={programmaticPanes.has(node.id)}
        onFloat={floatPane}
        onDock={dockPane}
      />
    );
  }

  return (
    <div className="modular-overlay">
      <header className="modular-toolbar">
        <div className="modular-title">
          <span className="eyebrow">Lienzo modular</span>
          <strong>Diseño de estudio</strong>
          <span className="modular-count">{activePanes.length} paneles</span>
        </div>

        <div className="modular-controls">
          <label>
            Lectura
            <select
              value={localReaderFont}
              onChange={(event) => setLocalReaderFont(event.target.value)}
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="modular-small"
            onClick={() => setLocalReaderScale((value) => Math.max(0.8, value - 0.06))}
            aria-label="Disminuir fuente de lectura"
          >
            A−
          </button>
          <button
            className="modular-small"
            onClick={() => setLocalReaderScale((value) => Math.min(1.8, value + 0.06))}
            aria-label="Aumentar fuente de lectura"
          >
            A+
          </button>
          <label>
            Estudio
            <select
              value={localStudyFont}
              onChange={(event) => setLocalStudyFont(event.target.value)}
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="modular-small"
            onClick={() => setLocalStudyScale((value) => Math.max(0.8, value - 0.06))}
            aria-label="Disminuir fuente de estudio"
          >
            A−
          </button>
          <button
            className="modular-small"
            onClick={() => setLocalStudyScale((value) => Math.min(2.2, value + 0.06))}
            aria-label="Aumentar fuente de estudio"
          >
            A+
          </button>
          {onOpenCustomization && (
            <button
              type="button"
              className="modular-customize-btn"
              onClick={onOpenCustomization}
              title="Abrir personalización general del sistema y tamaño de menús (Accesibilidad)"
            >
              Aa Personalizar
            </button>
          )}
          <PaperModePicker compact />
          <input
            className="modular-name"
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
            placeholder="Nombre del diseño"
            aria-label="Nombre del diseño"
          />
          <button className="modular-save" onClick={saveProfile}>
            Guardar
          </button>
          <select
            className="modular-profile"
            value={selectedProfile}
            onChange={(event) => {
              setSelectedProfile(event.target.value);
              applyProfile(event.target.value);
            }}
            aria-label="Cargar diseño guardado"
          >
            <option value="">Cargar…</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <button className="modular-small" onClick={() => void exportLayout()}>
            Exportar
          </button>
          <button className="modular-small" onClick={() => void importLayout()}>
            Importar
          </button>
          <div className="modular-module-menu-wrap">
            <button type="button" className="modular-small" onClick={() => setModuleMenuOpen((current) => !current)}>Abrir módulo</button>
            {moduleMenuOpen && (
              <CanvasModuleMenu
                onClose={() => setModuleMenuOpen(false)}
                onSelect={(id) => { setModuleMenuOpen(false); addPane("docked", id as PaneType); }}
              />
            )}
          </div>
          <button className="modular-exit" onClick={onExit}>
            Volver
          </button>
        </div>
      </header>

      <div className="modular-layout-bar">
        <label>
          Entorno rápido
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) applyLayoutPreset(event.target.value);
            }}
          >
            <option value="">Elegir plantilla integrada…</option>
            <option value="avanzado-compare">
              Estudio Comparado Avanzado: Biblia + Comparador de Versiones + Comentario (3)
            </option>
            <option value="avanzado-original">
              Idiomas Originales Pro: Biblia + Interlineal AT/NT + Comentario + Diccionario (4)
            </option>
            <option value="study">Exégesis Integrada: Biblia + Comentario + Diccionario (3)</option>
            <option value="seminary">Seminario Integrado: Biblia + Libro conectado + Comentario (3)</option>
            <option value="grid4">Cuadrícula Multivista 2×2: Biblia + Comentario + Libro + Diccionario (4)</option>
            <option value="bible-commentary">Estudio Clásico: Biblia + Comentario (2)</option>
            <option value="compare">Paralelo: 2 Biblias + Comentario (3)</option>
            <option value="bible">Lectura limpia: Solo Biblia (1)</option>
          </select>
        </label>
        <span className="modular-layout-divider" />
        <label>
          Añadir herramienta / panel
          <select
            value={addType}
            onChange={(event) => setAddType(event.target.value as PaneType)}
          >
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="modular-small" onClick={() => addPane("docked")}>
          + Acoplado
        </button>
        <button className="modular-small" onClick={() => addPane("floating")}>
          + Flotante
        </button>
        {floating.length > 0 && (
          <button className="modular-small modular-dock-all" onClick={dockAllFloating}>
            Reacoplar todo ({floating.length})
          </button>
        )}
        <span className="modular-floating-count">
          {floating.length} flotante{floating.length === 1 ? "" : "s"}
        </span>
      </div>

      {status && <div className="modular-status">{status}</div>}

      <div className="modular-canvas" ref={canvasRef}>
        {renderNode(tree)}
        {floating.map((window) => (
          <div
            className="floating-pane"
            key={window.id}
            style={{
              left: window.x,
              top: window.y,
              width: window.width,
              height: window.height,
              zIndex: window.z,
            }}
            onPointerDown={() => focusFloating(window.id)}
          >
            <div
              className="floating-pane-bar"
              onPointerDown={(event) => moveFloating(event, window.id)}
              onDoubleClick={() => toggleFloatingMaximize(window.id)}
              title="Arrastrar ventana · doble clic para maximizar"
            >
              <span
                title={
                  resources.find((resource) => resource.id === window.pane.state.resourceId)
                    ?.title ?? TYPE_LABEL[window.pane.resourceType]
                }
              >
                ⧉{" "}
                {resources.find((resource) => resource.id === window.pane.state.resourceId)
                  ?.abbreviation ??
                  TYPE_LABEL[window.pane.resourceType]}
              </span>
              <div
                className="floating-pane-bar-actions"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  onClick={() => toggleFloatingMaximize(window.id)}
                  title={maximizedFloating === window.id ? "Restaurar ventana" : "Maximizar ventana"}
                  aria-label={maximizedFloating === window.id ? "Restaurar ventana" : "Maximizar ventana"}
                >
                  {maximizedFloating === window.id ? "↙" : "⤢"}
                </button>
                <button
                  onClick={() => dockPane(window.id, "left")}
                  title="Acoplar a la izquierda"
                >
                  ⇤ Izq.
                </button>
                <button
                  onClick={() => dockPane(window.id, "right")}
                  title="Acoplar a la derecha"
                >
                  Der. ⇥
                </button>
                <button
                  onClick={() => closeFloating(window.id)}
                  title="Cerrar ventana flotante"
                >
                  ×
                </button>
              </div>
            </div>
            <PaneView
              pane={window.pane}
              canClose
              floating
              programmatic={programmaticPanes.has(window.pane.id)}
              resources={resources}
              books={books}
              readerFont={localReaderFont}
              readerScale={localReaderScale}
              studyFont={localStudyFont}
              studyScale={localStudyScale}
              onReference={updateReference}
              onResource={updateResource}
              onType={updateType}
              onLink={updateLink}
              onPaneState={updateState}
              onSplit={split}
              onClose={() => closeFloating(window.id)}
              onSwap={swap}
              onAddTab={addTab}
              onSwitchTab={switchTab}
              onCloseTab={closeTab}
              onDragStart={startPaneDrag}
              onOpenStrong={handleOpenStrongInWorkspace}
              onDock={dockPane}
            />
            <div
              className="floating-resizer"
              onPointerDown={(event) => resizeFloating(event, window.id)}
              title="Redimensionar ventana"
            />
          </div>
        ))}
      </div>
      {dragPane && (
        <div className="mod-drop-zones" aria-hidden="true">
          {(["left", "right", "top", "bottom"] as const).map((side) => (
            <div
              key={side}
              className={
                dragPane.dropSide === side
                  ? `mod-drop-zone ${side} active`
                  : `mod-drop-zone ${side}`
              }
            >
              {side === "left" ? "Izquierda" : side === "right" ? "Derecha" : side === "top" ? "Arriba" : "Abajo"}
            </div>
          ))}
        </div>
      )}
      {dragPane && (
        <div
          className="mod-drag-ghost"
          style={{ left: dragPane.x + 12, top: dragPane.y + 12 }}
        >
          ⠿ {dragPane.title}
        </div>
      )}
    </div>
  );
}
