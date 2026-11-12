export type ThemeMode =
  | "glass" | "blue" | "gray" | "green" | "white" | "warm"
  | "terracotta" | "nordic" | "oxford" | "obsidian" | "cypress";

export interface ThemeMeta {
  id: ThemeMode;
  label: string;
  group: "light" | "dark";
  shell: string;
  card: string;
  accent: string;
}

export const THEME_META: ThemeMeta[] = [
  { id: "white", label: "Blanco Perla", group: "light", shell: "#eef1f6", card: "#ffffff", accent: "#0f6cbd" },
  { id: "warm", label: "Arena Editorial", group: "light", shell: "#eae4d8", card: "#fffdf9", accent: "#b45309" },
  { id: "nordic", label: "Pizarra Nórdica", group: "light", shell: "#e3e8ef", card: "#ffffff", accent: "#2563eb" },
  { id: "terracotta", label: "Códice Terracota", group: "light", shell: "#ebe3d5", card: "#faf7f2", accent: "#b84a27" },
  { id: "cypress", label: "Ciprés Botánico", group: "light", shell: "#e1ebe5", card: "#ffffff", accent: "#1e6b52" },
  { id: "oxford", label: "Biblioteca Oxford", group: "dark", shell: "#12161f", card: "#212836", accent: "#d49a35" },
  { id: "obsidian", label: "Obsidiana Bronce", group: "dark", shell: "#141312", card: "#262320", accent: "#d97706" },
  { id: "blue", label: "Azul Medianoche", group: "dark", shell: "#090e1a", card: "#1e293b", accent: "#38bdf8" },
  { id: "gray", label: "Grafito Oscuro", group: "dark", shell: "#161618", card: "#252529", accent: "#38bdf8" },
  { id: "green", label: "Bosque Esmeralda", group: "dark", shell: "#071410", card: "#122d24", accent: "#10b981" },
  { id: "glass", label: "Cristal Acrílico", group: "dark", shell: "#0b1726", card: "#1e293b", accent: "#38bdf8" },
];

export const THEME_OPTIONS = THEME_META.map(({ id, label }) => ({ id, label }));
export const SOLID_THEMES: ThemeMode[] = ["terracotta", "nordic", "oxford", "obsidian", "cypress"];
export const LIGHT_THEMES: ThemeMode[] = ["white", "warm", "terracotta", "nordic", "cypress"];
