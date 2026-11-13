import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import SermonManager from "./SermonManager";
import SermonBuilder from "./SermonBuilder";
import ModuleEmblem from "./ModuleEmblem";
import {
  emptySermonDocument,
  sermonToInput,
  type Sermon,
} from "./sermonTypes";
import type { SermonBookInfo } from "./sermonRefs";
import "./Sermon.css";

const SESSION_KEY = "teoamoxtli.sermon-session.v1";

interface BibleSummary {
  id: string;
  title: string;
  abbreviation: string;
}

interface SermonWorkspaceProps {
  books: SermonBookInfo[];
  bibles: BibleSummary[];
  activeBibleId: string;
  onClose: () => void;
  onOpenCustomization: () => void;
}

interface SermonSession {
  tabs: string[];
  active: string;
  selected: string;
}

function loadSession(): SermonSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SermonSession>;
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs.filter(Boolean) : [],
      active: typeof parsed.active === "string" ? parsed.active : "manager",
      selected: typeof parsed.selected === "string" ? parsed.selected : "",
    };
  } catch {
    return null;
  }
}

function localDateTimeValue(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default function SermonWorkspace({
  books,
  bibles,
  activeBibleId,
  onClose,
  onOpenCustomization,
}: SermonWorkspaceProps) {
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState("manager");
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);

  const activeSermon = useMemo(
    () => sermons.find((sermon) => sermon.id === activeTabId) ?? null,
    [sermons, activeTabId],
  );

  async function loadSermons() {
    setLoading(true);
    try {
      const result = await invoke<Sermon[]>("sermons_list");
      setSermons(result);
      setError("");
      return result;
    } catch (issue) {
      setError(String(issue));
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSermons();
  }, []);

  useEffect(() => {
    if (loading || restored) return;
    const session = loadSession();
    setRestored(true);
    if (!session) {
      if (sermons.length > 0) setSelectedManagerId(sermons[0].id);
      return;
    }
    const validTabs = session.tabs.filter((id) =>
      sermons.some((sermon) => sermon.id === id),
    );
    setOpenTabIds(validTabs);
    if (
      session.active !== "manager" &&
      sermons.some((sermon) => sermon.id === session.active)
    ) {
      setActiveTabId(session.active);
      if (!validTabs.includes(session.active)) {
        setOpenTabIds([...validTabs, session.active]);
      }
      setSelectedManagerId(session.active);
    } else {
      setActiveTabId("manager");
      setSelectedManagerId(
        session.selected && sermons.some((sermon) => sermon.id === session.selected)
          ? session.selected
          : sermons[0]?.id ?? null,
      );
    }
  }, [loading, restored, sermons]);

  useEffect(() => {
    if (!restored) return;
    const session: SermonSession = {
      tabs: openTabIds,
      active: activeTabId,
      selected: selectedManagerId ?? "",
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }, [openTabIds, activeTabId, selectedManagerId, restored]);

  function openSermon(id: string) {
    setOpenTabIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setActiveTabId(id);
    setSelectedManagerId(id);
  }

  function showManager() {
    setActiveTabId("manager");
  }

  function closeTab(id: string) {
    const next = openTabIds.filter((tabId) => tabId !== id);
    setOpenTabIds(next);
    if (activeTabId === id) {
      const index = openTabIds.indexOf(id);
      const fallback = next[index - 1] ?? next[index] ?? "manager";
      setActiveTabId(fallback);
    }
  }

  async function createSermon() {
    setBusy(true);
    try {
      const created = await invoke<Sermon>("sermon_create", {
        input: {
          title: "Sermón sin título",
          series: "",
          seriesNumber: null,
          topics: [],
          passages: [],
          tags: [],
          speaker: "",
          venue: "",
          service: "",
          dateTime: localDateTimeValue(),
          audience: "",
          description: "",
          contentJson: emptySermonDocument(),
          questionsJson: [],
          slideSettings: { backgrounds: {}, order: [] },
        },
      });
      setSermons((current) => [created, ...current]);
      setOpenTabIds((current) =>
        current.includes(created.id) ? current : [...current, created.id],
      );
      setActiveTabId(created.id);
      setSelectedManagerId(created.id);
      setError("");
    } catch (issue) {
      setError(String(issue));
    } finally {
      setBusy(false);
    }
  }

  async function saveMetadata(sermon: Sermon) {
    setBusy(true);
    try {
      const updated = await invoke<Sermon>("sermon_update", {
        id: sermon.id,
        input: sermonToInput(sermon),
      });
      setSermons((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setError("");
    } catch (issue) {
      setError(String(issue));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSermon(id: string) {
    setBusy(true);
    try {
      await invoke("sermon_delete", { id });
      setSermons((current) => current.filter((sermon) => sermon.id !== id));
      setOpenTabIds((current) => current.filter((tabId) => tabId !== id));
      if (activeTabId === id) setActiveTabId("manager");
      if (selectedManagerId === id) setSelectedManagerId(null);
      setError("");
    } catch (issue) {
      setError(String(issue));
    } finally {
      setBusy(false);
    }
  }

  function handleSaved(updated: Sermon) {
    setSermons((current) =>
      current.map((sermon) => (sermon.id === updated.id ? updated : sermon)),
    );
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        showManager();
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createSermon();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <section className="sermons-overlay" aria-label="Sermones">
      <header className="sermons-header">
        <div className="sermons-tabbar" role="tablist" aria-label="Pestañas de sermones">
          <div className="sermons-brand">
            <span className="sermons-brand-mark"><ModuleEmblem id="sermons" size={18} /></span>
            <div>
              <strong>Sermones</strong>
              <small>Administrador y preparador</small>
            </div>
          </div>
          <button
            type="button"
            role="tab"
            aria-selected={activeTabId === "manager"}
            className={`sermons-tab${activeTabId === "manager" ? " active" : ""}`}
            onClick={showManager}
            title="Administrador de sermones (Alt+M)"
          >
            Admin. de sermones
          </button>
          {openTabIds.map((id) => {
            const sermon = sermons.find((item) => item.id === id);
            if (!sermon) return null;
            return (
              <div
                key={id}
                className={`sermons-tab sermon-tab-open${activeTabId === id ? " active" : ""}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTabId === id}
                  onClick={() => openSermon(id)}
                  title={sermon.title}
                >
                  {sermon.title || "Sermón sin título"}
                </button>
                <button
                  type="button"
                  className="sermons-tab-close"
                  onClick={() => closeTab(id)}
                  aria-label={`Cerrar ${sermon.title}`}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="sermons-tab-add"
            onClick={() => void createSermon()}
            title="Nuevo sermón (Alt+N)"
            aria-label="Nuevo sermón"
          >
            +
          </button>
        </div>
        <div className="sermons-header-actions">
          <span className="sermons-count">{sermons.length} sermones</span>
          <button type="button" className="secondary-button" onClick={() => void createSermon()} disabled={busy}>
            + Nuevo sermón
          </button>
          <button
            type="button"
            className="tool-button"
            onClick={onOpenCustomization}
            title="Personalizar interfaz"
          >
            Aa
          </button>
          <button type="button" className="icon-button" onClick={onClose} title="Cerrar sermones" aria-label="Cerrar sermones">
            ×
          </button>
        </div>
      </header>

      {error && (
        <div className="sermons-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>×</button>
        </div>
      )}

      <div className="sermons-body">
        {loading ? (
          <div className="sermons-loading">Cargando sermones…</div>
        ) : activeTabId === "manager" ? (
          <SermonManager
            sermons={sermons}
            selectedId={selectedManagerId}
            busy={busy}
            onSelect={setSelectedManagerId}
            onOpen={openSermon}
            onNew={() => void createSermon()}
            onDelete={(id) => void deleteSermon(id)}
            onSave={(sermon) => void saveMetadata(sermon)}
          />
        ) : activeSermon ? (
          <SermonBuilder
            key={activeSermon.id}
            sermon={activeSermon}
            books={books}
            bibles={bibles}
            activeBibleId={activeBibleId}
            onSaved={handleSaved}
            onOpenManager={showManager}
            onOpenCustomization={onOpenCustomization}
          />
        ) : (
          <div className="sermons-loading">No se encontró el sermón seleccionado.</div>
        )}
      </div>
    </section>
  );
}
