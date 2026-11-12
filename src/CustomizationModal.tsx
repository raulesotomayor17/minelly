import { THEME_META } from "./themes";
import { useEffect, useRef, useState } from "react";
import {
  ACCENT_PRESETS,
  READER_PAPER_PRESETS,
  UI_FONT_OPTIONS,
  useUiCustomizationStore,
  type UiDensity,
} from "./uiCustomizationStore";

export function PaperModePicker({ compact = false }: { compact?: boolean }) {
  const ui = useUiCustomizationStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const activePreset =
    READER_PAPER_PRESETS.find((item) => item.id === ui.readerPaper) ??
    READER_PAPER_PRESETS[0];

  const swatchBg =
    activePreset.id === "theme"
      ? "linear-gradient(135deg, #1b2436 50%, #f5efe2 50%)"
      : activePreset.id === "custom"
        ? ui.readerCustomBg
        : activePreset.bg;

  return (
    <div className="paper-picker-wrap" ref={rootRef}>
      <button
        type="button"
        className={open ? "tool-button paper-trigger active" : "tool-button paper-trigger"}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Color del lienzo de lectura (Blanco, Sepia, Crema, Salvia, Pizarra, OLED)"
      >
        <span className="paper-trigger-dot" style={{ background: swatchBg }} />
        <span>{compact ? "Papel" : `Lienzo: ${activePreset.label}`}</span>
      </button>

      {open && (
        <div className="paper-popover" role="menu">
          <div className="format-popover-heading">
            <strong>Color del lienzo de lectura</strong>
            <span>Visualiza en blanco, sepia, crema u otros modos sin cambiar tus menús</span>
          </div>

          <div className="paper-popover-grid">
            {READER_PAPER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={
                  ui.readerPaper === preset.id ? "paper-preset-chip active" : "paper-preset-chip"
                }
                onClick={() => ui.update({ readerPaper: preset.id })}
              >
                <span
                  className="paper-swatch-preview"
                  style={{
                    background:
                      preset.id === "theme"
                        ? "linear-gradient(135deg, #1b2436 50%, #f5efe2 50%)"
                        : preset.id === "custom"
                          ? ui.readerCustomBg
                          : preset.bg,
                    color:
                      preset.id === "theme"
                        ? "#ffffff"
                        : preset.id === "custom"
                          ? ui.readerCustomInk
                          : preset.ink,
                    borderColor: preset.id === "theme" ? "var(--border)" : preset.border,
                  }}
                >
                  Aa
                </span>
                <span>{preset.label}</span>
              </button>
            ))}
          </div>

          {ui.readerPaper === "custom" && (
            <div className="paper-custom-colors">
              <label className="paper-color-field">
                <span>Fondo</span>
                <div>
                  <input
                    type="color"
                    value={ui.readerCustomBg}
                    onChange={(event) => ui.update({ readerCustomBg: event.target.value })}
                  />
                  <code>{ui.readerCustomBg}</code>
                </div>
              </label>
              <label className="paper-color-field">
                <span>Letra</span>
                <div>
                  <input
                    type="color"
                    value={ui.readerCustomInk}
                    onChange={(event) => ui.update({ readerCustomInk: event.target.value })}
                  />
                  <code>{ui.readerCustomInk}</code>
                </div>
              </label>
            </div>
          )}

          <div className="paper-popover-controls">
            <label className="paper-popover-row">
              <span>Vista de hoja de documento (tipo Word)</span>
              <input
                type="checkbox"
                checked={ui.readerSheetStyle === "sheet"}
                onChange={(event) =>
                  ui.update({ readerSheetStyle: event.target.checked ? "sheet" : "full" })
                }
              />
            </label>
            <label className="paper-popover-row">
              <span>Aplicar también en Comentario, Diccionario y Módulos</span>
              <input
                type="checkbox"
                checked={ui.readerPaperScope === "all"}
                onChange={(event) =>
                  ui.update({
                    readerPaperScope: event.target.checked ? "all" : "reader-only",
                  })
                }
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

interface CustomizationModalProps {
  theme: string;
  onThemeChange: (theme: string) => void;
  readerFont: string;
  onReaderFontChange: (font: string) => void;
  fontScale: number;
  onFontScaleChange: (scale: number) => void;
  studyFont: string;
  onStudyFontChange: (font: string) => void;
  studyFontScale: number;
  onStudyFontScaleChange: (scale: number) => void;
  fontOptions: { value: string; label: string }[];
  onClose: () => void;
}

export default function CustomizationModal({
  theme,
  onThemeChange,
  readerFont,
  onReaderFontChange,
  fontScale,
  onFontScaleChange,
  studyFont,
  onStudyFontChange,
  studyFontScale,
  onStudyFontScaleChange,
  fontOptions,
  onClose,
}: CustomizationModalProps) {
  const ui = useUiCustomizationStore();

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="customization-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Personalización y customización del sistema"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-heading">
          <div>
            <span className="eyebrow">Ingeniería de Interfaz</span>
            <h2>Personalización del Sistema</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Cerrar personalización"
            title="Cerrar"
          >
            ✕
          </button>
        </div>

        <p className="drawer-copy">
          Ajusta en tiempo real el color del lienzo de lectura (modo papel blanco, crema,
          sepia, salvia u oscuro), el tamaño de letra de los menús superiores, pestañas,
          barra lateral, densidad de controles y comportamiento de notas.
        </p>

        <div className="custom-section">
          <div className="custom-section-header">
            <strong>Lienzo de lectura y modo papel (Biblia y Módulos)</strong>
            <span>
              Cambia el fondo del área de lectura sin alterar el tema de los menús superiores
            </span>
          </div>

          <div className="paper-preset-grid">
            {READER_PAPER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={
                  ui.readerPaper === preset.id ? "paper-preset-chip active" : "paper-preset-chip"
                }
                onClick={() => ui.update({ readerPaper: preset.id })}
              >
                <span
                  className="paper-swatch-preview"
                  style={{
                    background:
                      preset.id === "theme"
                        ? "linear-gradient(135deg, #1b2436 50%, #f5efe2 50%)"
                        : preset.id === "custom"
                          ? ui.readerCustomBg
                          : preset.bg,
                    color:
                      preset.id === "theme"
                        ? "#ffffff"
                        : preset.id === "custom"
                          ? ui.readerCustomInk
                          : preset.ink,
                    borderColor: preset.id === "theme" ? "var(--border)" : preset.border,
                  }}
                >
                  Aa
                </span>
                <span>{preset.label}</span>
              </button>
            ))}
          </div>

          {ui.readerPaper === "custom" && (
            <div className="paper-custom-colors">
              <label className="paper-color-field">
                <span>Fondo del lienzo</span>
                <div>
                  <input
                    type="color"
                    value={ui.readerCustomBg}
                    onChange={(event) => ui.update({ readerCustomBg: event.target.value })}
                  />
                  <code>{ui.readerCustomBg}</code>
                </div>
              </label>
              <label className="paper-color-field">
                <span>Color de letra (tinta)</span>
                <div>
                  <input
                    type="color"
                    value={ui.readerCustomInk}
                    onChange={(event) => ui.update({ readerCustomInk: event.target.value })}
                  />
                  <code>{ui.readerCustomInk}</code>
                </div>
              </label>
            </div>
          )}

          <div className="paper-options-row">
            <div className="paper-option-group">
              <span className="paper-option-label">Disposición del lienzo</span>
              <div className="segmented">
                <button
                  type="button"
                  className={ui.readerSheetStyle === "full" ? "active" : ""}
                  onClick={() => ui.update({ readerSheetStyle: "full" })}
                >
                  Lienzo completo
                </button>
                <button
                  type="button"
                  className={ui.readerSheetStyle === "sheet" ? "active" : ""}
                  onClick={() => ui.update({ readerSheetStyle: "sheet" })}
                >
                  Hoja de documento
                </button>
              </div>
            </div>

            <div className="paper-option-group">
              <span className="paper-option-label">Aplicar color de lectura en</span>
              <div className="segmented">
                <button
                  type="button"
                  className={ui.readerPaperScope === "all" ? "active" : ""}
                  onClick={() => ui.update({ readerPaperScope: "all" })}
                >
                  Biblia y todos los módulos
                </button>
                <button
                  type="button"
                  className={ui.readerPaperScope === "reader-only" ? "active" : ""}
                  onClick={() => ui.update({ readerPaperScope: "reader-only" })}
                >
                  Solo lector principal
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="custom-section">
          <div className="custom-section-header">
            <strong>Perfiles rápidos de tamaño</strong>
            <span>Escala global de menús con un clic</span>
          </div>
          <div className="custom-preset-grid">
            <button
              type="button"
              className="secondary-button"
              onClick={() => ui.applyPreset("compact")}
            >
              Compacto (12 px)
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => ui.applyPreset("standard")}
            >
              Estándar (13.5 px)
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => ui.applyPreset("large")}
            >
              Grande (15.5 px)
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => ui.applyPreset("xl")}
            >
              Extra Grande (17.5 px)
            </button>
          </div>
        </div>

        <div className="custom-section">
          <div className="custom-section-header">
            <strong>Tamaño de letra de Menús y Barras</strong>
            <span>Barra superior, selectores de libro/versión, modo de lectura y formato</span>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Letra de menús y selectores</span>
              <strong>{ui.menuFontSize.toFixed(1)} px</strong>
            </label>
            <div className="custom-slider-group">
              <button
                type="button"
                className="tool-button"
                onClick={() =>
                  ui.update({ menuFontSize: Math.max(10, Number((ui.menuFontSize - 0.5).toFixed(1))) })
                }
              >
                A−
              </button>
              <input
                type="range"
                min={10}
                max={21}
                step={0.5}
                value={ui.menuFontSize}
                onChange={(event) => ui.update({ menuFontSize: Number(event.target.value) })}
              />
              <button
                type="button"
                className="tool-button"
                onClick={() =>
                  ui.update({ menuFontSize: Math.min(21, Number((ui.menuFontSize + 0.5).toFixed(1))) })
                }
              >
                A+
              </button>
            </div>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Letra de pestañas (Comentario / Diccionario / Notas)</span>
              <strong>{ui.panelTabFontSize.toFixed(1)} px</strong>
            </label>
            <div className="custom-slider-group">
              <button
                type="button"
                className="tool-button"
                onClick={() =>
                  ui.update({
                    panelTabFontSize: Math.max(10, Number((ui.panelTabFontSize - 0.5).toFixed(1))),
                  })
                }
              >
                A−
              </button>
              <input
                type="range"
                min={10}
                max={20}
                step={0.5}
                value={ui.panelTabFontSize}
                onChange={(event) => ui.update({ panelTabFontSize: Number(event.target.value) })}
              />
              <button
                type="button"
                className="tool-button"
                onClick={() =>
                  ui.update({
                    panelTabFontSize: Math.min(20, Number((ui.panelTabFontSize + 0.5).toFixed(1))),
                  })
                }
              >
                A+
              </button>
            </div>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Letra de barra lateral izquierda</span>
              <strong>{ui.sidebarFontSize.toFixed(1)} px</strong>
            </label>
            <div className="custom-slider-group">
              <button
                type="button"
                className="tool-button"
                onClick={() =>
                  ui.update({
                    sidebarFontSize: Math.max(10, Number((ui.sidebarFontSize - 0.5).toFixed(1))),
                  })
                }
              >
                A−
              </button>
              <input
                type="range"
                min={10}
                max={20}
                step={0.5}
                value={ui.sidebarFontSize}
                onChange={(event) => ui.update({ sidebarFontSize: Number(event.target.value) })}
              />
              <button
                type="button"
                className="tool-button"
                onClick={() =>
                  ui.update({
                    sidebarFontSize: Math.min(20, Number((ui.sidebarFontSize + 0.5).toFixed(1))),
                  })
                }
              >
                A+
              </button>
            </div>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Ancho de la barra lateral</span>
              <strong>{ui.sidebarWidth} px</strong>
            </label>
            <div className="custom-slider-group">
              <input
                type="range"
                min={180}
                max={310}
                step={4}
                value={ui.sidebarWidth}
                onChange={(event) => ui.update({ sidebarWidth: Number(event.target.value) })}
              />
            </div>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Altura de botones y menús desplegables</span>
              <strong>{ui.controlHeight} px</strong>
            </label>
            <div className="custom-slider-group">
              <input
                type="range"
                min={26}
                max={44}
                step={1}
                value={ui.controlHeight}
                onChange={(event) => ui.update({ controlHeight: Number(event.target.value) })}
              />
            </div>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Densidad de menús</span>
            </label>
            <div className="segmented">
              {(
                [
                  ["compact", "Compacta"],
                  ["comfortable", "Cómoda"],
                  ["spacious", "Espaciosa"],
                ] as [UiDensity, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={ui.uiDensity === id ? "active" : ""}
                  onClick={() => ui.update({ uiDensity: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Fuente de la interfaz y menús</span>
            </label>
            <select
              value={ui.uiFontFamily}
              onChange={(event) => ui.update({ uiFontFamily: event.target.value })}
            >
              {UI_FONT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="custom-section">
          <div className="custom-section-header">
            <strong>Comportamiento del Ícono de Nota</strong>
            <span>Qué ocurre al dar clic sobre el ícono de nota en un versículo</span>
          </div>
          <div className="segmented custom-note-behavior">
            {(
              [
                ["floating", "Nota flotante"],
                ["sidepanel", "Pestaña junto a Diccionario"],
                ["ask", "Preguntar / Menú"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={ui.noteOpenBehavior === mode ? "active" : ""}
                onClick={() => ui.update({ noteOpenBehavior: mode })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="custom-section">
          <div className="custom-section-header">
            <strong>Lectura Bíblica y Panel de Estudio</strong>
            <span>Fuentes y escalas de lectura</span>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Fuente bíblica ({Math.round(18.5 * fontScale)} px)</span>
            </label>
            <div className="custom-inline-pair">
              <select
                value={readerFont}
                onChange={(event) => onReaderFontChange(event.target.value)}
              >
                {fontOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="tool-button"
                onClick={() => onFontScaleChange(Math.max(0.8, Number((fontScale - 0.06).toFixed(2))))}
              >
                A−
              </button>
              <button
                type="button"
                className="tool-button"
                onClick={() => onFontScaleChange(Math.min(1.9, Number((fontScale + 0.06).toFixed(2))))}
              >
                A+
              </button>
            </div>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Fuente del panel derecho ({Math.round(12.5 * studyFontScale)} px)</span>
            </label>
            <div className="custom-inline-pair">
              <select
                value={studyFont}
                onChange={(event) => onStudyFontChange(event.target.value)}
              >
                {fontOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="tool-button"
                onClick={() =>
                  onStudyFontScaleChange(Math.max(0.8, Number((studyFontScale - 0.06).toFixed(2))))
                }
              >
                A−
              </button>
              <button
                type="button"
                className="tool-button"
                onClick={() =>
                  onStudyFontScaleChange(Math.min(2.2, Number((studyFontScale + 0.06).toFixed(2))))
                }
              >
                A+
              </button>
            </div>
          </div>
        </div>

        <div className="custom-section">
          <div className="custom-section-header">
            <strong>Apariencia, Tema y Resaltados</strong>
            <span>Colores del sistema, bordes y opacidad de marcadores</span>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Tema visual</span>
            </label>
            <div className="custom-theme-groups">
              {(["light", "dark"] as const).map((group) => (
                <div key={group}>
                  <span className="custom-theme-group-label">
                    {group === "light" ? "Temas claros editoriales" : "Temas oscuros de estudio"}
                  </span>
                  <div className="custom-theme-grid">
                    {THEME_META.filter((option) => option.group === group).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={theme === option.id ? "custom-theme-option active" : "custom-theme-option"}
                        onClick={() => onThemeChange(option.id)}
                      >
                        <span className="theme-swatches">
                          <i style={{ background: option.shell }} />
                          <i style={{ background: option.card }} />
                          <i style={{ background: option.accent }} />
                        </span>
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Color de acento</span>
              <strong>{ui.accentColor}</strong>
            </label>
            <div className="custom-accent-row">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={
                    ui.accentColor.toLowerCase() === preset.color.toLowerCase()
                      ? "custom-accent-swatch active"
                      : "custom-accent-swatch"
                  }
                  style={{ background: preset.color }}
                  onClick={() => ui.update({ accentColor: preset.color })}
                  title={preset.label}
                  aria-label={preset.label}
                />
              ))}
              <input
                type="color"
                value={ui.accentColor}
                onChange={(event) => ui.update({ accentColor: event.target.value })}
                title="Elegir color personalizado"
                aria-label="Color personalizado"
              />
            </div>
          </div>

          <div className="custom-control-row">
            <label>
              <span>Intensidad de resaltados</span>
              <strong>{Math.round(ui.highlightOpacity * 100)}%</strong>
            </label>
            <input
              type="range"
              min={0.18}
              max={0.68}
              step={0.02}
              value={ui.highlightOpacity}
              onChange={(event) => ui.update({ highlightOpacity: Number(event.target.value) })}
            />
          </div>

          <div className="custom-control-row">
            <label>
              <span>Estilo de cita bibliográfica</span>
            </label>
            <select
              value={ui.citationStyle}
              onChange={(event) =>
                ui.update({
                  citationStyle: event.target.value as "apa" | "sbl" | "chicago",
                })
              }
            >
              <option value="apa">APA 7ª edición</option>
              <option value="sbl">SBL (Bíblico)</option>
              <option value="chicago">Chicago</option>
            </select>
          </div>

          <label className="custom-check-row">
            <input
              type="checkbox"
              checked={ui.autoCiteOnCopy}
              onChange={(event) => ui.update({ autoCiteOnCopy: event.target.checked })}
            />
            <span>Anexar cita automáticamente al copiar texto de libros y comentarios</span>
          </label>

          <label className="custom-check-row">
            <input
              type="checkbox"
              checked={ui.includeTranslationEntry}
              onChange={(event) => ui.update({ includeTranslationEntry: event.target.checked })}
            />
            <span>Incluir ficha editorial completa de las traducciones bíblicas</span>
          </label>

          <label className="custom-check-row">
            <input
              type="checkbox"
              checked={ui.highContrast}
              onChange={(event) => ui.update({ highContrast: event.target.checked })}
            />
            <span>Contraste de bordes y textos: Alto contraste</span>
          </label>

          <div className="custom-control-row">
            <label>
              <span>Redondeo de bordes</span>
              <strong>{ui.borderRadius} px</strong>
            </label>
            <input
              type="range"
              min={2}
              max={14}
              step={1}
              value={ui.borderRadius}
              onChange={(event) => ui.update({ borderRadius: Number(event.target.value) })}
            />
          </div>
        </div>

        <div className="custom-footer">
          <button
            type="button"
            className="secondary-button"
            onClick={() => ui.reset()}
          >
            Restablecer valores por defecto
          </button>
          <button type="button" className="primary-button" onClick={onClose}>
            Listo
          </button>
        </div>
      </aside>
    </div>
  );
}
