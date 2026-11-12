import { useSyncExternalStore } from "react";
import type { CitationStyle } from "./citationEngine";

export type UiDensity = "compact" | "comfortable" | "spacious";
export type ReaderPaperId =
  | "theme"
  | "paper-white"
  | "cream"
  | "sepia"
  | "sand"
  | "sage"
  | "sky"
  | "slate"
  | "oled"
  | "custom";
export type ReaderSheetStyle = "full" | "sheet";
export type ReaderPaperScope = "all" | "reader-only";

export interface ReaderPaperPreset {
  id: ReaderPaperId;
  label: string;
  bg: string;
  bgSoft: string;
  ink: string;
  muted: string;
  border: string;
  isLight: boolean;
}

export const READER_PAPER_PRESETS: ReaderPaperPreset[] = [
  {
    id: "theme",
    label: "Tema actual",
    bg: "transparent",
    bgSoft: "transparent",
    ink: "inherit",
    muted: "inherit",
    border: "transparent",
    isLight: false,
  },
  {
    id: "paper-white",
    label: "Blanco papel",
    bg: "#ffffff",
    bgSoft: "#f3f5f8",
    ink: "#161920",
    muted: "#525b6c",
    border: "#d9e0ea",
    isLight: true,
  },
  {
    id: "cream",
    label: "Crema editorial",
    bg: "#faf6ec",
    bgSoft: "#f0e9d8",
    ink: "#231e17",
    muted: "#655847",
    border: "#dfd4be",
    isLight: true,
  },
  {
    id: "sepia",
    label: "Sepia clásico",
    bg: "#f1e4cc",
    bgSoft: "#e5d5b7",
    ink: "#322416",
    muted: "#6d563e",
    border: "#d4c19f",
    isLight: true,
  },
  {
    id: "sand",
    label: "Arena papiro",
    bg: "#e7dac2",
    bgSoft: "#dbcca8",
    ink: "#2b2116",
    muted: "#62503c",
    border: "#c8b594",
    isLight: true,
  },
  {
    id: "sage",
    label: "Verde salvia",
    bg: "#e6f0e8",
    bgSoft: "#d7e5da",
    ink: "#18291f",
    muted: "#4a6354",
    border: "#c2d6c7",
    isLight: true,
  },
  {
    id: "sky",
    label: "Azul sereno",
    bg: "#eaf2fa",
    bgSoft: "#dce8f5",
    ink: "#162436",
    muted: "#4c617a",
    border: "#c5d7eb",
    isLight: true,
  },
  {
    id: "slate",
    label: "Pizarra noche",
    bg: "#1d222c",
    bgSoft: "#252b37",
    ink: "#e6eaf2",
    muted: "#9aa4b8",
    border: "#323a4a",
    isLight: false,
  },
  {
    id: "oled",
    label: "Negro OLED",
    bg: "#07080b",
    bgSoft: "#111319",
    ink: "#dde2ec",
    muted: "#8b94a6",
    border: "#222632",
    isLight: false,
  },
  {
    id: "custom",
    label: "Personalizado",
    bg: "#fdfbf7",
    bgSoft: "#f2ece1",
    ink: "#1f1d1a",
    muted: "#5c554c",
    border: "#dcd3c4",
    isLight: true,
  },
];

export interface UiCustomizationState {
  menuFontSize: number;      // px (11..20), default 13.5
  sidebarFontSize: number;   // px (11..19), default 13.5
  sidebarWidth: number;      // px (180..310), default 224
  panelTabFontSize: number;  // px (11..19), default 13
  controlHeight: number;     // px (26..42), default 32
  uiDensity: UiDensity;      // compact | comfortable | spacious
  uiFontFamily: string;      // Inter | Literata | Crimson Pro | Libre Baskerville | system-ui
  accentColor: string;       // hex color
  borderRadius: number;      // px (4..14), default 8
  highlightOpacity: number;  // 0.18..0.65, default 0.36
  noteOpenBehavior: "floating" | "sidepanel" | "ask"; // default "floating"
  readerPaper: ReaderPaperId;         // default "theme"
  readerSheetStyle: ReaderSheetStyle; // "full" | "sheet"
  readerPaperScope: ReaderPaperScope; // "all" | "reader-only"
  readerCustomBg: string;             // hex color
  readerCustomInk: string;            // hex color
  preferredBibleId: string;           // ID of the user's preferred Bible (e.g. Reina Valera 1960)
  citationStyle: CitationStyle;       // APA 7, SBL or Chicago
  autoCiteOnCopy: boolean;            // Append citation automatically when copying
  includeTranslationEntry: boolean;   // Include a full Bible translation entry in references
  highContrast: boolean;
}

