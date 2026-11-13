import { useEffect, useMemo, useState } from "react";
import { greetingForHour, initialsFor, type UserProfile } from "./profile";

interface DashboardProps {
  currentBible: string;
  currentBook: string;
  currentBookNumber: number;
  currentChapter: number;
  currentVerse: number;
  readingPercent?: number;
  profile: UserProfile;
  onOpenProfile: () => void;
  bibleCount: number;
  commentaryCount: number;
  bookCount: number;
  dictionaryCount: number;
  onOpenBible: (book: number, chapter: number, verse?: number) => void;
  onOpenLibrary: () => void;
  onOpenSearch: () => void;
  onOpenAssistant: (question: string) => void;
  onOpenWordStudy: (query: string) => void;
  onOpenNotes: () => void;
  onOpenSermons: () => void;
  onOpenModular: () => void;
  onOpenHermeneutics: () => void;
  onOpenDocuments: () => void;
  onOpenPrayer: () => void;
  onOpenGuides: () => void;
}

const NT_CHAPTERS: Array<[number, number]> = [
  [40, 28], [41, 16], [42, 24], [43, 21], [44, 28], [45, 16],
  [46, 16], [47, 13], [48, 6], [49, 6], [50, 4], [51, 4],
  [52, 5], [53, 3], [54, 6], [55, 4], [56, 3], [57, 1],
  [58, 13], [59, 5], [60, 5], [61, 3], [62, 5], [63, 1],
  [64, 1], [65, 1], [66, 22],
];
const PLAN_DAYS = 87;
const PLAN_KEY = "teoamoxtli.reading-plan.v1";

interface Reading {
  book: number;
  chapter: number;
}

function readingForDay(day: number): Reading[] {
  let remaining = day * 3;
  const result: Reading[] = [];
  for (const [book, chapters] of NT_CHAPTERS) {
    if (remaining >= chapters) {
      remaining -= chapters;
      continue;
    }
    for (let chapter = remaining + 1; chapter <= chapters && result.length < 3; chapter += 1) {
      result.push({ book, chapter });
    }
    remaining = 0;
    if (result.length >= 3) break;
  }
  return result;
}

function readingLabel(readings: Reading[], books: string[]): string {
  if (readings.length === 0) return "Plan completado";
  const first = readings[0];
  const last = readings[readings.length - 1];
  const firstName = books[first.book - 1] ?? `Libro ${first.book}`;
  if (readings.length === 1) return `${firstName} ${first.chapter}`;
  if (first.book === last.book) {
    return `${firstName} ${first.chapter}–${last.chapter}`;
  }
  return `${firstName} ${first.chapter} → ${books[last.book - 1] ?? last.book} ${last.chapter}`;
}

