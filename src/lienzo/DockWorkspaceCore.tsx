import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createDockview,
  type DockviewApi,
  type IContentRenderer,
  type PanelInitParameters,
  type PanelUpdateEvent,
} from "dockview";
import "dockview-react/dist/styles/dockview.css";
import CanvasModuleMenu from "../CanvasModuleMenu";
import {
  PaneView,
  makePane,
  TYPE_LABEL,
  type BookInfo,
  type PaneNode,
  type PaneType,
  type Reference,
  type Resource,
} from "../ModularWorkspace";
import {
  clearCitationTarget,
  onCitationRouted,
  readCitationTarget,
  routeCitation,
  setCitationTarget,
  subscribeCitationTarget,
} from "../citationTarget";

const LAYOUT_KEY = "teoamoxtli.dock-layout.v1";
const BROKEN_KEY = "teoamoxtli.dock-layout.broken";

/** Paneles que emiten citas: su referencia viaja al destino antes que al enlace. */
const CITATION_SOURCES: ReadonlySet<PaneType> = new Set<PaneType>([
  "book",
  "ereader",
  "commentary",
  "dictionary",
  "notes",
  "search",
  "assistant",
  "sermons",
]);

interface Props {
  resources: Resource[];
  books: BookInfo[];
  initialReference: Reference;
  initialPreset?: string;
  initialBookId?: string;
  initialBookSpine?: number;
  readerFont: string;
  readerScale: number;
  studyFont: string;
  studyScale: number;
  onOpenCustomization?: () => void;
  onOpenModule?: (module: "compare" | "ereader" | "assistant" | "notes" | "sermons") => void;
  onExit: () => void;
}

interface Context {
  resources: Resource[];
  books: BookInfo[];
  initialReference: Reference;
  readerFont: string;
  readerScale: number;
  studyFont: string;
  studyScale: number;
}

