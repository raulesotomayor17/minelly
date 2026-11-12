import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SermonSlide } from "./sermonStore";
import type {
  SlideLayout,
  SlideObject,
  SlideTextObject,
} from "./sermonTypes";

const DESIGN_W = 1280;
const DESIGN_H = 720;

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `obj-${Date.now()}-${Math.random()}`;
}

export function isLightBackground(value: string): boolean {
  const hex = value.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false;
  const channel = (start: number) =>
    Number.parseInt(hex.slice(start, start + 2), 16);
  const luminance =
    (channel(0) * 299 + channel(2) * 587 + channel(4) * 114) / 1000;
  return luminance > 160;
}

function backgroundStyle(value: string): CSSProperties {
  if (value.startsWith("data:") || value.startsWith("http")) {
    return {
      backgroundImage: `url("${value}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { background: value || "#101722" };
}

function textObject(
  role: SlideTextObject["role"],
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  color: string,
  extra: Partial<SlideTextObject> = {},
): SlideTextObject {
  return {
    id: newId(),
    type: "text",
    text,
    x,
    y,
    width,
    height,
    fontSize,
    fontFamily: "Georgia, 'Times New Roman', serif",
    bold: role === "title",
    italic: role === "quote",
    underline: false,
    color,
    align: role === "quote" ? "center" : "left",
    role,
    ...extra,
  };
}

export function createSlideLayout(
  slide: SermonSlide,
  background: string,
): SlideLayout {
  const color = isLightBackground(background) ? "#1F232B" : "#F5F8FF";
  const objects: SlideObject[] = [];
  const body = slide.body.join("\n");

  if (slide.kind === "illustration" && slide.imageUrl) {
    objects.push({
      id: newId(),
      type: "image",
      url: slide.imageUrl,
      x: 58,
      y: 88,
      width: 560,
      height: 544,
      radius: 12,
    });
    objects.push(
      textObject(
        "title",
        slide.title || "Ilustración",
        660,
        130,
        540,
        150,
        48,
        color,
      ),
    );
    if (body) {
      objects.push(textObject("body", body, 660, 300, 540, 300, 28, color));
    }
  } else if (slide.kind === "quote") {
    objects.push(
      textObject("quote", body || slide.title, 140, 165, 1000, 390, 46, color),
    );
  } else if (slide.kind === "title") {
    objects.push(textObject("title", slide.title, 90, 205, 1100, 190, 78, color));
    if (body) {
      objects.push(textObject("body", body, 90, 430, 950, 170, 30, color));
    }
  } else if (slide.kind === "passage") {
    objects.push(
      textObject(
        "title",
        slide.reference || slide.title,
        90,
        100,
        1100,
        120,
        48,
        color,
      ),
    );
    if (body) {
      objects.push(textObject("body", body, 90, 255, 1100, 360, 32, color));
    }
  } else if (slide.kind === "text") {
    objects.push(textObject("body", body || slide.title, 90, 100, 1100, 520, 36, color));
  } else {
    objects.push(textObject("title", slide.title, 90, 90, 1100, 150, 54, color));
    if (body) {
      objects.push(textObject("body", body, 90, 270, 1100, 350, 30, color));
    }
  }

  return { objects };
}

interface SlideCanvasProps {
  layout: SlideLayout;
  background: string;
  editable: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChangeObject: (object: SlideObject) => void;
  onDeleteObject?: (id: string) => void;
}

type InteractionMode =
  | "move"
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

const HANDLES: Array<{ mode: InteractionMode; className: string }> = [
  { mode: "nw", className: "nw" },
  { mode: "n", className: "n" },
  { mode: "ne", className: "ne" },
  { mode: "e", className: "e" },
  { mode: "se", className: "se" },
  { mode: "s", className: "s" },
  { mode: "sw", className: "sw" },
  { mode: "w", className: "w" },
];

export default function SlideCanvas({
  layout,
  background,
  editable,
  selectedId,
  onSelect,
  onChangeObject,
  onDeleteObject,
}: SlideCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      if (host.clientWidth > 0) setScale(host.clientWidth / DESIGN_W);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  function beginInteraction(
    event: ReactPointerEvent,
    object: SlideObject,
    mode: InteractionMode,
  ) {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(object.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...object };
    const handleMove = (moveEvent: PointerEvent) => {
      let x = origin.x;
      let y = origin.y;
      let width = origin.width;
      let height = origin.height;
      const dx = (moveEvent.clientX - startX) / scale;
      const dy = (moveEvent.clientY - startY) / scale;
      if (mode === "move") {
        x += dx;
        y += dy;
      } else {
        if (mode.includes("e")) width += dx;
        if (mode.includes("s")) height += dy;
        if (mode.includes("w")) {
          x += dx;
          width -= dx;
        }
        if (mode.includes("n")) {
          y += dy;
          height -= dy;
        }
      }
      const minWidth = 70;
      const minHeight = 38;
      if (width < minWidth) {
        if (mode.includes("w")) x -= minWidth - width;
        width = minWidth;
      }
      if (height < minHeight) {
        if (mode.includes("n")) y -= minHeight - height;
        height = minHeight;
      }
      x = Math.max(0, Math.min(DESIGN_W - width, x));
      y = Math.max(0, Math.min(DESIGN_H - height, y));
      width = Math.min(DESIGN_W - x, width);
      height = Math.min(DESIGN_H - y, height);
      onChangeObject({ ...origin, x, y, width, height } as SlideObject);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function beginRotate(event: ReactPointerEvent, object: SlideObject) {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(object.id);
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const centerX = rect.left + (object.x + object.width / 2) * scale;
    const centerY = rect.top + (object.y + object.height / 2) * scale;
    const startAngle = Math.atan2(
      event.clientY - centerY,
      event.clientX - centerX,
    );
    const startRotation = object.rotation ?? 0;
    const handleMove = (moveEvent: PointerEvent) => {
      const angle = Math.atan2(
        moveEvent.clientY - centerY,
        moveEvent.clientX - centerX,
      );
      let degrees =
        startRotation + ((angle - startAngle) * 180) / Math.PI;
      if (moveEvent.shiftKey) degrees = Math.round(degrees / 15) * 15;
      degrees = ((degrees + 180) % 360 + 360) % 360 - 180;
      onChangeObject({ ...object, rotation: degrees } as SlideObject);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <div
      ref={hostRef}
      className={`sermon-slide-canvas slide-object-canvas ${isLightBackground(background) ? "light-slide" : ""}`}
      style={backgroundStyle(background)}
      onPointerDown={() => onSelect(null)}
    >
      <div
        className="slide-design"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${scale})`,
        }}
      >
        {[...layout.objects]
          .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
          .map((object) => {
          const selected = object.id === selectedId;
          const commonStyle: CSSProperties = {
            position: "absolute",
            left: object.x,
            top: object.y,
            width: object.width,
            height: object.height,
            transform: `rotate(${object.rotation ?? 0}deg)`,
            transformOrigin: "center",
            zIndex: object.zIndex ?? 0,
            opacity: object.opacity ?? 1,
            boxShadow: object.shadow
              ? "0 18px 45px rgba(0, 0, 0, 0.45)"
              : undefined,
            ["--object-rotation" as string]: `${object.rotation ?? 0}deg`,
          } as CSSProperties;
          if (object.type === "image") {
            const crop = object.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
            const cropWidth = Math.max(1, 100 - crop.left - crop.right);
            const cropHeight = Math.max(1, 100 - crop.top - crop.bottom);
            return (
              <div
                key={object.id}
                className={`slide-object slide-image-object object-animation-${object.animation ?? "none"}${selected ? " selected" : ""}`}
                style={{
                  ...commonStyle,
                  borderRadius:
                    object.mask === "circle"
                      ? "50%"
                      : object.mask === "rounded"
                        ? 18
                        : object.radius ?? 8,
                  clipPath:
                    object.mask === "circle" ? "circle(50%)" : undefined,
                }}
                onPointerDown={(event) => {
                  if (editable) beginInteraction(event, object, "move");
                  else onSelect(object.id);
                }}
              >
                <div className="slide-image-clip">
                  <img
                    src={object.url}
                    alt=""
                    draggable={false}
                    style={{
                      width: `${(100 / cropWidth) * 100}%`,
                      height: `${(100 / cropHeight) * 100}%`,
                      left: `${(-crop.left / cropWidth) * 100}%`,
                      top: `${(-crop.top / cropHeight) * 100}%`,
                    }}
                  />
                </div>
                {editable && selected && (
                  <>
                    <span
                      className="slide-object-move"
                      onPointerDown={(event) => beginInteraction(event, object, "move")}
                      title="Mover imagen"
                    >
                      ✥
                    </span>
                    <span
                      className="slide-rotate-handle"
                      onPointerDown={(event) => beginRotate(event, object)}
                      title="Arrastra para rotar · Shift para pasos de 15°"
                    >
                      ↻
                    </span>
                    {HANDLES.map((handle) => (
                      <span
                        key={handle.mode}
                        className={`slide-resize-handle ${handle.className}`}
                        onPointerDown={(event) =>
                          beginInteraction(event, object, handle.mode)
                        }
                      />
                    ))}
                  </>
                )}
              </div>
            );
          }
          const textStyle: CSSProperties = {
            fontSize: object.fontSize,
            fontFamily: object.fontFamily,
            fontWeight: object.bold ? 700 : 400,
            fontStyle: object.italic ? "italic" : "normal",
            textDecoration: object.underline ? "underline" : "none",
            color: object.color,
            textAlign: object.align,
            lineHeight: 1.22,
            whiteSpace: "pre-wrap",
          };
          return (
            <div
              key={object.id}
              className={`slide-object slide-text-object object-animation-${object.animation ?? "none"}${selected ? " selected" : ""}`}
              style={commonStyle}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect(object.id);
              }}
            >
              {editable ? (
                <textarea
                  value={object.text}
                  onChange={(event) =>
                    onChangeObject({ ...object, text: event.target.value })
                  }
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onSelect(object.id);
                  }}
                  spellCheck={false}
                  aria-label="Texto de la diapositiva"
                  style={textStyle}
                />
              ) : (
                <div style={textStyle}>{object.text}</div>
              )}
              {editable && selected && (
                <>
                  <span
                    className="slide-object-move"
                    onPointerDown={(event) => beginInteraction(event, object, "move")}
                    title="Mover texto"
                  >
                    ✥
                  </span>
                  <span
                    className="slide-rotate-handle"
                    onPointerDown={(event) => beginRotate(event, object)}
                    title="Arrastra para rotar · Shift para pasos de 15°"
                  >
                    ↻
                  </span>
                  {HANDLES.map((handle) => (
                    <span
                      key={handle.mode}
                      className={`slide-resize-handle ${handle.className}`}
                      onPointerDown={(event) =>
                        beginInteraction(event, object, handle.mode)
                      }
                    />
                  ))}
                </>
              )}
              {editable && selected && onDeleteObject && (
                <button
                  type="button"
                  className="slide-object-delete"
                  title="Eliminar objeto"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteObject(object.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { DESIGN_H, DESIGN_W };