export default function Dashboard({
  currentBible,
  currentBook,
  currentBookNumber,
  currentChapter,
  currentVerse,
  readingPercent = 0,
  profile,
  onOpenProfile,
  bibleCount,
  commentaryCount,
  bookCount,
  dictionaryCount,
  onOpenBible,
  onOpenLibrary,
  onOpenSearch,
  onOpenAssistant,
  onOpenWordStudy,
  onOpenNotes,
  onOpenSermons,
  onOpenModular,
  onOpenHermeneutics,
  onOpenDocuments,
  onOpenPrayer,
  onOpenGuides,
}: DashboardProps) {
  const [question, setQuestion] = useState("");
  const [word, setWord] = useState("");
  const [planDay, setPlanDay] = useState(() => {
    try {
      const raw = localStorage.getItem(PLAN_KEY);
      return raw ? Math.max(0, Number(JSON.parse(raw).day) || 0) : 0;
    } catch {
      return 0;
    }
  });
  const [planStarted, setPlanStarted] = useState(() => {
    try {
      return Boolean(JSON.parse(localStorage.getItem(PLAN_KEY) ?? "{}").started);
    } catch {
      return false;
    }
  });
  const [bookNames, setBookNames] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem(
      PLAN_KEY,
      JSON.stringify({ started: planStarted, day: planDay, updatedAt: Date.now() }),
    );
  }, [planStarted, planDay]);

  useEffect(() => {
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<Array<{ number: number; name: string }>>("books")
        .then((items) => setBookNames(items.map((item) => item.name)))
        .catch(() => undefined);
    });
  }, []);

  const today = useMemo(() => readingForDay(planDay), [planDay]);
  const todayLabel = readingLabel(today, bookNames);
  const progress = Math.min(100, Math.round((planDay / PLAN_DAYS) * 100));
  const dateLabel = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  function ask() {
    const value = question.trim();
    if (!value) return;
    onOpenAssistant(value);
  }

  function openPlan() {
    const readings = readingForDay(planDay);
    if (readings.length > 0) {
      onOpenBible(readings[0].book, readings[0].chapter, 1);
    }
    setPlanStarted(true);
    setPlanDay((current) => Math.min(PLAN_DAYS, current + 1));
  }

  return (
    <section className="home-dashboard" aria-label="Panel de control">
      <div className="home-dashboard-inner">
        <header className="home-dashboard-head">
          <div className="home-greeting">
            <button type="button" className="profile-avatar home-avatar" onClick={onOpenProfile} title={profile.name ? "Editar perfil" : "Añadir foto y nombre"}>
              {profile.photo ? <img src={profile.photo} alt={`Perfil de ${profile.name || "usuario"}`} /> : <span>{initialsFor(profile.name)}</span>}
            </button>
            <div>
              <span className="eyebrow">Panel de control</span>
              <h1>{greetingForHour()}{profile.name ? `, ${profile.name}` : ""}</h1>
              <p>{dateLabel} · {currentBible}</p>
            </div>
          </div>
          <div className="home-ask">
            <span>✦</span>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") ask();
              }}
              placeholder="¿Qué quieres estudiar hoy?"
              aria-label="Preguntar al Asistente"
            />
            <button type="button" onClick={ask}>Preguntar</button>
          </div>
        </header>

        <div className="home-dashboard-grid">
          <article className="home-card home-help">
            <div className="home-card-heading">
              <span className="home-card-kicker">COMENZAR</span>
              <h2>¿Necesitas ayuda?</h2>
            </div>
            <div className="home-quick-grid">
              <button type="button" onClick={() => onOpenBible(currentBookNumber, currentChapter, currentVerse)}>
                <span>▤</span>
                <strong>Leer Biblia</strong>
                <small>Continúa tu lectura</small>
              </button>
              <button type="button" onClick={onOpenLibrary}>
                <span>▥</span>
                <strong>Biblioteca</strong>
                <small>{bibleCount + commentaryCount + bookCount + dictionaryCount} recursos</small>
              </button>
              <button type="button" onClick={onOpenSearch}>
                <span>⌕</span>
                <strong>Buscar</strong>
                <small>En toda la biblioteca</small>
              </button>
              <button type="button" onClick={() => onOpenAssistant("")}>
                <span>✦</span>
                <strong>Asistente</strong>
                <small>Pregunta con contexto</small>
              </button>
              <button type="button" onClick={onOpenNotes}>
                <span>▤</span>
                <strong>Notas</strong>
                <small>Tus anotaciones</small>
              </button>
              <button type="button" onClick={onOpenModular}>
                <span>⊞</span>
                <strong>Lienzo</strong>
                <small>Estudio modular</small>
              </button>
              <button type="button" onClick={onOpenHermeneutics}>
                <span>⚖</span>
                <strong>Hermenéutica</strong>
                <small>Interpretar paso a paso</small>
              </button>
              <button type="button" onClick={onOpenDocuments}>
                <span>▤</span>
                <strong>Documentos</strong>
                <small>Oración y guías</small>
              </button>
              <button type="button" onClick={onOpenPrayer}>
                <span>♱</span>
                <strong>Oración</strong>
                <small>Plan y lista personal</small>
              </button>
              <button type="button" onClick={onOpenGuides}>
                <span>▤</span>
                <strong>Guías</strong>
                <small>Estudio paso a paso</small>
              </button>

            </div>
          </article>

          <article className="home-card home-reading">
            <div className="home-card-heading">
              <span className="home-card-kicker">LECTURA ACTUAL</span>
              <button
                type="button"
                className="home-link"
                onClick={() => onOpenBible(currentBookNumber, currentChapter, currentVerse)}
              >
                Abrir
              </button>
            </div>
            <h2>{currentBook}</h2>
            <p className="home-reference">{currentChapter}:{currentVerse}</p>
            <p className="home-muted">{currentBible}</p>
            <div className="home-progress"><span style={{ width: `${readingPercent}%` }} /></div>
            <small className="home-muted">{Math.round(readingPercent)}% completado · Continuar lectura</small>
          </article>

          <article className="home-card home-plan">
            <div className="home-card-heading">
              <span className="home-card-kicker">PLANES DE LECTURA</span>
              <span className="home-count">{planDay}/{PLAN_DAYS}</span>
            </div>
            <h2>Nuevo Testamento en 87 días</h2>
            <p className="home-muted">{planStarted ? `Siguiente: ${todayLabel}` : "Tres capítulos por día"}</p>
            <div className="home-progress"><span style={{ width: `${progress}%` }} /></div>
            <div className="home-plan-actions">
              <button type="button" className="home-primary" onClick={openPlan}>
                {planStarted ? "Continuar plan" : "Comenzar plan"}
              </button>
              <span className="home-muted">{progress}% completado</span>
            </div>
          </article>

          <article className="home-card home-word">
            <div className="home-card-heading">
              <span className="home-card-kicker">ESTUDIO DE PALABRA</span>
            </div>
            <h2>Explora el original</h2>
            <p className="home-muted">Strong, lema o transliteración.</p>
            <form
              className="home-word-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (word.trim()) onOpenWordStudy(word.trim());
              }}
            >
              <input
                value={word}
                onChange={(event) => setWord(event.target.value)}
                placeholder="G26, H430, agape…"
                aria-label="Buscar Strong o palabra"
              />
              <button type="submit">Buscar</button>
            </form>
          </article>

          <article className="home-card home-library">
            <div className="home-card-heading">
              <span className="home-card-kicker">BIBLIOTECA</span>
              <button type="button" className="home-link" onClick={onOpenLibrary}>Gestionar</button>
            </div>
            <h2>Tu biblioteca</h2>
            <div className="home-stats">
              <span><strong>{bibleCount}</strong>Biblias</span>
              <span><strong>{commentaryCount}</strong>Comentarios</span>
              <span><strong>{bookCount}</strong>Libros</span>
              <span><strong>{dictionaryCount}</strong>Diccionarios</span>
            </div>
          </article>

          <article className="home-card home-sermons">
            <div className="home-card-heading">
              <span className="home-card-kicker">SERMONES</span>
            </div>
            <h2>Prepara tu próximo mensaje</h2>
            <p className="home-muted">Bosquejo, diapositivas y exportación.</p>
            <button type="button" className="home-primary" onClick={onOpenSermons}>
              Abrir Sermones
            </button>
          </article>
        </div>
      </div>
    </section>
  );
}
