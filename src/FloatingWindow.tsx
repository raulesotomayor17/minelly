import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

interface FloatingWindowProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  initialWidth?: number;
  initialHeight?: number;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export default function FloatingWindow({
  title,
  subtitle,
  icon,
  initialWidth = 760,
  initialHeight = 640,
  className,
  onClose,
  children,
}: FloatingWindowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);
  const restoreRef = useRef<WindowRect | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [rect, setRect] = useState<WindowRect>(() => {
    const width = Math.min(initialWidth, Math.max(360, window.innerWidth - 48));
    const height = Math.min(initialHeight, Math.max(300, window.innerHeight - 80));
    return {
      x: Math.max(12, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(12, Math.round((window.innerHeight - height) / 2)),
      width,
      height,
    };
  });

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    const onResize = () => {
      setRect((current) => ({
        x: clamp(current.x, 0, window.innerWidth - 160),
        y: clamp(current.y, 0, window.innerHeight - 60),
        width: Math.min(current.width, Math.max(340, window.innerWidth - 8)),
        height: Math.min(current.height, Math.max(280, window.innerHeight - 8)),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (maximized) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      x: rect.x,
      y: rect.y,
    };
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setRect((current) => ({
      ...current,
      x: clamp(drag.x + event.clientX - drag.startX, 0, window.innerWidth - 160),
      y: clamp(drag.y + event.clientY - drag.startY, 0, window.innerHeight - 60),
    }));
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* el puntero ya se liberó */
    }
  }

  function startResize(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
    };
  }

  function moveResize(event: ReactPointerEvent<HTMLElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    setRect((current) => ({
      ...current,
      width: clamp(resize.width + event.clientX - resize.startX, 340, window.innerWidth - current.x - 8),
      height: clamp(resize.height + event.clientY - resize.startY, 280, window.innerHeight - current.y - 8),
    }));
  }

  function endResize(event: ReactPointerEvent<HTMLElement>) {
    resizeRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* el puntero ya se liberó */
    }
  }

  function toggleMaximize() {
    if (maximized) {
      if (restoreRef.current) setRect(restoreRef.current);
      restoreRef.current = null;
      setMaximized(false);
      return;
    }
    restoreRef.current = rect;
    setRect({ x: 8, y: 8, width: window.innerWidth - 16, height: window.innerHeight - 16 });
    setMaximized(true);
  }

  return (
    <div
      ref={rootRef}
      className={`floating-window${className ? ` ${className}` : ""}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
    >
      <header
        className="floating-window-head"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {icon && <span className="floating-window-icon" aria-hidden="true">{icon}</span>}
        <div className="floating-window-copy">
          <strong>{title}</strong>
          {subtitle && <small>{subtitle}</small>}
        </div>
        <div className="floating-window-actions">
          <button
            type="button"
            onClick={toggleMaximize}
            title={maximized ? "Restaurar ventana" : "Maximizar ventana"}
            aria-label={maximized ? "Restaurar ventana" : "Maximizar ventana"}
          >
            {maximized ? "❐" : "□"}
          </button>
          <button type="button" onClick={onClose} title="Cerrar ventana" aria-label="Cerrar ventana">
            ×
          </button>
        </div>
      </header>
      <div className="floating-window-body">{children}</div>
      <span
        className="floating-window-resize"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        aria-hidden="true"
      />
    </div>
  );
}
