export type View = "library" | "reader" | "search" | "book";

export type ReaderMode = "verse" | "page" | "book" | "interlinear";

/**
 * Instantánea completa de una disposición de estudio guardada por el usuario.
 * Vive en su propio módulo para que los componentes de UI puedan tiparla sin
 * acoplarse al archivo principal de la aplicación.
 */
export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  view: View;
  bibleId: string;
  commentaryId: string;
  dictionaryId: string;
  bookId: string;
  book: number;
  chapter: number;
  activeVerse: number;
  readerMode: ReaderMode;
  showNumbers: boolean;
  panelOpen: boolean;
  panelWidth: number;
  fontScale: number;
  focusMode: boolean;
  resourcesOpen: boolean;
  readerFont?: string;
  studyFont?: string;
  studyFontScale?: number;
}