function PaneHost({
  initialPane,
  context,
}: {
  initialPane: PaneNode;
  context: Context;
}) {
  const [pane, setPane] = useState(initialPane);
  const [citationTargetId, setCitationTargetId] = useState<string | null>(() =>
    readCitationTarget(),
  );
  const [programmatic, setProgrammatic] = useState(false);
  const programmaticTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setPane(initialPane);
  }, [initialPane]);

  useEffect(
    () => subscribeCitationTarget(() => setCitationTargetId(readCitationTarget())),
    [],
  );

  useEffect(
    () => () => {
      if (programmaticTimerRef.current) {
        window.clearTimeout(programmaticTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (pane.resourceType !== "bible") clearCitationTarget(pane.id);
  }, [pane.id, pane.resourceType]);

  function markProgrammatic() {
    setProgrammatic(true);
    if (programmaticTimerRef.current) {
      window.clearTimeout(programmaticTimerRef.current);
    }
    programmaticTimerRef.current = window.setTimeout(() => {
      setProgrammatic(false);
      programmaticTimerRef.current = null;
    }, 900);
  }

  // Una cita enrutada entra directo a esta Biblia, sin tocar el grupo de enlace.
  useEffect(
    () =>
      onCitationRouted((detail) => {
        if (detail.targetPaneId !== pane.id) return;
        markProgrammatic();
        setPane((current) => ({
          ...current,
          state: { ...current.state, reference: { ...detail.reference } },
        }));
      }),
    [pane.id],
  );

  useEffect(() => {
    const onLink = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        sourceId: string;
        linkSet: string;
        reference: Reference;
      };
      if (
        detail.sourceId !== pane.id &&
        detail.linkSet !== "none" &&
        detail.linkSet === pane.linkSet &&
        ["bible", "commentary", "interlinear", "compare", "book", "notes"].includes(
          pane.resourceType,
        )
      ) {
        setPane((current) => ({
          ...current,
          state: { ...current.state, reference: { ...detail.reference } },
        }));
      }
    };
    window.addEventListener("teo-dock-link", onLink);
    return () => window.removeEventListener("teo-dock-link", onLink);
  }, [pane.id, pane.linkSet, pane.resourceType]);

  function change(updater: (current: PaneNode) => PaneNode) {
    setPane((current) => updater(current));
  }

  const isCitationTarget =
    pane.resourceType === "bible" && citationTargetId === pane.id;

  const activeResource = context.resources.find((resource) => resource.id === pane.state.resourceId);
  const identityTitle = activeResource?.title
    ?? (pane.state.resourceId || TYPE_LABEL[pane.resourceType as keyof typeof TYPE_LABEL] || "Panel");
  const identityAbbreviation = activeResource?.abbreviation || TYPE_LABEL[pane.resourceType as keyof typeof TYPE_LABEL] || "";
  const identityKind = activeResource?.kind ?? pane.resourceType;

  return (
    <div
      className={`dock-panel-host pane-appearance-${pane.state.appearance ?? "inherit"}${isCitationTarget ? " is-citation-target" : ""}${programmatic ? " is-citation-received" : ""}`}
    >
      <div className="dock-pane-identity">
        <span className={`dock-pane-identity-icon ${identityKind}`} aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d={identityKind === "bible" ? "M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21.5zM9 7h7M9 11h5" : identityKind === "commentary" ? "M4 5h16v14H4zM8 9h8M8 13h5" : "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="dock-pane-identity-copy">
          <strong>{identityTitle}</strong>
          <small>{identityAbbreviation}{identityKind ? ` · ${identityKind}` : ""}</small>
        </div>
        {pane.resourceType === "bible" && pane.state.resourceId && (
          <button
            type="button"
            className={`dock-citation-target${isCitationTarget ? " active" : ""}`}
            aria-pressed={isCitationTarget}
            onClick={() => setCitationTarget(isCitationTarget ? null : pane.id)}
            title={
              isCitationTarget
                ? "Esta Biblia recibe las citas de libros, EPUB y comentarios. Pulsa para quitar el destino."
                : "Destino de la referencia: recibir aquí las citas bíblicas de libros, EPUB y comentarios."
            }
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="6.4" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="12" cy="12" r="2.1" fill="currentColor" />
              <path
                d="M12 2.4v2.6M12 19v2.6M2.4 12H5M19 12h2.6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            <span>{isCitationTarget ? "Destino activo" : "Destino"}</span>
          </button>
        )}
      </div>

      <div className="dock-pane-controls">
        <button
          type="button"
          onClick={() => change((current) => ({ ...current, state: { ...current.state, fontScale: Math.max(0.75, (current.state.fontScale ?? 1) - 0.1) } }))}
          title="Reducir letra del panel"
        >A−</button>
        <button
          type="button"
          onClick={() => change((current) => ({ ...current, state: { ...current.state, fontScale: Math.min(1.8, (current.state.fontScale ?? 1) + 0.1) } }))}
          title="Aumentar letra del panel"
        >A+</button>
        <div className="dock-link-set-picker" role="group" aria-label="Grupo de enlace A–F">
          {(["none", "A", "B", "C", "D", "E", "F"] as const).map((set) => (
            <button
              key={set}
              type="button"
              className={pane.linkSet === set ? "active" : ""}
              data-link={set}
              title={set === "none" ? "Sin enlace" : `Grupo de enlace ${set}`}
              onClick={() => {
                change((current) => ({ ...current, linkSet: set }));
                window.dispatchEvent(new CustomEvent("teo-dock-link", {
                  detail: { sourceId: pane.id, linkSet: set, reference: pane.state.reference },
                }));
              }}
            >
              {set === "none" ? "—" : set}
            </button>
          ))}
        </div>
        <select
          value={pane.state.appearance ?? "inherit"}
          onChange={(event) => change((current) => ({ ...current, state: { ...current.state, appearance: event.target.value as typeof current.state.appearance } }))}
          title="Aspecto del panel"
        >
          <option value="inherit">Tema</option>
          <option value="light">Claro</option>
          <option value="sepia">Sepia</option>
          <option value="dark">Oscuro</option>
          <option value="contrast">Contraste</option>
        </select>
      </div>
      <div className="dock-pane-scaled" style={{ zoom: pane.state.fontScale ?? 1 }}>
      <PaneView
        pane={pane}
        canClose
        resources={context.resources}
        books={context.books}
        readerFont={context.readerFont}
        readerScale={context.readerScale}
        studyFont={context.studyFont}
        studyScale={context.studyScale}
        programmatic={programmatic}
        onReference={(_id, reference) => {
          const targetId = readCitationTarget();
          const routesToDestination =
            CITATION_SOURCES.has(pane.resourceType) &&
            !!targetId &&
            targetId !== pane.id;

          change((current) => ({
            ...current,
            state: { ...current.state, reference: { ...reference } },
          }));

          if (routesToDestination && targetId) {
            // La cita ignora los grupos de enlace y aterriza solo en el destino.
            routeCitation({
              targetPaneId: targetId,
              sourcePaneId: pane.id,
              reference,
            });
            return;
          }

          window.dispatchEvent(
            new CustomEvent("teo-dock-link", {
              detail: {
                sourceId: pane.id,
                linkSet: pane.linkSet,
                reference,
              },
            }),
          );
        }}
        onResource={(_id, resourceId) =>
          change((current) => ({
            ...current,
            state: { ...current.state, resourceId, spine: 0 },
          }))
        }
        onType={(_id, type) =>
          change((current) => ({
            ...current,
            resourceType: type,
            state: { ...current.state, resourceId: null, spine: 0 },
          }))
        }
        onLink={(_id, linkSet) => change((current) => ({ ...current, linkSet }))}
        onPaneState={(_id, patch) =>
          change((current) => ({
            ...current,
            state: { ...current.state, ...patch },
          }))
        }
        onSplit={() => undefined}
        onClose={() => undefined}
        onSwap={() => undefined}
        onAddTab={() => undefined}
        onSwitchTab={() => undefined}
        onCloseTab={() => undefined}
        onDragStart={() => undefined}
        onOpenStrong={() => undefined}
      />
      </div>
    </div>
  );
}