const STORAGE_KEY = "teoamoxtli.ui-customization.v1";
const MIGRATION_KEY = "teoamoxtli.ui-customization.migrated-v2";

export const DEFAULT_UI_CUSTOMIZATION: UiCustomizationState = {
  menuFontSize: 14.5,
  sidebarFontSize: 14,
  sidebarWidth: 232,
  panelTabFontSize: 13.5,
  controlHeight: 35,
  uiDensity: "comfortable",
  uiFontFamily: "Inter",
  accentColor: "#5b95ff",
  borderRadius: 8,
  highlightOpacity: 0.36,
  noteOpenBehavior: "floating",
  readerPaper: "theme",
  readerSheetStyle: "full",
  readerPaperScope: "all",
  readerCustomBg: "#fdfbf7",
  readerCustomInk: "#1f1d1a",
  preferredBibleId: "",
  citationStyle: "apa",
  autoCiteOnCopy: false,
  includeTranslationEntry: false,
  highContrast: false,
};

export const ACCENT_PRESETS: { id: string; label: string; color: string; secondary: string }[] = [
  { id: "sapphire", label: "Azul Zafiro", color: "#5b95ff", secondary: "#2f6fe4" },
  { id: "gold", label: "Oro Códice", color: "#d6b36a", secondary: "#b58d3d" },
  { id: "emerald", label: "Verde Esmeralda", color: "#46b98a", secondary: "#2d946b" },
  { id: "amethyst", label: "Amatista", color: "#a78bfa", secondary: "#7c5dfa" },
  { id: "cyan", label: "Cian Celeste", color: "#38bdf8", secondary: "#0284c7" },
  { id: "coral", label: "Coral Cálido", color: "#f28b82", secondary: "#d9534f" },
];

export const UI_FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "Inter", label: "Inter (Sans moderna)" },
  { value: "Literata", label: "Literata (Serif editorial)" },
  { value: "Crimson Pro", label: "Crimson Pro (Clásica)" },
  { value: "Libre Baskerville", label: "Libre Baskerville" },
  { value: "system-ui", label: "Sistema (Nativa)" },
];

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isLightHex(hex: string): boolean {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return true;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55;
}

