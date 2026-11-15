import { useEffect, useRef, useState } from "react";
import FloatingWindow from "./FloatingWindow";
import {
  PaneView,
  TYPE_LABEL,
  makePane,
  type BookInfo,
  type PaneNode,
  type PaneType,
  type Reference,
  type Resource,
} from "./ModularWorkspace";

interface FloatingBibleWindowProps {
  resources: Resource[];
  books: BookInfo[];
  initialReference: Reference;
  initialBibleId?: string;
  readerFont: string;
  readerScale: number;
  studyFont: string;
  studyScale: number;
  onClose: () => void;
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21.5zM9 7h7M9 11h5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function FloatingBibleWindow({
  resources,
  books,
  initialReference,
  initialBibleId,
  readerFont,
  readerScale,
  studyFont,
  studyScale,
  onClose,
}: FloatingBibleWindowProps) {
  const [reference, setReference] = useState<Reference>(initialReference);
  const [programmatic, setProgrammatic] = useState(true);
  const programmaticTimerRef = useRef<number | null>(null);
  const [pane, setPane] = useState<PaneNode>(() => {
    const next = makePane("bible", resources, initialReference, "A");
    const bible = initialBibleId
      ? resources.find((resource) => resource.id === initialBibleId && resource.kind === "bible")
      : undefined;
    if (bible) {
      next.state.resourceId = bible.id;
      next.tabs = next.tabs?.map((tab) => ({ ...tab, resourceId: bible.id }));
    }
    return next;
  });

  const activeResource = resources.find((resource) => resource.id === pane.state.resourceId);
  const resourceLabel =
    activeResource?.abbreviation ||
    activeResource?.title ||
    TYPE_LABEL[pane.resourceType] ||
    "Biblia";
  const kindLabel = TYPE_LABEL[pane.resourceType] ?? "Biblia";
  const bookName = books.find((book) => book.number === reference.book)?.name ?? "Pasaje";

  function markProgrammatic() {
    setProgrammatic(true);
    if (programmaticTimerRef.current) window.clearTimeout(programmaticTimerRef.current);
    programmaticTimerRef.current = window.setTimeout(() => {
      setProgrammatic(false);
      programmaticTimerRef.current = null;
    }, 1200);
  }

  useEffect(() => {
    markProgrammatic();
    return () => {
      if (programmaticTimerRef.current) window.clearTimeout(programmaticTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateReference(_paneId: string, nextReference: Reference) {
    markProgrammatic();
    setReference(nextReference);
    setPane((current) => ({
      ...current,
      state: { ...current.state, reference: { ...nextReference } },
    }));
  }

  function updateResource(_paneId: string, resourceId: string) {
    setPane((current) => {
      const activeTabId = current.activeTabId;
      return {
        ...current,
        state: { ...current.state, resourceId, spine: 0 },
        tabs: current.tabs?.map((tab) =>
          tab.id === activeTabId ? { ...tab, resourceId } : tab,
        ),
      };
    });
  }

  function updateType(_paneId: string, type: PaneType) {
    setPane((current) => ({
      ...current,
      resourceType: type,
      state: { ...current.state, resourceId: null, spine: 0 },
    }));
  }

  return (
    <FloatingWindow
      title={`${kindLabel} · ${resourceLabel}`}
      subtitle={`${bookName} ${reference.chapter}:${reference.verse}`}
      icon={<BookIcon />}
      initialWidth={760}
      initialHeight={640}
      className="floating-window-bible"
      onClose={onClose}
    >
      <div className="floating-bible-host">
        <PaneView
          pane={pane}
          canClose={false}
          resources={resources}
          books={books}
          readerFont={readerFont}
          readerScale={readerScale}
          studyFont={studyFont}
          studyScale={studyScale}
          programmatic={programmatic}
          onReference={updateReference}
          onResource={updateResource}
          onType={updateType}
          onLink={(_paneId, linkSet) =>
            setPane((current) => ({ ...current, linkSet }))
          }
          onPaneState={(_paneId, patch) =>
            setPane((current) => ({
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
    </FloatingWindow>
  );
}