class SpikeRenderer implements IContentRenderer {
  readonly element = document.createElement("div");
  private root: ReturnType<typeof createRoot> | null = null;
  private pane: PaneNode | null = null;
  private context: Context;

  constructor(context: Context) {
    this.context = context;
    this.element.className = "dock-panel-renderer";
  }

  init(parameters: PanelInitParameters): void {
    try {
      this.pane = parameters.params.pane as PaneNode;
      this.root = createRoot(this.element);
      this.render();
    } catch (issue) {
      this.element.innerHTML = `<pre class="dock-panel-error">${String(issue)}</pre>`;
    }
  }

  update(event: PanelUpdateEvent): void {
    const next = event.params?.pane as PaneNode | undefined;
    if (next) {
      this.pane = next;
      this.render();
    }
  }

  private render() {
    if (!this.root || !this.pane) return;
    this.root.render(<PaneHost initialPane={this.pane} context={this.context} />);
  }

  dispose(): void {
    const root = this.root;
    queueMicrotask(() => root?.unmount());
    this.root = null;
  }
}


function panelTitle(resources: Resource[], pane: PaneNode) {
  const resource = resources.find((item) => item.id === pane.state.resourceId);
  return (
    resource?.abbreviation ||
    resource?.title ||
    TYPE_LABEL[pane.resourceType] ||
    "Panel"
  );
}

/**
 * Construye la disposición anunciada por una tarjeta de Entornos. Antes el
 * preset se ignoraba en el motor dockview y siempre se restauraba el último
 * diseño guardado.
 */