function loadState(): UiCustomizationState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(MIGRATION_KEY, "1");
      return DEFAULT_UI_CUSTOMIZATION;
    }
    const parsed = JSON.parse(raw) as Partial<UiCustomizationState>;
    const migrated = localStorage.getItem(MIGRATION_KEY) === "1";
    const validPaper = READER_PAPER_PRESETS.some((p) => p.id === parsed.readerPaper)
      ? (parsed.readerPaper as ReaderPaperId)
      : "theme";
    const rawMenu = parsed.menuFontSize ?? 14.5;
    const rawSidebar = parsed.sidebarFontSize ?? 14;
    const rawSidebarWidth = parsed.sidebarWidth ?? 232;
    const rawTab = parsed.panelTabFontSize ?? 13.5;
    const rawHeight = parsed.controlHeight ?? 35;
    const nextState: UiCustomizationState = {
      menuFontSize: clamp(!migrated && rawMenu < 14.5 ? 14.5 : rawMenu, 10, 22, 14.5),
      sidebarFontSize: clamp(!migrated && rawSidebar < 14 ? 14 : rawSidebar, 10, 20, 14),
      sidebarWidth: clamp(!migrated && rawSidebarWidth < 232 ? 232 : rawSidebarWidth, 175, 320, 232),
      panelTabFontSize: clamp(!migrated && rawTab < 13.5 ? 13.5 : rawTab, 10, 20, 13.5),
      controlHeight: clamp(!migrated && rawHeight < 35 ? 35 : rawHeight, 24, 46, 35),
      uiDensity:
        parsed.uiDensity === "compact" ||
        parsed.uiDensity === "comfortable" ||
        parsed.uiDensity === "spacious"
          ? parsed.uiDensity
          : "comfortable",
      uiFontFamily: parsed.uiFontFamily || "Inter",
      accentColor: parsed.accentColor || "#5b95ff",
      borderRadius: clamp(parsed.borderRadius ?? 8, 2, 16, 8),
      highlightOpacity: clamp(parsed.highlightOpacity ?? 0.36, 0.15, 0.7, 0.36),
      noteOpenBehavior:
        parsed.noteOpenBehavior === "floating" ||
        parsed.noteOpenBehavior === "sidepanel" ||
        parsed.noteOpenBehavior === "ask"
          ? parsed.noteOpenBehavior
          : "floating",
      readerPaper: validPaper,
      readerSheetStyle: parsed.readerSheetStyle === "sheet" ? "sheet" : "full",
      readerPaperScope: parsed.readerPaperScope === "reader-only" ? "reader-only" : "all",
      readerCustomBg: parsed.readerCustomBg || "#fdfbf7",
      readerCustomInk: parsed.readerCustomInk || "#1f1d1a",
      preferredBibleId: parsed.preferredBibleId || "",
      citationStyle:
        parsed.citationStyle === "sbl" || parsed.citationStyle === "chicago"
          ? parsed.citationStyle
          : "apa",
      autoCiteOnCopy: Boolean(parsed.autoCiteOnCopy),
      includeTranslationEntry: Boolean(parsed.includeTranslationEntry),
      highContrast: Boolean(parsed.highContrast),
    };
    if (!migrated) {
      localStorage.setItem(MIGRATION_KEY, "1");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    }
    return nextState;
  } catch {
    return DEFAULT_UI_CUSTOMIZATION;
  }
}

let state: UiCustomizationState = loadState();
const listeners = new Set<() => void>();

