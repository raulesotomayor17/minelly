export interface MorphologyDescription {
  shortCode: string;
  fullTooltip: string;
}

const HEBREW_STEMS: Record<string, [string, string]> = {
  Q: ["QAL", "qal"],
  N: ["NIPH", "niphal"],
  P: ["PIEL", "piel"],
  U: ["PUAL", "pual"],
  H: ["HIPH", "hiphil"],
  T: ["HITH", "hithpael"],
  O: ["HOPH", "hophal"],
};

const GREEK_CASES: Record<string, [string, string]> = {
  N: ["NOM", "nominativo"],
  G: ["GEN", "genitivo"],
  D: ["DAT", "dativo"],
  A: ["ACC", "acusativo"],
  V: ["VOC", "vocativo"],
};
const GREEK_NUMBERS: Record<string, [string, string]> = {
  S: ["SG", "singular"],
  P: ["PL", "plural"],
};
const GREEK_GENDERS: Record<string, [string, string]> = {
  M: ["M", "masculino"],
  F: ["F", "femenino"],
  N: ["N", "neutro"],
};

export function decodeMorphology(raw: string): MorphologyDescription {
  const code = (raw || "").trim().toUpperCase();
  if (!code) return { shortCode: "", fullTooltip: "Sin análisis morfológico" };

  // Greek Robinson-style: V-PAI-3S, N-NSF, A-ASM, PREP, CONJ, ART
  const greek = code.replace(/^T?G?/, "");
  const parts = greek.split("-");
  if (parts.length >= 2) {
    const pos = parts[0];
    const form = parts[1] ?? "";
    const person = parts[2] ?? "";
    const posLabel =
      pos.startsWith("V") ? "VERBO" : pos.startsWith("N") ? "SUBS" : pos.startsWith("A") ? "ADJ" : pos === "PREP" ? "PREP" : pos === "CONJ" ? "CONJ" : pos === "ART" ? "ART" : pos;
    const tense = form[0] === "P" ? "PRES" : form[0] === "A" ? "AOR" : form[0] === "F" ? "FUT" : form[0] === "I" ? "IMPF" : form[0] === "R" ? "PERF" : form[0] ?? "";
    const voice = form[1] === "A" ? "ACT" : form[1] === "M" ? "MED" : form[1] === "P" ? "PAS" : "";
    const mood = form[2] === "I" ? "IND" : form[2] === "S" ? "SUBJ" : form[2] === "O" ? "OPT" : form[2] === "M" ? "IMP" : "";
    const caseCode = form[3] ?? "";
    const numberCode = form[4] ?? "";
    const genderCode = form[5] ?? "";
    const caseInfo = GREEK_CASES[caseCode];
    const numberInfo = GREEK_NUMBERS[numberCode];
    const genderInfo = GREEK_GENDERS[genderCode];
    const short = [posLabel, tense, voice, mood, caseInfo?.[0], numberInfo?.[0], genderInfo?.[0]].filter(Boolean).join(".");
    const full = [
      posLabel.toLowerCase(),
      tense ? `tiempo ${tense.toLowerCase()}` : "",
      voice ? `voz ${voice.toLowerCase()}` : "",
      mood ? `modo ${mood.toLowerCase()}` : "",
      caseInfo ? `caso ${caseInfo[1]}` : "",
      numberInfo ? `número ${numberInfo[1]}` : "",
      genderInfo ? `género ${genderInfo[1]}` : "",
      person ? `${person.replace(/[^0-9]/g, "")}ª persona` : "",
    ].filter(Boolean).join(" ");
    if (short) return { shortCode: short, fullTooltip: full };
  }

  // Hebrew TAHOT/ETCBC: TH8804, H8804, Vqp3ms
  const hebrew = code.replace(/^TH?/, "");
  const stemChar = hebrew[1] ?? "";
  const stem = HEBREW_STEMS[stemChar];
  if (stem) {
    const short = [stem[0], hebrew.includes("PERF") ? "PERF" : hebrew.includes("IMP") ? "IMPF" : "FORMA"].join(".");
    return { shortCode: short, fullTooltip: `verbo ${stem[1]} ${short.split(".")[1]?.toLowerCase() ?? "forma verbal"}` };
  }
  if (/^(PREP|CONJ|ART|ADV|PRT|INTJ|NEG)/.test(hebrew)) {
    const label = hebrew.match(/^(PREP|CONJ|ART|ADV|PRT|INTJ|NEG)/)?.[1] ?? "PART";
    return { shortCode: label, fullTooltip: `${label.toLowerCase()} (partícula)` };
  }
  return { shortCode: code.slice(0, 24), fullTooltip: raw };
}
