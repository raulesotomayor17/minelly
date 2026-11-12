import { useState } from "react";
import { useInterlinearStore } from "./interlinearStore";
import { decodeMorphology } from "./morphDecoder";

export interface InterlinearToken {
  wordOrder: number;
  surfaceText: string;
  originalManuscript: string;
  transliteration: string;
  lemma: string;
  strongNumber: string;
  morphologyCode: string;
  spanishGloss?: string;
}

export interface InterlinearVerseData {
  verse: number;
  tokens: InterlinearToken[];
}

interface InterlinearVerseProps {
  verse: number;
  translation?: string;
  tokens: InterlinearToken[];
  onStrong?: (strong: string) => void;
  direction?: "rtl" | "ltr";
}

export default function InterlinearVerse({
  verse,
  translation = "",
  tokens,
  onStrong,
  direction = "ltr",
}: InterlinearVerseProps) {
  const options = useInterlinearStore();
  const [quick, setQuick] = useState<{ token: InterlinearToken; x: number; y: number } | null>(null);
  return (
    <div className="interlinear-row" data-interlinear-verse={verse}>
      <span className="interlinear-verse-number">{verse}</span>
      <div className="interlinear-content" dir={direction}>
        {translation && (
          <p className="interlinear-translation">{translation}</p>
        )}
        <div className="interlinear-words">
        {tokens.map((token, index) => (
          <button
            type="button"
            className="interlinear-word"
            key={`${token.wordOrder}-${index}`}
            title={decodeMorphology(token.morphologyCode).fullTooltip}
            onClick={(event) => {
              setQuick({
                token,
                x: Math.min(window.innerWidth - 320, event.clientX + 8),
                y: Math.min(window.innerHeight - 260, event.clientY + 8),
              });
            }}
          >
            {options.showSpanishGloss && token.spanishGloss ? (
              <span
                className="interlinear-surface interlinear-spanish-gloss"
                title={token.surfaceText}
              >
                {token.spanishGloss}
              </span>
            ) : !translation && options.showSurfaceText ? (
              <span className="interlinear-surface">
                {token.surfaceText || "—"}
              </span>
            ) : null}
            {options.showManuscript && (
              <span className="interlinear-manuscript">{token.originalManuscript}</span>
            )}
            {options.showStrongNumbers && (
              <span className="interlinear-strong">{token.strongNumber}</span>
            )}
            {options.showMorphology && (
              <span
                className="interlinear-morphology"
                title={decodeMorphology(token.morphologyCode).fullTooltip}
              >
                {decodeMorphology(token.morphologyCode).shortCode}
              </span>
            )}
            {options.showTransliteration && (
              <span className="interlinear-transliteration">
                {token.transliteration}
              </span>
            )}
            {options.showLemma && (
              <span className="interlinear-lemma">{token.lemma}</span>
            )}
          </button>
        ))}
        </div>
      </div>
      {quick && (
        <div className="lexicon-quick-popover" style={{ left: quick.x, top: quick.y }} role="dialog">
          <header>
            <strong>{quick.token.strongNumber || "Token"}</strong>
            <button type="button" onClick={() => setQuick(null)} aria-label="Cerrar">×</button>
          </header>
          <p className="lexicon-quick-lemma">{quick.token.originalManuscript} · {quick.token.transliteration}</p>
          <p className="lexicon-quick-morph">{decodeMorphology(quick.token.morphologyCode).fullTooltip}</p>
          <p className="lexicon-quick-gloss">{quick.token.spanishGloss || quick.token.lemma || "Sin glosa"}</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              if (quick.token.strongNumber && onStrong) onStrong(quick.token.strongNumber);
              setQuick(null);
            }}
          >
            Abrir en Léxicos y Concordancia ➔
          </button>
        </div>
      )}
    </div>
  );
}