function buildPresetLayout(
  api: DockviewApi,
  preset: string,
  resources: Resource[],
  reference: Reference,
) {
  api.clear();
  const bibles = resources.filter((item) => item.kind === "bible");

  const add = (
    kind: PaneType,
    linkSet: "A" | "none",
    options: {
      bibleIndex?: number;
      position?: {
        referencePanel: string;
        direction: "left" | "right" | "above" | "below" | "within";
      };
      width?: number;
      height?: number;
      title?: string;
    } = {},
  ) => {
    const pane = makePane(kind, resources, reference, linkSet);
    if (kind === "bible" && (options.bibleIndex ?? 0) > 0) {
      const pick = bibles[options.bibleIndex ?? 0] ?? bibles[0];
      if (pick) {
        pane.state.resourceId = pick.id;
        pane.tabs = pane.tabs?.map((tab) => ({ ...tab, resourceId: pick.id }));
      }
    }
    api.addPanel({
      id: pane.id,
      component: "pane",
      title: options.title ?? panelTitle(resources, pane),
      params: { pane },
      ...(options.position ? { position: options.position } : {}),
      initialWidth: options.width,
      initialHeight: options.height,
    });
    return pane;
  };

  if (preset === "reading" || preset === "bible") {
    add("bible", "A");
    return;
  }

  if (preset === "bible-commentary") {
    const bible = add("bible", "A");
    add("commentary", "A", {
      position: { referencePanel: bible.id, direction: "right" },
      width: 460,
    });
    return;
  }

  if (preset === "compare") {
    const first = add("bible", "A", { title: "Biblia 1" });
    const second = add("bible", "A", {
      bibleIndex: 1,
      title: "Biblia 2",
      position: { referencePanel: first.id, direction: "right" },
      width: 460,
    });
    add("commentary", "A", {
      position: { referencePanel: second.id, direction: "right" },
      width: 440,
    });
    return;
  }

  if (preset === "avanzado-compare") {
    const bible = add("bible", "A");
    const compare = add("compare", "A", {
      position: { referencePanel: bible.id, direction: "right" },
      width: 500,
    });
    add("commentary", "A", {
      position: { referencePanel: compare.id, direction: "right" },
      width: 420,
    });
    return;
  }

  if (preset === "avanzado-original") {
    const bible = add("bible", "A");
    const interlinear = add("interlinear", "A", {
      position: { referencePanel: bible.id, direction: "right" },
      width: 480,
    });
    add("commentary", "A", {
      position: { referencePanel: bible.id, direction: "below" },
      height: 320,
    });
    add("dictionary", "none", {
      position: { referencePanel: interlinear.id, direction: "below" },
      height: 320,
    });
    return;
  }

  if (preset === "seminary") {
    const bible = add("bible", "A");
    const book = add("book", "A", {
      position: { referencePanel: bible.id, direction: "right" },
      width: 480,
    });
    add("commentary", "A", {
      position: { referencePanel: book.id, direction: "right" },
      width: 420,
    });
    return;
  }

  if (preset === "grid4") {
    const first = add("bible", "A", { title: "Biblia 1" });
    const second = add("bible", "A", {
      bibleIndex: 1,
      title: "Biblia 2",
      position: { referencePanel: first.id, direction: "right" },
      width: 460,
    });
    add("commentary", "A", {
      position: { referencePanel: first.id, direction: "below" },
      height: 320,
    });
    add("book", "A", {
      position: { referencePanel: second.id, direction: "below" },
      height: 320,
    });
    return;
  }

  // Estudio bíblico integrado (también es el diseño de arranque).
  const bible = add("bible", "A");
  const commentary = add("commentary", "A", {
    position: { referencePanel: bible.id, direction: "right" },
    width: 520,
  });
  add("dictionary", "none", {
    position: { referencePanel: commentary.id, direction: "below" },
    height: 300,
  });
}

function balancePresetLayout(api: DockviewApi, preset: string) {
  const total = api.width || 1200;
  const panelOf = (type: PaneType, index = 0) =>
    api.panels.filter(
      (panel) => (panel.params?.pane as PaneNode | undefined)?.resourceType === type,
    )[index];
  const resize = (
    panel: ReturnType<typeof panelOf> | undefined,
    width: number,
  ) => {
    if (!panel) return;
    try {
      panel.api.group.api.setSize({ width });
    } catch {
      /* la agrupación todavía no está montada */
    }
  };

  if (preset === "seminary") {
    // Biblia 36% · Libro 40% · Comentario 24%: el libro deja de quedar aplastado.
    resize(panelOf("bible"), Math.round(total * 0.36));
    resize(panelOf("book"), Math.round(total * 0.4));
    return;
  }
  if (preset === "compare") {
    resize(panelOf("bible", 0), Math.round(total * 0.34));
    resize(panelOf("bible", 1), Math.round(total * 0.33));
    return;
  }
  if (preset === "avanzado-compare") {
    resize(panelOf("bible"), Math.round(total * 0.4));
    resize(panelOf("compare"), Math.round(total * 0.35));
  }
}

function applyInitialBook(
  api: DockviewApi,
  resources: Resource[],
  bookId: string | undefined,
  spine: number | undefined,
) {
  if (!bookId) return;
  const resource = resources.find((item) => item.id === bookId);
  for (const panel of api.panels) {
    const pane = panel.params?.pane as PaneNode | undefined;
    if (pane?.resourceType !== "book") continue;
    panel.api.updateParameters({
      pane: {
        ...pane,
        state: { ...pane.state, resourceId: bookId, spine: spine ?? 0 },
        tabs: pane.tabs?.map((tab) => ({ ...tab, resourceId: bookId })),
      },
    });
    if (resource) panel.api.setTitle(resource.title || resource.abbreviation || "Libro");
  }
}

