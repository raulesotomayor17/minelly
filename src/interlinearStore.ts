import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface InterlinearDisplayOptions {
  showSurfaceText: boolean;
  showSpanishGloss: boolean;
  showManuscript: boolean;
  showTransliteration: boolean;
  showLemma: boolean;
  showMorphology: boolean;
  showStrongNumbers: boolean;
}

interface InterlinearState extends InterlinearDisplayOptions {
  setOption: <Key extends keyof InterlinearDisplayOptions>(
    key: Key,
    value: InterlinearDisplayOptions[Key],
  ) => void;
  reset: () => void;
}

export const DEFAULT_INTERLINEAR_OPTIONS: InterlinearDisplayOptions = {
  showSurfaceText: false,
  showSpanishGloss: true,
  showManuscript: true,
  showTransliteration: false,
  showLemma: false,
  showMorphology: true,
  showStrongNumbers: true,
};

export const useInterlinearStore = create<InterlinearState>()(
  persist(
    (set) => ({
      ...DEFAULT_INTERLINEAR_OPTIONS,
      setOption: (key, value) =>
        set({ [key]: value } as Partial<InterlinearState>),
      reset: () => set(DEFAULT_INTERLINEAR_OPTIONS),
    }),
    {
      name: "teoamoxtli.interlinear-options.v3",
      partialize: (state) => ({
        showSurfaceText: state.showSurfaceText,
        showSpanishGloss: state.showSpanishGloss,
        showManuscript: state.showManuscript,
        showTransliteration: state.showTransliteration,
        showLemma: state.showLemma,
        showMorphology: state.showMorphology,
        showStrongNumbers: state.showStrongNumbers,
      }),
    },
  ),
);
