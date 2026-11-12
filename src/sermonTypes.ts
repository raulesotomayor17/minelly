import type { JSONContent } from "@tiptap/core";

export interface SermonQuestion {
  id: string;
  text: string;
  kind: "exegesis" | "application" | "custom";
  done?: boolean;
}

export interface SlideTextObject {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  align: "left" | "center" | "right";
  role?: "title" | "body" | "quote" | "custom";
  rotation?: number;
  zIndex?: number;
  opacity?: number;
  shadow?: boolean;
  animation?: "none" | "fade" | "rise" | "zoom";
  mask?: "none" | "rounded" | "circle";
}

export interface SlideImageObject {
  id: string;
  type: "image";
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  rotation?: number;
  zIndex?: number;
  opacity?: number;
  shadow?: boolean;
  animation?: "none" | "fade" | "rise" | "zoom";
  mask?: "none" | "rounded" | "circle";
  crop?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export type SlideObject = SlideTextObject | SlideImageObject;

export interface SlideLayout {
  objects: SlideObject[];
}

export interface SermonSlideSettings {
  backgrounds: Record<string, string>;
  order: string[];
  layouts?: Record<string, SlideLayout>;
  customSlides?: string[];
  transitions?: Record<string, string>;
}

export interface Sermon {
  id: string;
  title: string;
  series: string;
  seriesNumber: number | null;
  topics: string[];
  passages: string[];
  tags: string[];
  speaker: string;
  venue: string;
  service: string;
  dateTime: string;
  audience: string;
  description: string;
  contentJson: JSONContent;
  questionsJson: SermonQuestion[];
  slideSettings: SermonSlideSettings;
  createdAt: number;
  updatedAt: number;
}

export interface SermonInput {
  title: string;
  series: string;
  seriesNumber: number | null;
  topics: string[];
  passages: string[];
  tags: string[];
  speaker: string;
  venue: string;
  service: string;
  dateTime: string;
  audience: string;
  description: string;
  contentJson: JSONContent;
  questionsJson: SermonQuestion[];
  slideSettings: SermonSlideSettings;
}

export interface PixabayImage {
  id: number;
  previewUrl: string;
  webformatUrl: string;
  largeImageUrl: string;
  tags: string;
  user: string;
  pageUrl: string;
}

export interface PixabaySearchResult {
  total: number;
  totalHits: number;
  images: PixabayImage[];
}

export function emptySermonDocument(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Título del sermón" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Escribe la introducción del sermón. Selecciona una frase y pulsa «Completar» para crear un espacio de la hoja informativa.",
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Primer punto" }],
      },
      { type: "paragraph" },
    ],
  };
}

export function emptySermon(id: string, dateTime = ""): Sermon {
  return {
    id,
    title: "Sermón sin título",
    series: "",
    seriesNumber: null,
    topics: [],
    passages: [],
    tags: [],
    speaker: "",
    venue: "",
    service: "",
    dateTime,
    audience: "",
    description: "",
    contentJson: emptySermonDocument(),
    questionsJson: [],
    slideSettings: { backgrounds: {}, order: [] },
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

export function sermonToInput(sermon: Sermon): SermonInput {
  return {
    title: sermon.title,
    series: sermon.series,
    seriesNumber: sermon.seriesNumber,
    topics: sermon.topics,
    passages: sermon.passages,
    tags: sermon.tags,
    speaker: sermon.speaker,
    venue: sermon.venue,
    service: sermon.service,
    dateTime: sermon.dateTime,
    audience: sermon.audience,
    description: sermon.description,
    contentJson: sermon.contentJson,
    questionsJson: sermon.questionsJson,
    slideSettings: sermon.slideSettings ?? { backgrounds: {}, order: [] },
  };
}

export function formatSermonDate(value: string): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatSermonDateTime(value: string): string {
  if (!value) return "Sin fecha";
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

export function splitList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinList(value: string[]): string {
  return value.join(", ");
}

export function nullIfBlank(value: string): string | null {
  const clean = value.trim();
  return clean ? clean : null;
}

export function formatEpoch(value: number): string {
  if (!value) return "—";
  return new Date(value * 1000).toLocaleString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
