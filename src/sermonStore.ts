import { create } from "zustand";
import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";

export interface SermonOutlineItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

export type SermonSlideKind =
  | "title"
  | "heading"
  | "text"
  | "quote"
  | "illustration"
  | "passage"
  | "custom";

export interface SermonSlide {
  id: string;
  kind: SermonSlideKind;
  title: string;
  body: string[];
  reference?: string;
  imageUrl?: string;
  background?: string;
  nodePos?: number;
  level?: number;
}

export interface SermonMeta {
  title: string;
  speaker: string;
  dateTime: string;
  series: string;
}

export function textOf(node: JSONContent | null | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(textOf).join(" ").replace(/\s+/g, " ").trim();
}

function prettyDateTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function slideSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
}

function stableSlideId(
  prefix: string,
  text: string,
  seen: Map<string, number>,
): string {
  const base = `${prefix}-${slideSlug(text) || "sin-titulo"}`;
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

export function orderSlides(
  slides: SermonSlide[],
  order: string[],
): SermonSlide[] {
  if (order.length === 0) return slides;
  const rank = new Map(order.map((id, index) => [id, index]));
  const original = new Map(slides.map((slide, index) => [slide.id, index]));
  return [...slides].sort((left, right) => {
    const leftRank = rank.get(left.id) ?? 10_000 + (original.get(left.id) ?? 0);
    const rightRank = rank.get(right.id) ?? 10_000 + (original.get(right.id) ?? 0);
    return leftRank - rightRank;
  });
}

export function buildSermonStructure(
  editor: Editor,
  meta: SermonMeta,
): { outline: SermonOutlineItem[]; slides: SermonSlide[] } {
  const outline: SermonOutlineItem[] = [];
  const seen = new Map<string, number>();
  const slides: SermonSlide[] = [
    {
      id: "slide-title",
      kind: "title",
      title: meta.title || "Sermón sin título",
      body: [meta.speaker, meta.series, prettyDateTime(meta.dateTime)]
        .map((value) => value.trim())
        .filter(Boolean),
    },
  ];
  let current: SermonSlide | null = null;

  editor.state.doc.descendants((node, pos) => {
    const name = node.type.name;
    if (name === "heading") {
      const level = Number(node.attrs.level) || 1;
      const text = node.textContent.trim();
      if (!text) return;
      outline.push({ id: `outline-${pos}`, level, text, pos });
      current = {
        id: stableSlideId(`h${level}`, text, seen),
        kind: "heading",
        title: text,
        body: [],
        level,
        nodePos: pos,
      };
      slides.push(current);
      return false;
    }
    if (name === "paragraph") {
      const text = node.textContent.trim();
      if (!text) return;
      if (!current) {
        current = {
          id: stableSlideId("text", text, seen),
          kind: "text",
          title: "",
          body: [],
          nodePos: pos,
        };
        slides.push(current);
      }
      current.body.push(text);
      return false;
    }
    if (name === "blockquote") {
      const text = node.textContent.trim();
      if (!text) return;
      slides.push({
        id: stableSlideId("quote", text, seen),
        kind: "quote",
        title: "Cita",
        body: [text],
        background: String(node.attrs.background ?? ""),
        nodePos: pos,
      });
      current = null;
      return false;
    }
    if (name === "sermonIllustration") {
      slides.push({
        id: stableSlideId("illustration", String(node.attrs.title ?? "Ilustración"), seen),
        kind: "illustration",
        title: String(node.attrs.title ?? "Ilustración"),
        body: [String(node.attrs.caption ?? "")].filter(Boolean),
        imageUrl: String(node.attrs.imageUrl ?? ""),
        background: String(node.attrs.background ?? ""),
        nodePos: pos,
      });
      current = null;
      return false;
    }
    if (name === "biblePassage") {
      slides.push({
        id: stableSlideId("passage", String(node.attrs.reference ?? "Pasaje bíblico"), seen),
        kind: "passage",
        title: String(node.attrs.reference ?? "Pasaje bíblico"),
        body: [String(node.attrs.text ?? "")].filter(Boolean),
        reference: String(node.attrs.reference ?? ""),
        background: String(node.attrs.background ?? ""),
        nodePos: pos,
      });
      current = null;
      return false;
    }
    if (name === "bulletList" || name === "orderedList") {
      const items: string[] = [];
      node.forEach((child) => {
        const text = child.textContent.trim();
        if (text) items.push(text);
      });
      if (items.length > 0) {
        if (!current) {
          current = {
            id: stableSlideId("text", `lista-${pos}`, seen),
            kind: "text",
            title: "",
            body: [],
            nodePos: pos,
          };
          slides.push(current);
        }
        current.body.push(...items.filter(Boolean));
      }
      return false;
    }
    return true;
  });

  return { outline, slides };
}

interface SermonStructureStore {
  sermonOutline: SermonOutlineItem[];
  sermonSlides: SermonSlide[];
  activeSlide: number;
  slideBackgrounds: Record<string, string>;
  setSermonOutline: (items: SermonOutlineItem[]) => void;
  setSermonStructure: (
    outline: SermonOutlineItem[],
    slides: SermonSlide[],
  ) => void;
  setSermonSlides: (slides: SermonSlide[]) => void;
  setActiveSlide: (index: number) => void;
  setSlideBackground: (slideId: string, background: string) => void;
  resetSermonStructure: () => void;
}

export const useSermonStore = create<SermonStructureStore>((set) => ({
  sermonOutline: [],
  sermonSlides: [],
  activeSlide: 0,
  slideBackgrounds: {},
  setSermonOutline: (sermonOutline) => set({ sermonOutline }),
  setSermonStructure: (sermonOutline, sermonSlides) =>
    set((state) => ({
      sermonOutline,
      sermonSlides,
      activeSlide: Math.min(
        state.activeSlide,
        Math.max(0, sermonSlides.length - 1),
      ),
    })),
  setSermonSlides: (sermonSlides) =>
    set((state) => ({
      sermonSlides,
      activeSlide: Math.min(
        state.activeSlide,
        Math.max(0, sermonSlides.length - 1),
      ),
    })),
  setActiveSlide: (activeSlide) => set({ activeSlide }),
  setSlideBackground: (slideId, background) =>
    set((state) => ({
      slideBackgrounds: { ...state.slideBackgrounds, [slideId]: background },
    })),
  resetSermonStructure: () =>
    set({ sermonOutline: [], sermonSlides: [], activeSlide: 0 }),
}));
