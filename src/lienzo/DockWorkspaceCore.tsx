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
  type Reference,
  type Resource,
} from "../ModularWorkspace";

const LAYOUT_KEY = "teoamoxtli.dock-layout.v1";
const BROKEN_KEY = "teoamoxtli.dock-layout.broken";

interface Props {
  resources: Resource[];
  books: BookInfo[];
  initialReference: Reference;
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

  useEffect(() => {
    setPane(initialPane);
  }, [initialPane]);

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

  const activeResource = context.resources.find((resource) => resource.id === pane.state.resourceId);
  const identityTitle = activeResource?.title
    ?? (pane.state.resourceId || TYPE_LABEL[pane.resourceType as keyof typeof TYPE_LABEL] || "Panel");
  const identityAbbreviation = activeResource?.abbreviation || TYPE_LABEL[pane.resourceType as keyof typeof TYPE_LABEL] || "";
  const identityKind = activeResource?.kind ?? pane.resourceType;

  return (
    <div className={`dock-panel-host pane-appearance-${pane.state.appearance ?? "inherit"}`}>
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
        onReference={(_id, reference) => {
          change((current) => ({
            ...current,
            state: { ...current.state, reference: { ...reference } },
          }));
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


export default function DockWorkspaceCore({
  resources,
  books,
  initialReference,
  readerFont,
  readerScale,
  studyFont,
  studyScale,
  onExit,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<DockviewApi | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);

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
        initialReference,
        readerFont,
        readerScale,
        studyFont,
        studyScale,
      };
      const api: DockviewApi = createDockview(hostRef.current, {
        createComponent: () => new SpikeRenderer(context),
      });
      apiRef.current = api;
      const buildInitial = () => {
        const bible = makePane("bible", resources, initialReference, "A");
        const commentary = makePane("commentary", resources, initialReference, "A");
        const dictionary = makePane("dictionary", resources, initialReference, "none");
        api.addPanel({
          id: bible.id,
          component: "pane",
          title: "Biblia",
          params: { pane: bible },
        });
        api.addPanel({
          id: commentary.id,
          component: "pane",
          title: "Comentario",
          params: { pane: commentary },
          position: { referencePanel: bible.id, direction: "right" },
        });
        api.addPanel({
          id: dictionary.id,
          component: "pane",
          title: "Diccionario",
          params: { pane: dictionary },
          position: { referencePanel: commentary.id, direction: "below" },
        });
      };
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        try {
          api.fromJSON(JSON.parse(raw));
        } catch {
          localStorage.setItem(BROKEN_KEY, raw);
          localStorage.removeItem(LAYOUT_KEY);
          buildInitial();
        }
      } else {
        buildInitial();
      }
      let saveDisposable: { dispose: () => void } | null = null;
      requestAnimationFrame(() => {
        api.layout(hostRef.current!.clientWidth, hostRef.current!.clientHeight);
        setReady(true);
        saveDisposable = api.onDidLayoutChange(() => {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
        });
      });
      return () => {
        saveDisposable?.dispose();
        apiRef.current = null;
        api.dispose();
      };
    } catch (issue) {
      setError(String(issue));
    }
  }, [initialReference]);

  return (
    <div className="modular-overlay dockv2-overlay">
      <div className="dockv2-topbar">
        <div>
          <span className="eyebrow">Lienzo</span>
          <strong>Espacio de estudio</strong>
        </div>
        <div className="dockv2-topbar-actions">
          <button type="button" onClick={() => setPaletteOpen((current) => !current)}>Abrir recurso</button>
          <div className="modular-module-menu-wrap">
            <button type="button" onClick={() => setModuleMenuOpen((current) => !current)}>Abrir módulo</button>
            {moduleMenuOpen && <CanvasModuleMenu onClose={() => setModuleMenuOpen(false)} onSelect={(id) => addModule(id)} />}
          </div>

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