export default function DockWorkspaceCore({
  resources,
  books,
  initialReference,
  initialPreset,
  initialBookId,
  initialBookSpine,
  readerFont,
  readerScale,
  studyFont,
  studyScale,
  onExit,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<DockviewApi | null>(null);
  const initialReferenceRef = useRef(initialReference);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);
  const [citationTargetId, setCitationTargetId] = useState<string | null>(() =>
    readCitationTarget(),
  );

  initialReferenceRef.current = initialReference;

  useEffect(
    () => subscribeCitationTarget(() => setCitationTargetId(readCitationTarget())),
    [],
  );

  const targetPanel =
    citationTargetId && apiRef.current
      ? apiRef.current.panels.find((panel) => panel.id === citationTargetId)
      : undefined;
  const targetPane = targetPanel?.params?.pane as PaneNode | undefined;
  const targetResource = targetPane
    ? resources.find((resource) => resource.id === targetPane.state.resourceId)
    : undefined;
  const targetLabel =
    targetResource?.abbreviation || targetResource?.title || "Biblia";

  function addResource(resource: Resource) {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.panels.find(
      (panel: { params?: Record<string, unknown>; api: { setActive: () => void } }) =>
        (panel.params?.pane as PaneNode | undefined)?.state.resourceId === resource.id,
    );
    if (existing) {
      existing.api.setActive();
      setPaletteOpen(false);
      return;
    }
    const kind =
      resource.kind === "bible" ||
      resource.kind === "commentary" ||
      resource.kind === "dictionary" ||
      resource.kind === "book"
        ? resource.kind
        : "book";
    const pane = makePane(kind, resources, initialReference, kind === "dictionary" ? "none" : "A");
    const active = api.activePanel;
    api.addPanel({
      id: pane.id,
      component: "pane",
      title: resource.title || resource.abbreviation,
      params: { pane },
      ...(active ? { position: { referencePanel: active.id, direction: "within" } } : {}),
    });
    setPaletteOpen(false);
  }

  function addModule(type: "compare" | "ereader" | "assistant" | "notes" | "sermons") {
    const api = apiRef.current;
    if (!api) return;
    const pane = makePane(type as any, resources, initialReference, "A", true);
    api.addPanel({ id: pane.id, component: "pane", title: type === "ereader" ? "eReader" : type === "assistant" ? "Asistente" : type === "sermons" ? "Sermones" : type === "notes" ? "Notas" : "Comparador", params: { pane } });
    setModuleMenuOpen(false);
  }

  /** Abre otra traducción a la derecha, para poder elegir la Biblia destino. */
  function addBible() {
    const api = apiRef.current;
    if (!api) return;
    const bibles = resources.filter((resource) => resource.kind === "bible");
    if (bibles.length === 0) return;
    const openIds = new Set(
      api.panels.map(
        (panel) => (panel.params?.pane as PaneNode | undefined)?.state.resourceId,
      ),
    );
    const unused = bibles.find((bible) => !openIds.has(bible.id));
    const pane = makePane("bible", resources, initialReferenceRef.current, "A", false);
    if (unused) {
      pane.state.resourceId = unused.id;
      pane.tabs = pane.tabs?.map((tab) => ({ ...tab, resourceId: unused.id }));
    }
    const active = api.activePanel;
    api.addPanel({
      id: pane.id,
      component: "pane",
      title: unused ? panelTitle(resources, pane) : "Biblia",
      params: { pane },
      ...(active
        ? { position: { referencePanel: active.id, direction: "right" as const } }
        : {}),
      initialWidth: 520,
    });
    setPaletteOpen(false);
  }

  useEffect(() => {
    if (!moduleMenuOpen) return;
    const onModuleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModuleMenuOpen(false);
    };
    window.addEventListener("keydown", onModuleKey);
    return () => window.removeEventListener("keydown", onModuleKey);
  }, [moduleMenuOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const paletteResources = resources.filter(
    (resource) =>
      ["bible", "commentary", "dictionary", "book"].includes(resource.kind) &&
      (!paletteQuery.trim() ||
        `${resource.title} ${resource.abbreviation}`.toLowerCase().includes(paletteQuery.trim().toLowerCase())),
  );

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const context: Context = {
        resources,
        books,
        initialReference: initialReferenceRef.current,
        readerFont,
        readerScale,
        studyFont,
        studyScale,
      };
      const api: DockviewApi = createDockview(hostRef.current, {
        createComponent: () => new SpikeRenderer(context),
      });
      apiRef.current = api;
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (initialPreset) {
        buildPresetLayout(api, initialPreset, resources, initialReferenceRef.current);
      } else if (raw) {
        try {
          api.fromJSON(JSON.parse(raw));
        } catch {
          localStorage.setItem(BROKEN_KEY, raw);
          localStorage.removeItem(LAYOUT_KEY);
          buildPresetLayout(api, "study", resources, initialReferenceRef.current);
        }
      } else {
        buildPresetLayout(api, "study", resources, initialReferenceRef.current);
      }
      applyInitialBook(api, resources, initialBookId, initialBookSpine);
      let saveDisposable: { dispose: () => void } | null = null;
      let removeDisposable: { dispose: () => void } | null = null;
      requestAnimationFrame(() => {
        api.layout(hostRef.current!.clientWidth, hostRef.current!.clientHeight);
        setReady(true);
        if (initialPreset) {
          requestAnimationFrame(() => {
            balancePresetLayout(api, initialPreset);
            localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
          });
        }
        // Conserva el diseño recién abierto, también cuando viene de Entornos.
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
        // Un destino que ya no existe no debe quedar armado.
        const armed = readCitationTarget();
        if (armed && !api.panels.some((panel) => panel.id === armed)) {
          setCitationTarget(null);
        }
        removeDisposable = api.onDidRemovePanel((panel) => {
          clearCitationTarget(panel.id);
        });
        saveDisposable = api.onDidLayoutChange(() => {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
        });
      });
      return () => {
        saveDisposable?.dispose();
        removeDisposable?.dispose();
        apiRef.current = null;
        api.dispose();
      };
    } catch (issue) {
      setError(String(issue));
    }
    // Solo el preset reconstruye el Lienzo; la referencia inicial se lee del ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPreset]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    applyInitialBook(api, resources, initialBookId, initialBookSpine);
    // Solo cambia el libro de los paneles de Libro; no reconstruye el Lienzo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBookId, initialBookSpine]);

  return (
    <div className="modular-overlay dockv2-overlay">
      <div className="dockv2-topbar">
        <div>
          <span className="eyebrow">Lienzo</span>
          <strong>Espacio de estudio</strong>
        </div>
        <div className="dockv2-topbar-actions">
          <button type="button" onClick={() => setPaletteOpen((current) => !current)}>Abrir recurso</button>
          <button
            type="button"
            onClick={addBible}
            title="Abrir otra traducción a la derecha de este panel"
          >
            Biblia +
          </button>
          <div className="modular-module-menu-wrap">
            <button type="button" onClick={() => setModuleMenuOpen((current) => !current)}>Abrir módulo</button>
            {moduleMenuOpen && <CanvasModuleMenu onClose={() => setModuleMenuOpen(false)} onSelect={(id) => addModule(id)} />}
          </div>

          {citationTargetId && targetPanel && (
            <span
              className="dockv2-citation-target"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              title="Las citas bíblicas de libros, EPUB y comentarios se abren en esta Biblia."
            >
              <span className="dockv2-citation-target-dot" aria-hidden="true" />
              <span>
                Citas → <strong>{targetLabel}</strong>
              </span>
              <button
                type="button"
                onClick={() => setCitationTarget(null)}
                title="Quitar la Biblia destino"
                aria-label={`Quitar ${targetLabel} como Biblia destino`}
              >
                ×
              </button>
            </span>
          )}

          <span>{error ? `error: ${error}` : ready ? "dockview" : "montando…"}</span>
          <button type="button" onClick={onExit}>Cerrar lienzo</button>
        </div>
      </div>
      {paletteOpen && (
        <div className="dock-resource-palette">
          <input
            autoFocus
            value={paletteQuery}
            onChange={(event) => setPaletteQuery(event.target.value)}
            placeholder="Buscar recurso…"
          />
          <div>
            {paletteResources.map((resource) => (
              <button type="button" key={resource.id} onClick={() => addResource(resource)}>
                <strong>{resource.title}</strong>
                <small>{resource.kind}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      <div ref={hostRef} className="dockv2-core-host" />
    </div>
  );
}
