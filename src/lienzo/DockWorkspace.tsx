import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { DockviewReact, themeDark, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import {
  PaneView,
  makePane,
  type BookInfo,
  type PaneNode,
  type PaneState,
  type PaneType,
  type Reference,
  type Resource,
} from "../ModularWorkspace";

interface DockWorkspaceProps {
  resources: Resource[];
  books: BookInfo[];
  initialReference: Reference;
  readerFont: string;
  readerScale: number;
  studyFont: string;
  studyScale: number;
  onOpenCustomization?: () => void;
  onExit: () => void;
}

interface DockContextValue {
  resources: Resource[];
  books: BookInfo[];
  readerFont: string;
  readerScale: number;
  studyFont: string;
  studyScale: number;
}

const DockContext = createContext<DockContextValue | null>(null);
const LAYOUT_KEY = "teoamoxtli.dock-layout.v1";
const BROKEN_KEY = "teoamoxtli.dock-layout.broken";

function titleFor(resources: Resource[], kind: PaneType, resourceId: string | null) {
  const resource = resources.find((item) => item.id === resourceId);
  return resource?.abbreviation || resource?.title || kind;
}

function DockPanel(props: IDockviewPanelProps<{ pane: PaneNode }>) {
  const context = useContext(DockContext);
  const [pane, setPane] = useState<PaneNode>(props.params.pane);

  useEffect(() => {
    const subscription = props.api.onDidParametersChange((parameters) => {
      const next = parameters?.pane as PaneNode | undefined;
      if (next) setPane(next);
    });
    return () => subscription.dispose();
  }, [props.api]);

  if (!context) return null;

  function updatePane(updater: (current: PaneNode) => PaneNode) {
    setPane((current) => {
      const next = updater(current);
      props.api.updateParameters({ pane: next });
      return next;
    });
  }

  const onResource = (_paneId: string, resourceId: string) => {
    updatePane((current) => ({
      ...current,
      state: { ...current.state, resourceId, spine: 0 },
    }));
    props.api.setTitle(titleFor(context.resources, pane.resourceType, resourceId));
  };

  const onType = (_paneId: string, type: PaneType) => {
    updatePane((current) => ({
      ...current,
      resourceType: type,
      state: { ...current.state, resourceId: null, spine: 0 },
    }));
    props.api.setTitle(type);
  };

  const onPaneState = (_paneId: string, patch: Partial<PaneState>) => {
    updatePane((current) => ({
      ...current,
      state: { ...current.state, ...patch },
    }));
  };

  return (
    <div className="dock-panel-host">
      <PaneView
        pane={pane}
        canClose
        resources={context.resources}
        books={context.books}
        readerFont={context.readerFont}
        readerScale={context.readerScale}
        studyFont={context.studyFont}
        studyScale={context.studyScale}
        onReference={(_paneId, reference) => {
          updatePane((current) => ({
            ...current,
            state: { ...current.state, reference: { ...reference } },
          }));
          if (pane.linkSet !== "none") {
            for (const target of props.containerApi.panels) {
              if (target.id === pane.id) continue;
              const targetPane = target.params?.pane as PaneNode | undefined;
              if (
                targetPane &&
                targetPane.linkSet === pane.linkSet &&
                ["bible", "commentary", "interlinear", "compare"].includes(
                  targetPane.resourceType,
                )
              ) {
                target.api.updateParameters({
                  pane: {
                    ...targetPane,
                    state: {
                      ...targetPane.state,
                      reference: { ...reference },
                    },
                  },
                });
              }
            }
          }
        }}
        onResource={onResource}
        onType={onType}
        onLink={(_paneId, linkSet) =>
          updatePane((current) => ({ ...current, linkSet }))
        }
        onPaneState={onPaneState}
        onSplit={() => undefined}
        onClose={() => props.api.close()}
        onSwap={() => undefined}
        onAddTab={() => undefined}
        onSwitchTab={() => undefined}
        onCloseTab={() => undefined}
        onDragStart={() => undefined}
        onOpenStrong={() => undefined}
      />
    </div>
  );
}

type TemplateId = "estudio" | "comparar" | "idiomasOriginales" | "sermon" | "lectura" | "video";

const TEMPLATE_LABELS: Record<TemplateId, string> = {
  estudio: "Estudio",
  comparar: "Comparar versiones",
  idiomasOriginales: "Idiomas originales",
  sermon: "Preparar sermón",
  lectura: "Solo lectura",
  video: "Estudio de pasaje",
};

function addPane(
  api: DockviewReadyEvent["api"],
  resources: Resource[],
  reference: Reference,
  kind: PaneType,
  linkSet: "A" | "B" | "C" | "D" | "E" | "F" | "none",
  position?: { referencePanel: string; direction: "right" | "left" | "above" | "below" | "within" },
  title?: string,
) {
  const pane = makePane(kind, resources, reference, linkSet);
  api.addPanel({
    id: pane.id,
    component: "pane",
    title:
      title ??
      titleFor(resources, pane.resourceType, pane.state.resourceId),
    params: { pane },
    ...(position ? { position } : {}),
    initialWidth: position?.direction === "right" ? 540 : undefined,
    initialHeight: position?.direction === "below" ? 300 : undefined,
  });
  return pane;
}

function buildTemplate(
  api: DockviewReadyEvent["api"],
  template: TemplateId,
  resources: Resource[],
  reference: Reference,
) {
  api.clear();
  if (template === "lectura") {
    addPane(api, resources, reference, "bible", "none");
    return;
  }
  const bible = addPane(api, resources, reference, "bible", "A");
  if (template === "estudio") {
    const commentary = addPane(api, resources, reference, "commentary", "A", {
      referencePanel: bible.id,
      direction: "right",
    });
    addPane(api, resources, reference, "interlinear", "A", {
      referencePanel: commentary.id,
      direction: "within",
    });
    const dictionary = addPane(api, resources, reference, "dictionary", "none", {
      referencePanel: commentary.id,
      direction: "below",
    });
    addPane(api, resources, reference, "notes", "none", {
      referencePanel: dictionary.id,
      direction: "within",
    });
    return;
  }
  if (template === "comparar") {
    addPane(api, resources, reference, "compare", "A", {
      referencePanel: bible.id,
      direction: "right",
    });
    return;
  }
  if (template === "idiomasOriginales") {
    const interlinear = addPane(api, resources, reference, "interlinear", "A", {
      referencePanel: bible.id,
      direction: "right",
    });
    addPane(api, resources, reference, "dictionary", "none", {
      referencePanel: interlinear.id,
      direction: "below",
    });
    return;
  }
  if (template === "sermon") {
    addPane(api, resources, reference, "notes", "none", {
      referencePanel: bible.id,
      direction: "right",
    });
    return;
  }
  // video: comparación, comentario+notas, Biblia y libro
  const compare = addPane(api, resources, reference, "compare", "A", {
    referencePanel: bible.id,
    direction: "right",
  });
  addPane(api, resources, reference, "commentary", "A", {
    referencePanel: compare.id,
    direction: "within",
  });
  addPane(api, resources, reference, "notes", "none", {
    referencePanel: compare.id,
    direction: "within",
  });
}


function buildKnownGoodStudyLayout(
  api: DockviewReadyEvent["api"],
  resources: Resource[],
  reference: Reference,
) {
  const bible = makePane("bible", resources, reference, "A");
  const commentary = makePane("commentary", resources, reference, "A");
  const interlinear = makePane("interlinear", resources, reference, "A");
  const dictionary = makePane("dictionary", resources, reference, "none");
  const notes = makePane("notes", resources, reference, "none");
  api.addPanel({
    id: bible.id,
    component: "pane",
    title: titleFor(resources, bible.resourceType, bible.state.resourceId),
    params: { pane: bible },
  });
  api.addPanel({
    id: commentary.id,
    component: "pane",
    title: titleFor(resources, commentary.resourceType, commentary.state.resourceId),
    params: { pane: commentary },
    position: { referencePanel: bible.id, direction: "right" },
    initialWidth: 520,
  });
  api.addPanel({
    id: interlinear.id,
    component: "pane",
    title: "Interlineal",
    params: { pane: interlinear },
    position: { referencePanel: commentary.id, direction: "within" },
  });
  api.addPanel({
    id: dictionary.id,
    component: "pane",
    title: titleFor(resources, dictionary.resourceType, dictionary.state.resourceId),
    params: { pane: dictionary },
    position: { referencePanel: commentary.id, direction: "below" },
    initialHeight: 300,
  });
  api.addPanel({
    id: notes.id,
    component: "pane",
    title: "Notas",
    params: { pane: notes },
    position: { referencePanel: dictionary.id, direction: "within" },
  });
}

export default function DockWorkspace({
  resources,
  books,
  initialReference,
  readerFont,
  readerScale,
  studyFont,
  studyScale,
  onExit,
}: DockWorkspaceProps) {
  const apiRef = useRef<DockviewReadyEvent["api"] | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState("");
  const [template, setTemplate] = useState<TemplateId>("estudio");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");

  function openResource(resourceId: string, kind: PaneType) {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.panels.find(
      (panel) => (panel.params?.pane as PaneNode | undefined)?.state.resourceId === resourceId,
    );
    if (existing) {
      existing.api.setActive();
      setPaletteOpen(false);
      return;
    }
    const active = api.activePanel;
    addPane(
      api,
      resources,
      initialReference,
      kind,
      ["bible", "commentary", "interlinear", "compare"].includes(kind) ? "A" : "none",
      active
        ? { referencePanel: active.id, direction: "within" }
        : undefined,
    );
    setPaletteOpen(false);
  }

  useEffect(() => {
    const onError = (event: ErrorEvent) => setDebug(`error: ${event.message}`);
    const onRejection = (event: PromiseRejectionEvent) =>
      setDebug(`rejection: ${String(event.reason)}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    const timer = window.setTimeout(() => {
      setDebug((current) =>
        current ||
        `root=${document.querySelector<HTMLElement>(".dockv2-root")?.clientHeight ?? 0} dock=${document.querySelector<HTMLElement>(".dockv2-dock")?.clientHeight ?? 0}`,
      );
    }, 2500);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.clearTimeout(timer);
    };
  }, []);

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

  const paletteEntries = [
    ...resources
      .filter((resource) =>
        ["bible", "commentary", "dictionary", "book"].includes(resource.kind),
      )
      .map((resource) => ({
        key: resource.id,
        label: resource.title,
        hint: resource.kind,
        kind: resource.kind as PaneType,
        resourceId: resource.id,
      })),
    { key: "tool:interlinear", label: "Interlineal", hint: "herramienta", kind: "interlinear" as PaneType, resourceId: "" },
    { key: "tool:compare", label: "Comparador", hint: "herramienta", kind: "compare" as PaneType, resourceId: "" },
    { key: "tool:notes", label: "Notas", hint: "herramienta", kind: "notes" as PaneType, resourceId: "" },
    { key: "tool:search", label: "Buscar", hint: "herramienta", kind: "search" as PaneType, resourceId: "" },
  ].filter((entry) =>
    !paletteQuery.trim() ||
    `${entry.label} ${entry.hint}`.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
  );

  function onReady(event: DockviewReadyEvent) {
    apiRef.current = event.api;
    setReady(true);
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        event.api.fromJSON(JSON.parse(raw));
      } else {
        buildKnownGoodStudyLayout(event.api, resources, initialReference);
      }
    } catch (issue) {
      setError(String(issue));
      localStorage.setItem(BROKEN_KEY, localStorage.getItem(LAYOUT_KEY) ?? "");
      localStorage.removeItem(LAYOUT_KEY);
      try {
        buildKnownGoodStudyLayout(event.api, resources, initialReference);
      } catch (fallbackIssue) {
        setError(String(fallbackIssue));
      }
    }

    event.api.onDidLayoutChange(() => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        if (apiRef.current) {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(apiRef.current.toJSON()));
        }
      }, 400);
    });
  }

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const context: DockContextValue = {
    resources,
    books,
    readerFont,
    readerScale,
    studyFont,
    studyScale,
  };

  return (
    <div className="modular-overlay dockv2-overlay">
      <div className="dockv2-topbar">
        <div>
          <span className="eyebrow">Lienzo</span>
          <strong>Espacio de estudio</strong>
        </div>
        <div className="dockv2-topbar-actions">
          <button type="button" onClick={() => setPaletteOpen((current) => !current)}>
            Abrir recurso
          </button>
          <select
            value={template}
            onChange={(event) => {
              const next = event.target.value as TemplateId;
              setTemplate(next);
              if (apiRef.current) {
                buildTemplate(apiRef.current, next, resources, initialReference);
              }
            }}
            aria-label="Plantilla del lienzo"
          >
            {Object.entries(TEMPLATE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span>{error ? `error: ${error}` : ready ? "dockview" : "cargando…"}</span>
          <span className="dockv2-debug">{debug}</span>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem("teoamoxtli.dock-engine", "legacy");
              window.location.reload();
            }}
          >
            Motor anterior
          </button>
          <button type="button" onClick={onExit}>Cerrar lienzo</button>
        </div>
      </div>
      {paletteOpen && (
        <div className="dock-resource-palette">
          <input
            autoFocus
            value={paletteQuery}
            onChange={(event) => setPaletteQuery(event.target.value)}
            placeholder="Buscar recurso o herramienta…"
          />
          <div>
            {paletteEntries.map((entry) => (
              <button
                type="button"
                key={entry.key}
                onClick={() => openResource(entry.resourceId, entry.kind)}
              >
                <strong>{entry.label}</strong>
                <small>{entry.hint}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      <DockContext.Provider value={context}>
        <div className="dockv2-root" style={{ height: "calc(100vh - 44px)" }}>
          <DockviewReact
            components={{ pane: DockPanel }}
            onReady={onReady}
            theme={themeDark}
            className="dockv2-dock"
          />
        </div>
      </DockContext.Provider>
    </div>
  );
}
