import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface BibleFormatOptions {
  enableCustomFormatting: boolean;
  showBibleFormatting: boolean;
  showChapterVerseNumbers: boolean;
  showFootnoteIndicators: boolean;
  showNonBiblicalText: boolean;
  oneVersePerLine: boolean;
}

interface BibleFormatState extends BibleFormatOptions {
  setOption: <Key extends keyof BibleFormatOptions>(
    key: Key,
    value: BibleFormatOptions[Key],
  ) => void;
  reset: () => void;
}

export const DEFAULT_BIBLE_FORMAT: BibleFormatOptions = {
  enableCustomFormatting: true,
  showBibleFormatting: true,
  showChapterVerseNumbers: true,
  showFootnoteIndicators: true,
  showNonBiblicalText: true,
  oneVersePerLine: true,
};

export const useBibleFormatStore = create<BibleFormatState>()(
  persist(
    (set) => ({
      ...DEFAULT_BIBLE_FORMAT,
      setOption: (key, value) =>
        set({ [key]: value } as Partial<BibleFormatState>),
      reset: () => set(DEFAULT_BIBLE_FORMAT),
    }),
    {
      name: "teoamoxtli.bible-format.v1",
      partialize: (state) => ({
        enableCustomFormatting: state.enableCustomFormatting,
        showBibleFormatting: state.showBibleFormatting,
        showChapterVerseNumbers: state.showChapterVerseNumbers,
        showFootnoteIndicators: state.showFootnoteIndicators,
        showNonBiblicalText: state.showNonBiblicalText,
        oneVersePerLine: state.oneVersePerLine,
      }),
    },
  ),
);
