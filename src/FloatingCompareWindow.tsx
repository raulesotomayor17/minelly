import CompareWorkspace from "./CompareWorkspace";
import FloatingWindow from "./FloatingWindow";

interface FloatingCompareWindowProps {
  bibles: Array<{ id: string; title: string; abbreviation: string }>;
  books: Array<{ number: number; name: string }>;
  initialBook: number;
  initialChapter: number;
  initialVerse: number;
  onClose: () => void;
}

function CompareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function FloatingCompareWindow({
  bibles,
  books,
  initialBook,
  initialChapter,
  initialVerse,
  onClose,
}: FloatingCompareWindowProps) {
  const bookName = books.find((book) => book.number === initialBook)?.name ?? "Pasaje";
  return (
    <FloatingWindow
      title="Comparador de versiones"
      subtitle={`${bookName} ${initialChapter} · ${bibles.length} versiones`}
      icon={<CompareIcon />}
      initialWidth={1120}
      initialHeight={720}
      className="floating-window-compare"
      onClose={onClose}
    >
      <div className="floating-compare-host">
        <CompareWorkspace
          bibles={bibles}
          books={books}
          initialBook={initialBook}
          initialChapter={initialChapter}
          initialVerse={initialVerse}
          onClose={onClose}
        />
      </div>
    </FloatingWindow>
  );
}
