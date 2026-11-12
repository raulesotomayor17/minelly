export interface StrongEntry {
  id: string;
  language: string;
  lemma: string;
  transliteration: string;
  pronunciation: string;
  definition: string;
  derivation: string;
  kjv: string;
  html: string;
  source: string;
}

export interface WordOccurrence {
  source: string;
  strongNumber: string;
  book: number;
  chapter: number;
  verse: number;
  wordOrder: number;
  word: string;
  lemma: string;
  transliteration: string;
  morphology: string;
}

export interface WordStudyCount {
  source: string;
  count: number;
}

export interface LexiconMatch {
  resourceId: string;
  resourceTitle: string;
  topic: string;
  html: string;
}

export interface WordStudyResult {
  entry: StrongEntry | null;
  counts: WordStudyCount[];
  occurrences: WordOccurrence[];
  lexicons: LexiconMatch[];
}

export const WORD_STUDY_SOURCE_LABELS: Record<string, string> = {
  tischendorf: "Tischendorf 8.º (NT griego)",
  bhs: "BHS (AT hebreo)",
  stepbible: "STEPBible",
};