export function applyUiCustomizationToDom(current: UiCustomizationState = state) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const preset =
    ACCENT_PRESETS.find((item) => item.color.toLowerCase() === current.accentColor.toLowerCase()) ??
    ACCENT_PRESETS[0];

  const padMultiplier =
    current.uiDensity === "compact" ? 0.85 : current.uiDensity === "spacious" ? 1.2 : 1;

  root.style.setProperty("--ui-menu-font-size", `${current.menuFontSize}px`);
  root.style.setProperty("--ui-menu-small-font-size", `${Math.max(10, current.menuFontSize - 1.5)}px`);
  root.style.setProperty("--ui-sidebar-font-size", `${current.sidebarFontSize}px`);
  root.style.setProperty("--ui-sidebar-width", `${current.sidebarWidth}px`);
  root.style.setProperty("--ui-panel-tab-font-size", `${current.panelTabFontSize}px`);
  root.style.setProperty("--ui-control-height", `${Math.round(current.controlHeight * padMultiplier)}px`);
  root.style.setProperty("--ui", `"${current.uiFontFamily}", "Inter", system-ui, -apple-system, sans-serif`);
  root.style.setProperty("--accent", current.accentColor);
  root.style.setProperty("--accent-2", preset.secondary);
  root.style.setProperty("--radius", `${current.borderRadius}px`);
  root.style.setProperty("--highlight-opacity", String(current.highlightOpacity));
  root.dataset.density = current.uiDensity;
  root.dataset.contrast = current.highContrast ? "high" : "normal";

  // Reading Canvas / Paper Mode variables
  const paperPreset =
    READER_PAPER_PRESETS.find((item) => item.id === current.readerPaper) ??
    READER_PAPER_PRESETS[0];

  root.dataset.readerPaper = current.readerPaper;
  root.dataset.readerSheet = current.readerSheetStyle;
  root.dataset.readerScope = current.readerPaperScope;

  if (current.readerPaper === "theme") {
    root.removeAttribute("data-reader-light");
    root.style.removeProperty("--paper-bg");
    root.style.removeProperty("--paper-bg-soft");
    root.style.removeProperty("--paper-ink");
    root.style.removeProperty("--paper-muted");
    root.style.removeProperty("--paper-border");
  } else if (current.readerPaper === "custom") {
    const light = isLightHex(current.readerCustomBg);
    root.dataset.readerLight = light ? "true" : "false";
    root.style.setProperty("--paper-bg", current.readerCustomBg);
    root.style.setProperty(
      "--paper-bg-soft",
      `color-mix(in srgb, ${current.readerCustomBg} 90%, ${current.readerCustomInk})`,
    );
    root.style.setProperty("--paper-ink", current.readerCustomInk);
    root.style.setProperty(
      "--paper-muted",
      `color-mix(in srgb, ${current.readerCustomInk} 64%, ${current.readerCustomBg})`,
    );
    root.style.setProperty(
      "--paper-border",
      `color-mix(in srgb, ${current.readerCustomInk} 18%, ${current.readerCustomBg})`,
    );
  } else {
    root.dataset.readerLight = paperPreset.isLight ? "true" : "false";
    root.style.setProperty("--paper-bg", paperPreset.bg);
    root.style.setProperty("--paper-bg-soft", paperPreset.bgSoft);
    root.style.setProperty("--paper-ink", paperPreset.ink);
    root.style.setProperty("--paper-muted", paperPreset.muted);
    root.style.setProperty("--paper-border", paperPreset.border);
  }
}

function saveState(next: UiCustomizationState) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write errors
  }
  applyUiCustomizationToDom(state);
  for (const listener of listeners) {
    listener();
  }
}

// Initialize immediately on module load
applyUiCustomizationToDom(state);

export function updateUiCustomization(patch: Partial<UiCustomizationState>) {
  saveState({ ...state, ...patch });
}

export function resetUiCustomization() {
  saveState(DEFAULT_UI_CUSTOMIZATION);
}

export function applyUiPreset(preset: "standard" | "large" | "xl" | "compact") {
  if (preset === "large") {
    saveState({
      ...state,
      menuFontSize: 15.5,
      sidebarFontSize: 15,
      sidebarWidth: 246,
      panelTabFontSize: 14.5,
      controlHeight: 36,
      uiDensity: "comfortable",
    });
  } else if (preset === "xl") {
    saveState({
      ...state,
      menuFontSize: 17.5,
      sidebarFontSize: 16.5,
      sidebarWidth: 268,
      panelTabFontSize: 16,
      controlHeight: 40,
      uiDensity: "spacious",
    });
  } else if (preset === "compact") {
    saveState({
      ...state,
      menuFontSize: 12,
      sidebarFontSize: 12,
      sidebarWidth: 204,
      panelTabFontSize: 11.5,
      controlHeight: 28,
      uiDensity: "compact",
    });
  } else {
    saveState({
      ...DEFAULT_UI_CUSTOMIZATION,
      accentColor: state.accentColor,
      uiFontFamily: state.uiFontFamily,
      noteOpenBehavior: state.noteOpenBehavior,
      readerPaper: state.readerPaper,
      readerSheetStyle: state.readerSheetStyle,
      readerPaperScope: state.readerPaperScope,
      readerCustomBg: state.readerCustomBg,
      readerCustomInk: state.readerCustomInk,
      citationStyle: state.citationStyle,
      autoCiteOnCopy: state.autoCiteOnCopy,
      includeTranslationEntry: state.includeTranslationEntry,
    });
  }
}

export function useUiCustomizationStore() {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
  return {
    ...snapshot,
    update: updateUiCustomization,
    reset: resetUiCustomization,
    applyPreset: applyUiPreset,
  };
}
