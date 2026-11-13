type ModuleId = "compare" | "ereader" | "assistant" | "notes" | "sermons";

const ITEMS: Array<{ id: ModuleId; label: string; detail: string; group: string; path: string }> = [
  { id: "compare", label: "Comparador", detail: "Versiones en paralelo", group: "Lectura", path: "M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z" },
  { id: "ereader", label: "eReader", detail: "EPUB, MOBI y AZW3", group: "Lectura", path: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5zM8 7h8M8 11h6" },
  { id: "assistant", label: "Asistente", detail: "Cátedra y Arnés", group: "Estudio", path: "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" },
  { id: "notes", label: "Notas", detail: "Cuadernos y anclas", group: "Estudio", path: "M5 3h11l3 3v15H5zM8 9h8M8 13h8M8 17h5" },
  { id: "sermons", label: "Sermones", detail: "Bosquejo y presentación", group: "Estudio", path: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M8 21h8" },
];

export default function CanvasModuleMenu({ onSelect, onClose }: { onSelect: (id: ModuleId) => void; onClose: () => void }) {
  const groups = ["Lectura", "Estudio"];
  return (
    <div className="canvas-module-menu" role="menu" aria-label="Abrir módulo en el Lienzo" onMouseDown={(event) => event.stopPropagation()}>
      <header className="canvas-module-menu-head">
        <div>
          <span className="canvas-module-menu-kicker">Lienzo</span>
          <strong>Abrir módulo</strong>
        </div>
        <button type="button" className="canvas-module-menu-close" onClick={onClose} aria-label="Cerrar menú">×</button>
      </header>
      {groups.map((group) => (
        <section key={group} className="canvas-module-menu-group">
          <span className="canvas-module-menu-label">{group}</span>
          {ITEMS.filter((item) => item.group === group).map((item) => (
            <button key={item.id} type="button" role="menuitem" className={`canvas-module-item ${item.id}`} onClick={() => onSelect(item.id)}>
              <span className="canvas-module-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d={item.path} stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="canvas-module-copy">
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              <span className="canvas-module-arrow" aria-hidden="true">›</span>
            </button>
          ))}
        </section>
      ))}
      <footer className="canvas-module-menu-foot"><kbd>Esc</kbd><span>para cerrar</span></footer>
    </div>
  );
}
