import { useEffect, useRef, useState } from "react";

const VIEW = 268;
const OUTPUT = 320;

export default function AvatarCropper({ source, onCancel, onApply }: { source: string; onCancel: () => void; onApply: (dataUrl: string) => void }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = source;
  }, [source]);

  const baseScale = image ? Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight) : 1;
  const scale = baseScale * zoom;
  const width = image ? image.naturalWidth * scale : VIEW;
  const height = image ? image.naturalHeight * scale : VIEW;
  const maxX = Math.max(0, (width - VIEW) / 2);
  const maxY = Math.max(0, (height - VIEW) / 2);

  function clamp(next: { x: number; y: number }) {
    return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    setOffset(clamp({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY }));
  }

  function onPointerUp() { dragRef.current = null; }

  function apply() {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT; canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sourceSize = VIEW / scale;
    const sourceX = image.naturalWidth / 2 - (VIEW / 2 + offset.x) / scale;
    const sourceY = image.naturalHeight / 2 - (VIEW / 2 + offset.y) / scale;
    ctx.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, OUTPUT, OUTPUT);
    onApply(canvas.toDataURL("image/jpeg", 0.9));
  }

  return (
    <div className="avatar-cropper">
      <header>
        <div><span className="eyebrow">Fotografía de perfil</span><h3>Ajusta tu encuadre</h3></div>
        <button type="button" onClick={onCancel} aria-label="Cancelar recorte">×</button>
      </header>
      <div className="avatar-crop-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {image && <img src={source} alt="Vista previa del recorte" draggable={false} style={{ width, height, left: `calc(50% + ${offset.x}px)`, top: `calc(50% + ${offset.y}px)` }} />}
        <div className="avatar-crop-mask" aria-hidden="true" />
      </div>
      <p className="avatar-crop-hint">Arrastra la fotografía para centrarla. Usa el control para acercar.</p>
      <label className="avatar-zoom"><span>Acercamiento</span><input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => { setZoom(Number(event.target.value)); setOffset((current) => clamp(current)); }} /><strong>{zoom.toFixed(1)}×</strong></label>
      <footer>
        <button type="button" className="link-button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>Centrar</button>
        <span />
        <button type="button" className="secondary-button" onClick={onCancel}>Cancelar</button>
        <button type="button" className="primary-button" onClick={apply}>Usar esta foto</button>
      </footer>
    </div>
  );
}
