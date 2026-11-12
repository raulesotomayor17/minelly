import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import SlideCanvas, { createSlideLayout } from "./SlideCanvas";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import SelectMenu from "./SelectMenu";
import PixabayPicker from "./PixabayPicker";
import {
  FillInTheBlank,
  SermonBiblePassage,
  SermonBlockquote,
  SermonHeading,
  SermonIllustration,
  SermonOutlineExtension,
} from "./sermonExtensions";
import {
  buildSermonStructure,
  orderSlides,
  textOf,
  useSermonStore,
  type SermonMeta,
  type SermonSlide,
} from "./sermonStore";
import {
  findReferenceInText,
  htmlToPlainText,
  parseSermonReference,
  type ParsedSermonReference,
  type SermonBookInfo,
} from "./sermonRefs";
import {
  emptySermonDocument,
  formatSermonDateTime,
  sermonToInput,
  type PixabayImage,
  type Sermon,
  type SermonQuestion,
  type SermonSlideSettings,
  type SlideLayout,
  type SlideObject,
  type SlideTextObject,
  type SlideImageObject,
} from "./sermonTypes";

type SermonView = "edit" | "text" | "slides" | "worksheet" | "questions";

interface BibleSummary {
  id: string;
  title: string;
  abbreviation: string;
}

interface PassageVerse {
  book: number;
  chapter: number;
  verse: number;
  html: string;
}

interface PassageResult {
  resource: { id: string; title: string; abbreviation: string };
  verses: PassageVerse[];
}

interface SermonBuilderProps {
  sermon: Sermon;
  books: SermonBookInfo[];
  bibles: BibleSummary[];
  activeBibleId: string;
  onSaved: (sermon: Sermon) => void;
  onOpenManager: () => void;
  onOpenCustomization: () => void;
}

const VIEW_TABS: { id: SermonView; label: string; shortcut: string }[] = [
  { id: "edit", label: "Editar", shortcut: "Alt+1" },
  { id: "text", label: "Texto", shortcut: "Alt+2" },
  { id: "slides", label: "Diapositivas", shortcut: "Alt+3" },
  { id: "worksheet", label: "Hoja informativa", shortcut: "Alt+4" },
  { id: "questions", label: "Preguntas", shortcut: "Alt+5" },
];

const STYLE_OPTIONS = [
  { value: "paragraph", label: "Normal" },
  { value: "h1", label: "Encabezado 1" },
  { value: "h2", label: "Encabezado 2" },
  { value: "h3", label: "Encabezado 3" },
  { value: "h4", label: "Encabezado 4" },
  { value: "h5", label: "Encabezado 5" },
  { value: "blockquote", label: "Cita en bloque" },
];

const BACKGROUND_PRESETS = [
  { id: "theme", label: "Tema", value: "" },
  { id: "night", label: "Noche", value: "#101722" },
  { id: "ink", label: "Tinta", value: "#17233a" },
  { id: "blue", label: "Azul", value: "#102f4f" },
  { id: "forest", label: "Bosque", value: "#17352b" },
  { id: "wine", label: "Vino", value: "#3a1f2b" },
  { id: "paper", label: "Papel", value: "#f5efe0" },
];

function normalizeDocument(content: Sermon["contentJson"]) {
  if (!content || content.type !== "doc") return emptySermonDocument();
  return content;
}

function makeQuestionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slideBackgroundStyle(value: string): CSSProperties {
  if (!value) return {};
  if (/^(https?:|data:image)/.test(value)) {
    return {
      backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.55)), url("${value}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { background: value };
}

function isLightBackground(value: string): boolean {
  const hex = value.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false;
  const channel = (start: number) =>
    Number.parseInt(hex.slice(start, start + 2), 16);
  const luminance =
    (channel(0) * 299 + channel(2) * 587 + channel(4) * 114) / 1000;
  return luminance > 160;
}

interface DocumentBlockPayload {
  kind: "heading" | "paragraph" | "quote" | "bullet";
  level: number;
  text: string;
}

function collectDocumentBlocks(
  node: JSONContent | null | undefined,
  output: DocumentBlockPayload[],
  mode: "normal" | "quote" | "bullet" = "normal",
) {
  if (!node) return;
  if (node.type === "heading") {
    const text = textOf(node).trim();
    if (text) {
      output.push({
        kind: "heading",
        level: Number(node.attrs?.level ?? 1),
        text,
      });
    }
    return;
  }
  if (node.type === "paragraph") {
    const text = textOf(node).trim();
    if (text) {
      output.push({
        kind: mode === "quote" ? "quote" : mode === "bullet" ? "bullet" : "paragraph",
        level: 0,
        text,
      });
    }
    return;
  }
  if (node.type === "blockquote") {
    for (const child of node.content ?? []) {
      collectDocumentBlocks(child, output, "quote");
    }
    return;
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    for (const item of node.content ?? []) {
      for (const child of item.content ?? []) {
        collectDocumentBlocks(child, output, "bullet");
      }
    }
    return;
  }
  if (node.type === "sermonIllustration" || node.type === "sermonBiblePassage") {
    return;
  }
  for (const child of node.content ?? []) {
    collectDocumentBlocks(child, output, mode);
  }
}

function SlideContent({ slide }: { slide: SermonSlide }) {
  if (slide.kind === "title") {
    return (
      <div className="slide-copy slide-title-copy">
        <span className="slide-eyebrow">Sermón</span>
        <h1>{slide.title}</h1>
        {slide.body.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    );
  }
  if (slide.kind === "heading") {
    return (
      <div className="slide-copy">
        <span className="slide-eyebrow">Punto {slide.level ?? 1}</span>
        <h2>{slide.title}</h2>
        {slide.body.length > 0 ? (
          <ul>
            {slide.body.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="slide-empty">Añade texto debajo de este encabezado.</p>
        )}
      </div>
    );
  }
  if (slide.kind === "quote") {
    return (
      <div className="slide-copy slide-quote-copy">
        <span className="slide-eyebrow">Cita</span>
        <blockquote>{slide.body[0]}</blockquote>
      </div>
    );
  }
  if (slide.kind === "illustration") {
    return (
      <div className="slide-illustration-copy">
        {slide.imageUrl && <img src={slide.imageUrl} alt={slide.title} />}
        <div className="slide-copy">
          <span className="slide-eyebrow">Ilustración</span>
          <h2>{slide.title}</h2>
          {slide.body.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
        </div>
      </div>
    );
  }
  if (slide.kind === "passage") {
    return (
      <div className="slide-copy slide-passage-copy">
        <span className="slide-eyebrow">Pasaje bíblico</span>
        <h2>{slide.reference || slide.title}</h2>
        <p>{slide.body[0]}</p>
      </div>
    );
  }
  return (
    <div className="slide-copy">
      {slide.title && <h2>{slide.title}</h2>}
      {slide.body.map((line, index) => (
        <p key={`${line}-${index}`}>{line}</p>
      ))}
    </div>
  );
}

export default function SermonBuilder({
  sermon,
  books,
  bibles,
  activeBibleId,
  onSaved,
  onOpenManager,
  onOpenCustomization,
}: SermonBuilderProps) {
  const [localSermon, setLocalSermon] = useState<Sermon>(sermon);
  const [slideSettings, setSlideSettings] = useState<SermonSlideSettings>(() => ({
    backgrounds: sermon.slideSettings?.backgrounds ?? {},
    order: sermon.slideSettings?.order ?? [],
    layouts: sermon.slideSettings?.layouts ?? {},
    customSlides: sermon.slideSettings?.customSlides ?? [],
    transitions: sermon.slideSettings?.transitions ?? {},
  }));
  const [dragSlideId, setDragSlideId] = useState<string | null>(null);
  const [dragOverSlideId, setDragOverSlideId] = useState<string | null>(null);
  const [designMode, setDesignMode] = useState(
    () => Object.keys(sermon.slideSettings?.layouts ?? {}).length > 0,
  );
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(
    () => sermon.slideSettings?.layouts?.["slide-title"]?.objects[0]?.id ?? null,
  );
  const [view, setView] = useState<SermonView>(() => {
    const raw = localStorage.getItem("teoamoxtli.sermon-view.v1");
    return ["edit", "text", "slides", "worksheet", "questions"].includes(
      raw ?? "",
    )
      ? (raw as SermonView)
      : "edit";
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [saveError, setSaveError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [docExporting, setDocExporting] = useState(false);
  const [docExportStatus, setDocExportStatus] = useState("");
  const [docExportError, setDocExportError] = useState("");
  const [, setRevision] = useState(0);
  const [pixabayOpen, setPixabayOpen] = useState(false);
  const [pixabayMode, setPixabayMode] = useState<
    "illustration" | "background" | "slide"
  >("illustration");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceValue, setReferenceValue] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [bibleId, setBibleId] = useState(activeBibleId || bibles[0]?.id || "");
  const [questions, setQuestions] = useState<SermonQuestion[]>(
    Array.isArray(sermon.questionsJson) ? sermon.questionsJson : [],
  );
  const [questionDraft, setQuestionDraft] = useState("");
  const [presenting, setPresenting] = useState(false);

  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const sermonRef = useRef(localSermon);
  const questionsRef = useRef(questions);
  const slideSettingsRef = useRef(slideSettings);
  const remoteMigrationRef = useRef(false);
  const contentMigrationRef = useRef(false);

  useEffect(() => {
    if (remoteMigrationRef.current) return;
    const remote = new Set<string>();
    for (const value of Object.values(slideSettings.backgrounds ?? {})) {
      if (value.startsWith("http://") || value.startsWith("https://")) {
        remote.add(value);
      }
    }
    for (const layout of Object.values(slideSettings.layouts ?? {})) {
      for (const object of layout.objects) {
        if (
          object.type === "image" &&
          (object.url.startsWith("http://") || object.url.startsWith("https://"))
        ) {
          remote.add(object.url);
        }
      }
    }
    if (remote.size === 0) return;
    remoteMigrationRef.current = true;
    void (async () => {
      const replacements = new Map<string, string>();
      for (const url of remote) {
        try {
          const dataUrl = await invoke<string>("download_to_base64", { url });
          replacements.set(url, dataUrl);
        } catch {
          // Sin conexión: se conserva la URL hasta que el usuario vuelva a abrirla.
        }
      }
      if (replacements.size === 0) return;
      setSlideSettings((current) => {
        const backgrounds = Object.fromEntries(
          Object.entries(current.backgrounds ?? {}).map(([id, value]) => [
            id,
            replacements.get(value) ?? value,
          ]),
        );
        const layouts = Object.fromEntries(
          Object.entries(current.layouts ?? {}).map(([id, layout]) => [
            id,
            {
              objects: layout.objects.map((object) =>
                object.type === "image" && replacements.has(object.url)
                  ? { ...object, url: replacements.get(object.url) ?? object.url }
                  : object,
              ),
            },
          ]),
        );
        const next = { ...current, backgrounds, layouts };
        slideSettingsRef.current = next;
        return next;
      });
      scheduleSave();
    })();
  }, [slideSettings.backgrounds, slideSettings.layouts]);
  const onSavedRef = useRef(onSaved);
  const saveTimerRef = useRef<number | null>(null);
  const pixabayApplyRef = useRef<
    ((image: { url: string; credit?: string }) => void) | null
  >(null);

  const meta: SermonMeta = {
    title: localSermon.title,
    speaker: localSermon.speaker,
    series: localSermon.series,
    dateTime: localSermon.dateTime,
  };
  const metaRef = useRef<SermonMeta>(meta);
  metaRef.current = meta;
  sermonRef.current = localSermon;
  questionsRef.current = questions;
  slideSettingsRef.current = slideSettings;
  onSavedRef.current = onSaved;

  const sermonOutline = useSermonStore((state) => state.sermonOutline);
  const sermonSlides = useSermonStore((state) => state.sermonSlides);
  const activeSlide = useSermonStore((state) => state.activeSlide);
  const setActiveSlide = useSermonStore((state) => state.setActiveSlide);
  const customSlideObjects = useMemo<SermonSlide[]>(
    () =>
      (slideSettings.customSlides ?? []).map((id) => ({
        id,
        kind: "custom",
        title: "Diapositiva",
        body: [],
        background: slideSettings.backgrounds[id] ?? "",
      })),
    [slideSettings.customSlides, slideSettings.backgrounds],
  );
  const allSlides = useMemo(
    () => [...sermonSlides, ...customSlideObjects],
    [sermonSlides, customSlideObjects],
  );
  const orderedSlides = useMemo(
    () => orderSlides(allSlides, slideSettings.order),
    [allSlides, slideSettings.order],
  );

  function refreshStructure(editor: NonNullable<typeof editorRef.current>) {
    const { outline, slides } = buildSermonStructure(editor, metaRef.current);
    useSermonStore.getState().setSermonStructure(outline, slides);
  }

  async function saveNow() {
    const editor = editorRef.current;
    if (!editor) return;
    const current = sermonRef.current;
    setSaving(true);
    try {
      const payload: Sermon = {
        ...current,
        contentJson: editor.getJSON(),
        questionsJson: questionsRef.current,
        slideSettings: slideSettingsRef.current,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      const updated = await invoke<Sermon>("sermon_update", {
        id: current.id,
        input: sermonToInput(payload),
      });
      sermonRef.current = updated;
      setLocalSermon(updated);
      setDirty(false);
      setSaveError("");
      setSavedAt(
        new Date().toLocaleTimeString("es", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      onSavedRef.current(updated);
    } catch (issue) {
      setSaveError(String(issue));
    } finally {
      setSaving(false);
    }
  }

  function scheduleSave() {
    setDirty(true);
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void saveNow();
    }, 900);
  }

  function patchSlideSettings(patch: Partial<SermonSlideSettings>) {
    setSlideSettings((current) => {
      const next = { ...current, ...patch };
      slideSettingsRef.current = next;
      return next;
    });
    scheduleSave();
  }

  function updateLayout(
    slide: SermonSlide,
    updater: (layout: SlideLayout) => SlideLayout,
  ) {
    setSlideSettings((current) => {
      const base =
        current.layouts?.[slide.id] ??
        createSlideLayout(
          slide,
          current.backgrounds[slide.id] || slide.background || "",
        );
      const layout = updater(base);
      const next = {
        ...current,
        layouts: { ...current.layouts, [slide.id]: layout },
      };
      slideSettingsRef.current = next;
      return next;
    });
    scheduleSave();
  }

  function startDesign() {
    if (!activeSlideData) return;
    const layout =
      activeLayout ??
      createSlideLayout(activeSlideData, activeBackground);
    if (!activeLayout) {
      updateLayout(activeSlideData, () => layout);
    }
    setDesignMode(true);
    setSelectedObjectId(layout.objects[0]?.id ?? null);
  }

  function addTextObject(role: "title" | "body" | "custom") {
    if (!activeSlideData) return;
    const object: SlideTextObject = {
      id: globalThis.crypto?.randomUUID?.() ?? `text-${Date.now()}`,
      type: "text",
      text: role === "title" ? "Nuevo título" : "Nuevo texto",
      x: 140,
      y: role === "title" ? 180 : 300,
      width: role === "title" ? 1000 : 800,
      height: role === "title" ? 150 : 120,
      fontSize: role === "title" ? 64 : 38,
      fontFamily: "Georgia, 'Times New Roman', serif",
      bold: role === "title",
      italic: false,
      underline: false,
      color: isLightBackground(activeBackground) ? "#1F232B" : "#F5F8FF",
      align: "left",
      role: role === "title" ? "title" : "body",
    };
    updateLayout(activeSlideData, (layout) => ({
      ...layout,
      objects: [...layout.objects, object],
    }));
    setDesignMode(true);
    setSelectedObjectId(object.id);
  }

  function addImageObject(url: string) {
    if (!activeSlideData) return;
    const object: SlideImageObject = {
      id: globalThis.crypto?.randomUUID?.() ?? `image-${Date.now()}`,
      type: "image",
      url,
      x: 290,
      y: 130,
      width: 640,
      height: 430,
      radius: 10,
    };
    updateLayout(activeSlideData, (layout) => ({
      ...layout,
      objects: [...layout.objects, object],
    }));
    setDesignMode(true);
    setSelectedObjectId(object.id);
  }

  function changeObject(object: SlideObject) {
    if (!activeSlideData) return;
    updateLayout(activeSlideData, (layout) => ({
      ...layout,
      objects: layout.objects.map((item) =>
        item.id === object.id ? object : item,
      ),
    }));
  }

  function deleteObject(objectId: string) {
    if (!activeSlideData) return;
    updateLayout(activeSlideData, (layout) => ({
      ...layout,
      objects: layout.objects.filter((item) => item.id !== objectId),
    }));
    setSelectedObjectId(null);
  }

  function resetDesign() {
    if (!activeSlideData) return;
    setSlideSettings((current) => {
      const layouts = { ...current.layouts };
      delete layouts[activeSlideData.id];
      const next = { ...current, layouts };
      slideSettingsRef.current = next;
      return next;
    });
    scheduleSave();
    setDesignMode(false);
    setSelectedObjectId(null);
  }

  function addBlankSlide() {
    const id =
      globalThis.crypto?.randomUUID?.() ?? `slide-${Date.now()}-${Math.random()}`;
    setSlideSettings((current) => {
      const next = {
        ...current,
        customSlides: [...(current.customSlides ?? []), id],
        backgrounds: {
          ...current.backgrounds,
          [id]: "#101722",
        },
        layouts: {
          ...current.layouts,
          [id]: { objects: [] },
        },
        order: [...(current.order ?? []), id],
      };
      slideSettingsRef.current = next;
      return next;
    });
    scheduleSave();
    setDesignMode(true);
    setSelectedObjectId(null);
    setActiveSlide(orderedSlides.length);
  }

  function deleteCustomSlide() {
    if (!activeSlideData || activeSlideData.kind !== "custom") return;
    const id = activeSlideData.id;
    const index = orderedSlides.findIndex((slide) => slide.id === id);
    setSlideSettings((current) => {
      const layouts = { ...current.layouts };
      const backgrounds = { ...current.backgrounds };
      const transitions = { ...current.transitions };
      delete layouts[id];
      delete backgrounds[id];
      delete transitions[id];
      const next = {
        ...current,
        customSlides: (current.customSlides ?? []).filter((item) => item !== id),
        layouts,
        backgrounds,
        transitions,
        order: (current.order ?? []).filter((item) => item !== id),
      };
      slideSettingsRef.current = next;
      return next;
    });
    scheduleSave();
    setDesignMode(false);
    setSelectedObjectId(null);
    setActiveSlide(Math.max(0, index - 1));
  }

  function setSlideTransition(value: string) {
    if (!activeSlideData) return;
    patchSlideSettings({
      transitions: {
        ...(slideSettings.transitions ?? {}),
        [activeSlideData.id]: value,
      },
    });
  }

  function moveSlide(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const ids = orderedSlides.map((slide) => slide.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    const insertAt = from < to ? to - 1 : to;
    next.splice(insertAt, 0, moved);
    patchSlideSettings({ order: next });
  }

  function patchSermon(patch: Partial<Sermon>) {
    setLocalSermon((current) => {
      const next = { ...current, ...patch };
      sermonRef.current = next;
      return next;
    });
    metaRef.current = {
      ...metaRef.current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.speaker !== undefined ? { speaker: patch.speaker } : {}),
      ...(patch.series !== undefined ? { series: patch.series } : {}),
      ...(patch.dateTime !== undefined ? { dateTime: patch.dateTime } : {}),
    };
    if (editorRef.current) refreshStructure(editorRef.current);
    scheduleSave();
  }

  const handleNodePickImage = useCallback(
    (
      apply: (image: { url: string; credit?: string }) => void,
      _initialQuery?: string,
    ) => {
      pixabayApplyRef.current = apply;
      setPixabayMode("illustration");
      setPixabayOpen(true);
    },
    [],
  );

  const insertReferenceRef = useRef<(value: string) => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        link: { openOnClick: false },
      }),
      SermonHeading.configure({ levels: [1, 2, 3, 4, 5] }),
      SermonBlockquote,
      FillInTheBlank,
      SermonIllustration.configure({
        onPickImage: handleNodePickImage,
      }),
      SermonBiblePassage,
      Placeholder.configure({
        placeholder:
          "Empieza a escribir o elige un estilo: Encabezado, Cita en bloque o Ilustración…",
      }),
      SermonOutlineExtension.configure({
        onChange: (current) => {
          const { outline, slides } = buildSermonStructure(current, metaRef.current);
          useSermonStore.getState().setSermonStructure(outline, slides);
        },
      }),
    ],
    content: normalizeDocument(sermon.contentJson),
    editorProps: {
      attributes: { class: "sermon-editor-content" },
      handleKeyDown: (viewState, event) => {
        if (event.altKey && event.key === "Enter") {
          const { from, to, $from } = viewState.state.selection;
          const selected = viewState.state.doc.textBetween(from, to, " ");
          const paragraph = viewState.state.doc.textBetween(
            $from.start(),
            $from.end(),
            " ",
          );
          const parsed =
            parseSermonReference(selected || paragraph, books) ||
            findReferenceInText(selected || paragraph, books);
          if (parsed) {
            event.preventDefault();
            insertReferenceRef.current(parsed.label);
            return true;
          }
          setReferenceValue(selected.trim());
          setReferenceOpen(true);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      setRevision((value) => value + 1);
      scheduleSave();
      refreshStructure(current);
    },
    onSelectionUpdate: () => {
      setRevision((value) => value + 1);
    },
  });

  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    refreshStructure(editor);
  }, [editor, localSermon.title, localSermon.speaker, localSermon.series, localSermon.dateTime]);

  useEffect(() => {
    if (!editor || contentMigrationRef.current) return;
    const targets: Array<{ pos: number; attrs: Record<string, unknown> }> = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "sermonIllustration") return;
      const url = String(node.attrs.imageUrl ?? "");
      if (url.startsWith("http://") || url.startsWith("https://")) {
        targets.push({ pos, attrs: { ...node.attrs } });
      }
    });
    if (targets.length === 0) return;
    contentMigrationRef.current = true;
    void (async () => {
      for (const target of targets) {
        try {
          const dataUrl = await invoke<string>("download_to_base64", {
            url: String(target.attrs.imageUrl),
          });
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(target.pos, undefined, {
                ...target.attrs,
                imageUrl: dataUrl,
              });
              return true;
            })
            .run();
        } catch {
          // Sin conexión: se conserva la URL original.
        }
      }
      scheduleSave();
    })();
  }, [editor]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!presenting) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPresenting(false);
        void getCurrentWindow().setFullscreen(false).catch(() => undefined);
      } else if (event.key === "ArrowRight" || event.key === "PageDown") {
        setActiveSlide(
          Math.min(orderedSlides.length - 1, useSermonStore.getState().activeSlide + 1),
        );
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        setActiveSlide(Math.max(0, useSermonStore.getState().activeSlide - 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [presenting, orderedSlides.length, setActiveSlide]);

  useEffect(() => {
    localStorage.setItem("teoamoxtli.sermon-view.v1", view);
  }, [view]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        pixabayApplyRef.current = null;
        setPixabayMode("illustration");
        setPixabayOpen(true);
        return;
      }
      const index = Number(event.key);
      if (index >= 1 && index <= VIEW_TABS.length) {
        event.preventDefault();
        setView(VIEW_TABS[index - 1].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function insertPassage(reference: string) {
    const parsed: ParsedSermonReference | null = parseSermonReference(
      reference,
      books,
    );
    if (!parsed) {
      setReferenceError(
        "No reconozco esa referencia. Usa un formato como «Juan 3:16».",
      );
      return;
    }
    const resourceId = bibleId || bibles[0]?.id;
    if (!resourceId) {
      setReferenceError("No hay una Biblia activa para extraer el pasaje.");
      return;
    }
    try {
      const passage = await invoke<PassageResult>("get_passage", {
        resourceId,
        book: parsed.book,
        chapter: parsed.chapter,
      });
      const verses = passage.verses.filter(
        (verse) =>
          verse.verse >= parsed.verse && verse.verse <= parsed.endVerse,
      );
      if (verses.length === 0) {
        setReferenceError("La Biblia activa no tiene ese pasaje.");
        return;
      }
      const text = verses
        .map((verse) => htmlToPlainText(verse.html))
        .filter(Boolean)
        .join(" ");
      const translation =
        passage.resource.abbreviation || passage.resource.title;
      editorRef.current
        ?.chain()
        .focus()
        .insertContent({
          type: "biblePassage",
          attrs: {
            reference: parsed.label,
            text,
            translation,
            book: parsed.book,
            chapter: parsed.chapter,
            verse: parsed.verse,
            endVerse: parsed.endVerse,
          },
        })
        .run();
      const passages = Array.from(
        new Set([...sermonRef.current.passages, parsed.label]),
      );
      patchSermon({ passages });
      setReferenceOpen(false);
      setReferenceValue("");
      setReferenceError("");
    } catch (issue) {
      setReferenceError(String(issue));
    }
  }

  insertReferenceRef.current = (value) => {
    void insertPassage(value);
  };

  function applyStyle(value: string) {
    const current = editorRef.current;
    if (!current) return;
    if (value === "paragraph") {
      current.chain().focus().setParagraph().run();
    } else if (value === "blockquote") {
      current.chain().focus().toggleBlockquote().run();
    } else if (/^h[1-5]$/.test(value)) {
      current
        .chain()
        .focus()
        .setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 | 5 })
        .run();
    }
  }

  function currentStyle(): string {
    const current = editorRef.current;
    if (!current) return "paragraph";
    for (let level = 1; level <= 5; level += 1) {
      if (current.isActive("heading", { level })) return `h${level}`;
    }
    if (current.isActive("blockquote")) return "blockquote";
    return "paragraph";
  }

  function openReferenceDialog() {
    const current = editorRef.current;
    const selected = current
      ? current.state.doc.textBetween(
          current.state.selection.from,
          current.state.selection.to,
          " ",
        )
      : "";
    setReferenceValue(selected.trim());
    setReferenceError("");
    setReferenceOpen(true);
  }

  function insertIllustration() {
    pixabayApplyRef.current = null;
    setPixabayMode("illustration");
    setPixabayOpen(true);
  }

  async function handlePixabaySelect(image: PixabayImage) {
    const sourceUrl = image.largeImageUrl || image.webformatUrl;
    let imageUrl = "";
    try {
      imageUrl = await invoke<string>("download_to_base64", {
        url: sourceUrl,
      });
    } catch (issue) {
      setSaveError(String(issue));
      return;
    }
    if (pixabayMode === "slide") {
      addImageObject(imageUrl);
    } else if (pixabayMode === "background") {
      const slide = orderedSlides[activeSlide];
      if (slide) {
        patchSlideSettings({
          backgrounds: {
            ...slideSettings.backgrounds,
            [slide.id]: imageUrl,
          },
        });
      }
    } else if (pixabayApplyRef.current) {
      pixabayApplyRef.current({
        url: imageUrl,
        credit: `© ${image.user} / Pixabay`,
      });
      pixabayApplyRef.current = null;
    } else {
      editorRef.current
        ?.chain()
        .focus()
        .insertContent({
          type: "sermonIllustration",
          attrs: {
            title: image.tags.split(",")[0] || "Ilustración",
            caption: "",
            imageUrl,
            credit: `© ${image.user} / Pixabay`,
          },
        })
        .run();
    }
    setPixabayOpen(false);
  }

  function addQuestion(text: string, kind: SermonQuestion["kind"] = "custom") {
    const clean = text.trim();
    if (!clean) return;
    const next = [
      ...questionsRef.current,
      { id: makeQuestionId(), text: clean, kind, done: false },
    ];
    setQuestions(next);
    questionsRef.current = next;
    scheduleSave();
  }

  function generateQuestions() {
    const generated: SermonQuestion[] = [];
    for (const heading of sermonOutline) {
      generated.push({
        id: makeQuestionId(),
        text: `¿Qué verdad principal enseña «${heading.text}»?`,
        kind: "exegesis",
        done: false,
      });
      generated.push({
        id: makeQuestionId(),
        text: `¿Cómo aplicarías «${heading.text}» esta semana?`,
        kind: "application",
        done: false,
      });
    }
    for (const slide of orderedSlides.filter((item) => item.kind === "passage")) {
      generated.push({
        id: makeQuestionId(),
        text: `¿Cómo ilumina ${slide.reference || slide.title} el mensaje del sermón?`,
        kind: "exegesis",
        done: false,
      });
    }
    const existing = new Set(questionsRef.current.map((question) => question.text));
    const next = [
      ...questionsRef.current,
      ...generated.filter((question) => !existing.has(question.text)),
    ];
    setQuestions(next);
    questionsRef.current = next;
    scheduleSave();
  }

  function updateQuestion(id: string, patch: Partial<SermonQuestion>) {
    const next = questionsRef.current.map((question) =>
      question.id === id ? { ...question, ...patch } : question,
    );
    setQuestions(next);
    questionsRef.current = next;
    scheduleSave();
  }

  function removeQuestion(id: string) {
    const next = questionsRef.current.filter((question) => question.id !== id);
    setQuestions(next);
    questionsRef.current = next;
    scheduleSave();
  }

  async function exportPresentation(format: "pptx" | "pdf" | "odp") {
    if (orderedSlides.length === 0) {
      setExportError("No hay diapositivas para exportar.");
      return;
    }
    setExportError("");
    setExportStatus("");
    try {
      const base = (localSermon.title || "sermon")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "sermon";
      const path = await save({
        title: `Exportar presentación ${format.toUpperCase()}`,
        defaultPath: `${base}.${format}`,
        filters: [
          {
            name:
              format === "pptx"
                ? "PowerPoint"
                : format === "odp"
                  ? "OpenDocument Presentation"
                  : "PDF",
            extensions: [format],
          },
        ],
      });
      if (!path) return;
      setExporting(true);
      const slides = orderedSlides.map((slide) => ({
        kind: slide.kind,
        title: slide.title,
        body: slide.body,
        reference: slide.reference ?? "",
        imageUrl: slide.imageUrl ?? "",
        background:
          slideSettings.backgrounds[slide.id] || slide.background || "",
        objects: (slideSettings.layouts?.[slide.id]?.objects ?? []).map(
          (object) =>
            object.type === "text"
              ? {
                  id: object.id,
                  type: "text",
                  text: object.text,
                  url: "",
                  x: object.x,
                  y: object.y,
                  width: object.width,
                  height: object.height,
                  fontSize: object.fontSize,
                  fontFamily: object.fontFamily,
                  bold: object.bold,
                  italic: object.italic,
                  underline: object.underline,
                  color: object.color,
                  align: object.align,
                  rotation: object.rotation ?? 0,
                  zIndex: object.zIndex ?? 0,
                  opacity: object.opacity ?? 1,
                  shadow: object.shadow ?? false,
                  cropTop: 0,
                  cropRight: 0,
                  cropBottom: 0,
                  cropLeft: 0,
                }
              : {
                  id: object.id,
                  type: "image",
                  text: "",
                  url: object.url,
                  x: object.x,
                  y: object.y,
                  width: object.width,
                  height: object.height,
                  fontSize: 0,
                  fontFamily: "",
                  bold: false,
                  italic: false,
                  underline: false,
                  color: "",
                  align: "left",
                  rotation: object.rotation ?? 0,
                  zIndex: object.zIndex ?? 0,
                  opacity: object.opacity ?? 1,
                  shadow: object.shadow ?? false,
                  cropTop: object.crop?.top ?? 0,
                  cropRight: object.crop?.right ?? 0,
                  cropBottom: object.crop?.bottom ?? 0,
                  cropLeft: object.crop?.left ?? 0,
                },
        ),
      }));
      const result = await invoke<string>("export_slides", {
        path,
        format,
        slides,
      });
      setExportStatus(`Guardado en ${result}`);
    } catch (issue) {
      setExportError(String(issue));
    } finally {
      setExporting(false);
    }
  }

  async function exportDocument(format: "docx" | "odt") {
    setDocExportError("");
    setDocExportStatus("");
    try {
      const base = (localSermon.title || "sermon")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "sermon";
      const path = await save({
        title: `Exportar texto ${format.toUpperCase()}`,
        defaultPath: `${base}.${format}`,
        filters: [
          {
            name: format === "docx" ? "Microsoft Word" : "OpenDocument Text",
            extensions: [format],
          },
        ],
      });
      if (!path) return;
      setDocExporting(true);
      const blocks: DocumentBlockPayload[] = [];
      collectDocumentBlocks(editor?.getJSON() ?? localSermon.contentJson, blocks);
      const result = await invoke<string>("export_document", {
        path,
        format,
        title: localSermon.title || "Sermón",
        blocks,
      });
      setDocExportStatus(`Guardado en ${result}`);
    } catch (issue) {
      setDocExportError(String(issue));
    } finally {
      setDocExporting(false);
    }
  }

  function openPresentation() {
    setView("slides");
    setPresenting(true);
    void getCurrentWindow().setFullscreen(true).catch(() => undefined);
  }

  function closePresentation() {
    setPresenting(false);
    void getCurrentWindow().setFullscreen(false).catch(() => undefined);
  }

  const activeSlideData =
    orderedSlides[Math.min(activeSlide, Math.max(0, orderedSlides.length - 1))] ??
    null;
  const activeBackground = activeSlideData
    ? slideSettings.backgrounds[activeSlideData.id] ||
      activeSlideData.background ||
      ""
    : "";
  const activeIsLight = isLightBackground(activeBackground);
  const activeLayout = activeSlideData
    ? slideSettings.layouts?.[activeSlideData.id] ?? null
    : null;
  const selectedObject =
    activeLayout?.objects.find((object) => object.id === selectedObjectId) ??
    null;
  const selectedCrop =
    selectedObject?.type === "image"
      ? selectedObject.crop ?? { top: 0, right: 0, bottom: 0, left: 0 }
      : { top: 0, right: 0, bottom: 0, left: 0 };
  const wordCount = editor
    ? editor.getText().split(/\s+/).filter(Boolean).length
    : textOf(localSermon.contentJson).split(/\s+/).filter(Boolean).length;
  const readingMinutes = Math.max(1, Math.round(wordCount / 130));

  return (
    <section className={`sermon-builder sermon-view-${view}`} aria-label="Preparador de sermones">
      <header className="sermon-builder-head">
        <div className="sermon-builder-title-block">
          <span className="eyebrow">Preparador de sermones</span>
          <input
            className="sermon-title-input"
            value={localSermon.title}
            onChange={(event) => patchSermon({ title: event.target.value })}
            aria-label="Título del sermón"
            placeholder="Título del sermón"
          />
          <div className="sermon-builder-meta">
            <span>{localSermon.series || "Sin serie"}</span>
            <span>·</span>
            <span>{localSermon.speaker || "Sin orador"}</span>
            <span>·</span>
            <span>{formatSermonDateTime(localSermon.dateTime)}</span>
            <button type="button" className="link-button" onClick={onOpenManager}>
              Editar metadatos
            </button>
          </div>
        </div>
        <div className="sermon-builder-actions">
          <span className={`sermon-save-state${dirty ? " dirty" : ""}`}>
            {saving
              ? "Guardando…"
              : dirty
                ? "Sin guardar"
                : savedAt
                  ? `Guardado ${savedAt}`
                  : "Guardado"}
          </span>
          <button type="button" className="secondary-button" onClick={() => void saveNow()}>
            Guardar
          </button>
          <button type="button" className="primary-button" onClick={openPresentation}>
            Presentar
          </button>
          <button
            type="button"
            className="tool-button"
            onClick={onOpenCustomization}
            title="Personalizar la interfaz"
          >
            Aa
          </button>
        </div>
      </header>

      <nav className="sermon-view-tabs" aria-label="Vistas del sermón">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={view === tab.id ? "active" : ""}
            onClick={() => setView(tab.id)}
            title={`${tab.label} (${tab.shortcut})`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="sermon-builder-body">
        <aside className="sermon-outline" aria-label="Bosquejo del sermón">
          <div className="sermon-outline-head">
            <div>
              <span className="eyebrow">Bosquejo</span>
              <strong>{sermonOutline.length} encabezados</strong>
            </div>
            <span className="sermon-outline-count">{sermonSlides.length} diap.</span>
          </div>
          {sermonOutline.length === 0 ? (
            <div className="sermon-outline-empty">
              <strong>Los títulos de tu sermón aparecerán aquí.</strong>
              <span>
                Usa el selector de estilo para crear un Encabezado 1–5 y el bosquejo se
                actualizará solo.
              </span>
            </div>
          ) : (
            <div className="sermon-outline-list">
              {sermonOutline.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`sermon-outline-item level-${item.level}`}
                  onClick={() => {
                    setView("edit");
                    editor?.chain().focus(item.pos).scrollIntoView().run();
                  }}
                  title={item.text}
                >
                  <span>H{item.level}</span>
                  <strong>{item.text}</strong>
                </button>
              ))}
            </div>
          )}
          <div className="sermon-outline-stats">
            <div>
              <strong>{wordCount.toLocaleString("es")}</strong>
              <span>palabras</span>
            </div>
            <div>
              <strong>~{readingMinutes}</strong>
              <span>min</span>
            </div>
            <div>
              <strong>{sermonSlides.filter((slide) => slide.kind === "passage").length}</strong>
              <span>pasajes</span>
            </div>
          </div>
          <div className="sermon-outline-help">
            <span>
              <kbd>Alt</kbd>+<kbd>Enter</kbd> inserta un pasaje bíblico desde el texto.
            </span>
            <span>
              <kbd>Alt</kbd>+<kbd>1…5</kbd> cambia de vista.
            </span>
          </div>
        </aside>

        <main className="sermon-stage">
          {view === "edit" && (
            <>
              <div className="sermon-editor-toolbar">
                <SelectMenu
                  className="sermon-style-menu"
                  value={currentStyle()}
                  onChange={applyStyle}
                  ariaLabel="Estilo de bloque"
                  options={STYLE_OPTIONS}
                />
                <div className="sermon-toolbar-divider" />
                <button
                  type="button"
                  className={editor?.isActive("bold") ? "active" : ""}
                  onClick={() => editor?.chain().focus().toggleBold().run()}
                  title="Negrita"
                >
                  <strong>B</strong>
                </button>
                <button
                  type="button"
                  className={editor?.isActive("italic") ? "active" : ""}
                  onClick={() => editor?.chain().focus().toggleItalic().run()}
                  title="Cursiva"
                >
                  <em>I</em>
                </button>
                <button
                  type="button"
                  className={editor?.isActive("underline") ? "active" : ""}
                  onClick={() => editor?.chain().focus().toggleUnderline().run()}
                  title="Subrayado"
                >
                  <u>U</u>
                </button>
                <button
                  type="button"
                  className={editor?.isActive("strike") ? "active" : ""}
                  onClick={() => editor?.chain().focus().toggleStrike().run()}
                  title="Tachado"
                >
                  S
                </button>
                <div className="sermon-toolbar-divider" />
                <button
                  type="button"
                  className={editor?.isActive("bulletList") ? "active" : ""}
                  onClick={() => editor?.chain().focus().toggleBulletList().run()}
                  title="Lista"
                >
                  ••
                </button>
                <button
                  type="button"
                  className={editor?.isActive("orderedList") ? "active" : ""}
                  onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                  title="Lista numerada"
                >
                  1.
                </button>
                <div className="sermon-toolbar-divider" />
                <button
                  type="button"
                  className={editor?.isActive("fillInTheBlank") ? "active fill-command" : "fill-command"}
                  onClick={() =>
                    editor?.chain().focus().toggleMark("fillInTheBlank").run()
                  }
                  title="Convertir la selección en un espacio para completar"
                >
                  Completar
                </button>
                <button
                  type="button"
                  className="sermon-tool-button"
                  onClick={openReferenceDialog}
                  title="Insertar pasaje bíblico"
                >
                  Pasaje bíblico
                </button>
                <button
                  type="button"
                  className="sermon-tool-button"
                  onClick={insertIllustration}
                  title="Buscar una ilustración en Pixabay"
                >
                  Ilustración
                </button>
                <div className="sermon-toolbar-spacer" />
                <button
                  type="button"
                  onClick={() => editor?.chain().focus().undo().run()}
                  disabled={!editor?.can().undo()}
                  title="Deshacer"
                >
                  ↶
                </button>
                <button
                  type="button"
                  onClick={() => editor?.chain().focus().redo().run()}
                  disabled={!editor?.can().redo()}
                  title="Rehacer"
                >
                  ↷
                </button>
                <button
                  type="button"
                  className="sermon-tool-button"
                  onClick={openReferenceDialog}
                  title="Ver referencias de la Biblia activa"
                >
                  {bibles.find((bible) => bible.id === bibleId)?.abbreviation || "Biblia"}
                </button>
              </div>
              <div className="sermon-editor-shell">
                {editor ? (
                  <EditorContent editor={editor} />
                ) : (
                  <div className="sermon-editor-loading">Cargando editor…</div>
                )}
              </div>
              <footer className="sermon-stage-foot">
                <span>
                  {wordCount.toLocaleString("es")} palabras · ~{readingMinutes} min de
                  predicación
                </span>
                <span>
                  {sermonOutline.length} encabezados ·{" "}
                  {sermonSlides.filter((slide) => slide.kind === "passage").length} pasajes
                </span>
              </footer>
            </>
          )}

          {view === "text" && (
            <div className="sermon-document-view">
              <header>
                <span className="eyebrow">Texto del sermón</span>
                <h1>{localSermon.title}</h1>
                <p>
                  {localSermon.speaker || "Sin orador"} ·{" "}
                  {formatSermonDateTime(localSermon.dateTime)}
                </p>
              </header>
              <div className="sermon-document-actions">
                <span>Exportar el texto con formato:</span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void exportDocument("docx")}
                  disabled={docExporting}
                >
                  {docExporting ? "Exportando…" : "DOCX"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void exportDocument("odt")}
                  disabled={docExporting}
                >
                  {docExporting ? "Exportando…" : "ODT"}
                </button>
              </div>
              {docExportStatus && (
                <div className="sermon-export-status">{docExportStatus}</div>
              )}
              {docExportError && (
                <div className="sermon-export-error">
                  <span>{docExportError}</span>
                  <button type="button" onClick={() => setDocExportError("")}>×</button>
                </div>
              )}
              <div
                className="sermon-text-view"
                dangerouslySetInnerHTML={{ __html: editor?.getHTML() ?? "" }}
              />
            </div>
          )}

          {view === "worksheet" && (
            <div className="sermon-worksheet-wrap">
              <div className="sermon-worksheet-toolbar">
                <div>
                  <span className="eyebrow">Hoja informativa</span>
                  <strong>Los espacios «Completar» se imprimen como líneas para escribir.</strong>
                </div>
                <button type="button" className="secondary-button" onClick={() => window.print()}>
                  Imprimir hoja
                </button>
              </div>
              <article className="sermon-worksheet">
                <header>
                  <h1>{localSermon.title}</h1>
                  <p>
                    {localSermon.speaker || "Sin orador"} ·{" "}
                    {formatSermonDateTime(localSermon.dateTime)}
                  </p>
                </header>
                <div
                  className="sermon-worksheet-content"
                  dangerouslySetInnerHTML={{ __html: editor?.getHTML() ?? "" }}
                />
              </article>
            </div>
          )}

          {view === "slides" && (
            <div className="sermon-slides-view">
              <div className="sermon-slides-rail">
                <div className="sermon-slides-rail-head">
                  <strong>Diapositivas</strong>
                  <span>{orderedSlides.length}</span>
                  <button
                    type="button"
                    className="sermon-add-slide"
                    onClick={addBlankSlide}
                    title="Añadir diapositiva en blanco"
                  >
                    +
                  </button>
                </div>
                <div className="sermon-slide-thumbs">
                  {orderedSlides.map((slide, index) => (
                    <button
                      key={slide.id}
                      type="button"
                      draggable
                      className={[
                        index === activeSlide ? "active" : "",
                        dragOverSlideId === slide.id ? "drag-over" : "",
                        dragSlideId === slide.id ? "dragging" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setActiveSlide(index)}
                      onDragStart={(event) => {
                        setDragSlideId(slide.id);
                        event.dataTransfer.setData("text/plain", slide.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverSlideId(slide.id);
                      }}
                      onDragLeave={() =>
                        setDragOverSlideId((current) =>
                          current === slide.id ? null : current,
                        )
                      }
                      onDrop={(event) => {
                        event.preventDefault();
                        const source =
                          event.dataTransfer.getData("text/plain") ||
                          dragSlideId;
                        if (source) moveSlide(source, slide.id);
                        setDragSlideId(null);
                        setDragOverSlideId(null);
                      }}
                      onDragEnd={() => {
                        setDragSlideId(null);
                        setDragOverSlideId(null);
                      }}
                      onKeyDown={(event) => {
                        if (!event.altKey) return;
                        if (
                          event.key !== "ArrowUp" &&
                          event.key !== "ArrowDown"
                        ) {
                          return;
                        }
                        event.preventDefault();
                        const target =
                          orderedSlides[
                            index + (event.key === "ArrowUp" ? -1 : 1)
                          ];
                        if (target) moveSlide(slide.id, target.id);
                      }}
                      title={`${slide.title || `Diapositiva ${index + 1}`} · arrastra para reordenar (Alt+↑/↓)`}
                      aria-label={`Diapositiva ${index + 1}: ${slide.title || slide.reference || "sin título"}. Arrastra para reordenar.`}
                    >
                      <span>{index + 1}</span>
                      <strong>{slide.title || slide.reference || "Diapositiva"}</strong>
                      <small>{slide.kind}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="sermon-slide-stage">
                <div className="sermon-slide-toolbar">
                  <div className="sermon-slide-nav">
                    <button
                      type="button"
                      onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))}
                      disabled={activeSlide <= 0}
                    >
                      ‹
                    </button>
                    <span>
                      {activeSlide + 1} / {Math.max(1, orderedSlides.length)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveSlide(
                          Math.min(orderedSlides.length - 1, activeSlide + 1),
                        )
                      }
                      disabled={activeSlide >= orderedSlides.length - 1}
                    >
                      ›
                    </button>
                  </div>
                  <div className="sermon-slide-backgrounds">
                    {BACKGROUND_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={preset.value === activeBackground ? "active" : ""}
                        onClick={() =>
                          activeSlideData &&
                          patchSlideSettings({
                            backgrounds: {
                              ...slideSettings.backgrounds,
                              [activeSlideData.id]: preset.value,
                            },
                          })
                        }
                        title={preset.label}
                        style={
                          preset.value
                            ? { background: preset.value }
                            : undefined
                        }
                      />
                    ))}
                    <button
                      type="button"
                      className="sermon-slide-photo"
                      onClick={() => {
                        setPixabayMode("background");
                        setPixabayOpen(true);
                      }}
                    >
                      Imagen de fondo
                    </button>
                  </div>
                  <label className="sermon-transition">
                    Transición
                    <select
                      value={
                        activeSlideData
                          ? slideSettings.transitions?.[activeSlideData.id] ?? "none"
                          : "none"
                      }
                      onChange={(event) => setSlideTransition(event.target.value)}
                    >
                      <option value="none">Sin transición</option>
                      <option value="fade">Fundido</option>
                      <option value="slide">Deslizar</option>
                      <option value="zoom">Acercar</option>
                    </select>
                  </label>
                  <div className="sermon-export-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void exportPresentation("pptx")}
                      disabled={exporting || orderedSlides.length === 0}
                    >
                      {exporting ? "Exportando…" : "Exportar PPTX"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void exportPresentation("odp")}
                      disabled={exporting || orderedSlides.length === 0}
                    >
                      {exporting ? "Exportando…" : "Exportar ODP"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void exportPresentation("pdf")}
                      disabled={exporting || orderedSlides.length === 0}
                    >
                      {exporting ? "Exportando…" : "Exportar PDF"}
                    </button>
                    <button type="button" className="primary-button" onClick={openPresentation}>
                      Presentar
                    </button>
                  </div>
                </div>
                <div className="sermon-design-bar">
                  <button
                    type="button"
                    className={designMode ? "active" : "secondary-button"}
                    onClick={() => {
                      if (designMode) {
                        setDesignMode(false);
                        setSelectedObjectId(null);
                      } else {
                        startDesign();
                      }
                    }}
                  >
                    {designMode ? "Vista" : activeLayout ? "Editar diseño" : "Diseñar"}
                  </button>
                  {designMode && (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => addTextObject("title")}
                      >
                        + Título
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => addTextObject("body")}
                      >
                        + Texto
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setPixabayMode("slide");
                          setPixabayOpen(true);
                        }}
                      >
                        + Imagen
                      </button>
                      {activeLayout && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={resetDesign}
                          title="Volver al diseño generado desde el documento"
                        >
                          Restablecer
                        </button>
                      )}
                      {activeSlideData?.kind === "custom" && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={deleteCustomSlide}
                          title="Eliminar la diapositiva en blanco"
                        >
                          Eliminar diapositiva
                        </button>
                      )}
                    </>
                  )}
                  {selectedObject && (
                    <div className="sermon-object-tools">
                      {selectedObject.type === "text" ? (
                        <>
                          <select
                            value={selectedObject.fontFamily}
                            onChange={(event) =>
                              changeObject({
                                ...selectedObject,
                                fontFamily: event.target.value,
                              })
                            }
                            aria-label="Tipografía"
                          >
                            <option value="Georgia, 'Times New Roman', serif">Georgia</option>
                            <option value="Inter, system-ui, sans-serif">Inter</option>
                            <option value="Arial, sans-serif">Arial</option>
                            <option value="'Times New Roman', serif">Times</option>
                          </select>
                          <input
                            type="number"
                            min={10}
                            max={160}
                            value={Math.round(selectedObject.fontSize)}
                            onChange={(event) =>
                              changeObject({
                                ...selectedObject,
                                fontSize: Number(event.target.value) || 12,
                              })
                            }
                            aria-label="Tamaño de letra"
                          />
                          <input
                            type="color"
                            value={
                              selectedObject.color.startsWith("#")
                                ? selectedObject.color
                                : "#F5F8FF"
                            }
                            onChange={(event) =>
                              changeObject({
                                ...selectedObject,
                                color: event.target.value,
                              })
                            }
                            aria-label="Color del texto"
                          />
                          <button
                            type="button"
                            className={selectedObject.bold ? "active" : ""}
                            onClick={() =>
                              changeObject({
                                ...selectedObject,
                                bold: !selectedObject.bold,
                              })
                            }
                            title="Negrita"
                          >
                            B
                          </button>
                          <button
                            type="button"
                            className={selectedObject.italic ? "active" : ""}
                            onClick={() =>
                              changeObject({
                                ...selectedObject,
                                italic: !selectedObject.italic,
                              })
                            }
                            title="Cursiva"
                          >
                            I
                          </button>
                          <button
                            type="button"
                            className={selectedObject.underline ? "active" : ""}
                            onClick={() =>
                              changeObject({
                                ...selectedObject,
                                underline: !selectedObject.underline,
                              })
                            }
                            title="Subrayado"
                          >
                            U
                          </button>
                          {(["left", "center", "right"] as const).map((align) => (
                            <button
                              key={align}
                              type="button"
                              className={selectedObject.align === align ? "active" : ""}
                              onClick={() =>
                                changeObject({ ...selectedObject, align })
                              }
                              title={`Alinear ${align}`}
                            >
                              {align === "left" ? "⯇" : align === "center" ? "≡" : "⯈"}
                            </button>
                          ))}
                        </>
                      ) : (
                        <>
                          <label className="sermon-object-number">
                            Ancho
                            <input
                              type="number"
                              min={40}
                              value={Math.round(selectedObject.width)}
                              onChange={(event) =>
                                changeObject({
                                  ...selectedObject,
                                  width: Number(event.target.value) || 40,
                                })
                              }
                            />
                          </label>
                          <label className="sermon-object-number">
                            Alto
                            <input
                              type="number"
                              min={30}
                              value={Math.round(selectedObject.height)}
                              onChange={(event) =>
                                changeObject({
                                  ...selectedObject,
                                  height: Number(event.target.value) || 30,
                                })
                              }
                            />
                          </label>
                          {(["top", "right", "bottom", "left"] as const).map(
                            (side) => (
                              <label className="sermon-object-number" key={side}>
                                {side === "top"
                                  ? "Sup."
                                  : side === "right"
                                    ? "Der."
                                    : side === "bottom"
                                      ? "Inf."
                                      : "Izq."}
                                <input
                                  type="number"
                                  min={0}
                                  max={40}
                                  value={Math.round(selectedCrop[side])}
                                  onChange={(event) =>
                                    changeObject({
                                      ...selectedObject,
                                      crop: {
                                        ...selectedCrop,
                                        [side]: Math.min(
                                          40,
                                          Math.max(0, Number(event.target.value) || 0),
                                        ),
                                      },
                                    })
                                  }
                                />
                              </label>
                            ),
                          )}
                        </>
                      )}
                      <label className="sermon-object-number">
                        Rotación
                        <input
                          type="number"
                          min={-180}
                          max={180}
                          value={Math.round(selectedObject.rotation ?? 0)}
                          onChange={(event) =>
                            changeObject({
                              ...selectedObject,
                              rotation: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        title="Traer al frente"
                        onClick={() => {
                          const max = Math.max(
                            0,
                            ...(activeLayout?.objects.map((item) => item.zIndex ?? 0) ?? [0]),
                          );
                          changeObject({ ...selectedObject, zIndex: max + 1 });
                        }}
                      >
                        Frente
                      </button>
                      <button
                        type="button"
                        title="Enviar atrás"
                        onClick={() => {
                          const min = Math.min(
                            0,
                            ...(activeLayout?.objects.map((item) => item.zIndex ?? 0) ?? [0]),
                          );
                          changeObject({ ...selectedObject, zIndex: min - 1 });
                        }}
                      >
                        Atrás
                      </button>
                      <label className="sermon-object-number">
                        Opacidad
                        <input
                          type="range"
                          min={0.2}
                          max={1}
                          step={0.05}
                          value={selectedObject.opacity ?? 1}
                          onChange={(event) =>
                            changeObject({
                              ...selectedObject,
                              opacity: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className={selectedObject.shadow ? "active" : ""}
                        title="Sombra"
                        onClick={() =>
                          changeObject({
                            ...selectedObject,
                            shadow: !selectedObject.shadow,
                          })
                        }
                      >
                        Sombra
                      </button>
                      <select
                        value={selectedObject.animation ?? "none"}
                        onChange={(event) =>
                          changeObject({
                            ...selectedObject,
                            animation: event.target.value as "none" | "fade" | "rise" | "zoom",
                          })
                        }
                        title="Animación de entrada del objeto"
                      >
                        <option value="none">Sin animación</option>
                        <option value="fade">Aparecer</option>
                        <option value="rise">Subir</option>
                        <option value="zoom">Zoom</option>
                      </select>
                      {selectedObject.type === "image" && (
                        <select
                          value={selectedObject.mask ?? "none"}
                          onChange={(event) =>
                            changeObject({
                              ...selectedObject,
                              mask: event.target.value as "none" | "rounded" | "circle",
                            })
                          }
                          title="Máscara de la imagen"
                        >
                          <option value="none">Sin máscara</option>
                          <option value="rounded">Redondeada</option>
                          <option value="circle">Círculo</option>
                        </select>
                      )}
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => deleteObject(selectedObject.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
                {exportStatus && <div className="sermon-export-status">{exportStatus}</div>}
                {exportError && (
                  <div className="sermon-export-error">
                    <span>{exportError}</span>
                    <button type="button" onClick={() => setExportError("")}>×</button>
                  </div>
                )}
                {activeSlideData ? (
                  activeLayout ? (
                    <SlideCanvas
                      layout={activeLayout}
                      background={activeBackground}
                      editable={designMode}
                      selectedId={selectedObjectId}
                      onSelect={setSelectedObjectId}
                      onChangeObject={changeObject}
                      onDeleteObject={deleteObject}
                    />
                  ) : (
                    <div
                      className={`sermon-slide-canvas slide-kind-${activeSlideData.kind}${activeIsLight ? " light-slide" : ""}`}
                      style={slideBackgroundStyle(activeBackground)}
                    >
                      <SlideContent slide={activeSlideData} />
                    </div>
                  )
                ) : (
                  <div className="sermon-slide-empty">
                    <strong>No hay diapositivas todavía</strong>
                    <span>
                      Crea encabezados, citas o ilustraciones en la vista Editar para
                      generar la presentación.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === "questions" && (
            <div className="sermon-questions-view">
              <header className="sermon-questions-head">
                <div>
                  <span className="eyebrow">Preguntas de estudio</span>
                  <h1>Preguntas para el grupo</h1>
                  <p>
                    Generadas a partir del bosquejo y los pasajes. Puedes añadir tus
                    propias preguntas.
                  </p>
                </div>
                <button type="button" className="secondary-button" onClick={generateQuestions}>
                  Generar desde el bosquejo
                </button>
              </header>
              <div className="sermon-question-add">
                <input
                  value={questionDraft}
                  onChange={(event) => setQuestionDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      addQuestion(questionDraft);
                      setQuestionDraft("");
                    }
                  }}
                  placeholder="Escribe una pregunta y pulsa Enter…"
                />
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    addQuestion(questionDraft);
                    setQuestionDraft("");
                  }}
                >
                  Añadir
                </button>
              </div>
              {questions.length === 0 ? (
                <div className="sermon-questions-empty">
                  <strong>Sin preguntas todavía</strong>
                  <span>
                    Pulsa «Generar desde el bosquejo» o escribe tu primera pregunta.
                  </span>
                </div>
              ) : (
                <ul className="sermon-question-list">
                  {questions.map((question) => (
                    <li key={question.id} className={question.done ? "done" : ""}>
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(question.done)}
                          onChange={(event) =>
                            updateQuestion(question.id, { done: event.target.checked })
                          }
                        />
                        <span>{question.text}</span>
                      </label>
                      <span className={`sermon-question-kind ${question.kind}`}>
                        {question.kind === "exegesis"
                          ? "Exégesis"
                          : question.kind === "application"
                            ? "Aplicación"
                            : "Propia"}
                      </span>
                      <button
                        type="button"
                        className="link-button danger-link"
                        onClick={() => removeQuestion(question.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {saveError && <div className="sermon-save-error">{saveError}</div>}
        </main>
      </div>

      <PixabayPicker
        open={pixabayOpen}
        title={
          pixabayMode === "background"
            ? "Imagen de fondo para la diapositiva"
            : pixabayMode === "slide"
              ? "Imagen para el lienzo de la diapositiva"
              : "Ilustración para el sermón"
        }
        defaultQuery={localSermon.title}
        onClose={() => {
          setPixabayOpen(false);
          pixabayApplyRef.current = null;
        }}
        onSelect={handlePixabaySelect}
      />

      {referenceOpen && (
        <div className="sermon-modal-overlay" role="dialog" aria-modal="true" aria-label="Insertar pasaje bíblico">
          <div className="sermon-reference-dialog">
            <header>
              <div>
                <span className="eyebrow">Pasaje bíblico</span>
                <h2>Insertar texto de la Biblia</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setReferenceOpen(false)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </header>
            <label>
              Referencia
              <input
                value={referenceValue}
                onChange={(event) => setReferenceValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void insertPassage(referenceValue);
                }}
                placeholder="Juan 3:16"
                autoFocus
              />
            </label>
            <label>
              Biblia
              <SelectMenu
                value={bibleId}
                onChange={setBibleId}
                ariaLabel="Biblia para extraer el pasaje"
                options={bibles.map((bible) => ({
                  value: bible.id,
                  label: bible.abbreviation || bible.title,
                }))}
              />
            </label>
            <p className="sermon-reference-hint">
              Escribe «Libro capítulo:versículo» o selecciona una referencia en el
              editor y pulsa Alt+Enter.
            </p>
            {referenceError && <div className="pixabay-error">{referenceError}</div>}
            <div className="sermon-reference-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setReferenceOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void insertPassage(referenceValue)}
              >
                Insertar pasaje
              </button>
            </div>
          </div>
        </div>
      )}

      {presenting && activeSlideData && (
        <div className="sermon-presentation" role="dialog" aria-modal="true">
          <div
            key={activeSlideData.id}
            className={`sermon-presentation-slide slide-kind-${activeSlideData.kind}${activeIsLight ? " light-slide" : ""} transition-${slideSettings.transitions?.[activeSlideData.id] ?? "none"}`}
            style={slideBackgroundStyle(activeBackground)}
          >
            {activeLayout ? (
              <SlideCanvas
                layout={activeLayout}
                background={activeBackground}
                editable={false}
                selectedId={null}
                onSelect={() => undefined}
                onChangeObject={changeObject}
              />
            ) : (
              <SlideContent slide={activeSlideData} />
            )}
          </div>
          <div className="sermon-presentation-controls">
            <button
              type="button"
              onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))}
              disabled={activeSlide <= 0}
            >
              ‹
            </button>
            <span>
              {activeSlide + 1} / {orderedSlides.length} · Esc para salir
            </span>
            <button
              type="button"
              onClick={() =>
                setActiveSlide(Math.min(sermonSlides.length - 1, activeSlide + 1))
              }
              disabled={activeSlide >= orderedSlides.length - 1}
            >
              ›
            </button>
            <button type="button" onClick={closePresentation}>
              Salir
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
