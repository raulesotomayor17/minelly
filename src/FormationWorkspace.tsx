import { useEffect, useMemo, useState } from "react";

export type FormationTab = "prayer" | "guides";

interface FormationWorkspaceProps {
  initialTab?: FormationTab;
  onClose: () => void;
}

type PrayerFrequency = "daily" | "weekly" | "monthly" | "once";

interface Prayer {
  id: string;
  title: string;
  body: string;
  tags: string[];
  frequency: PrayerFrequency;
  scheduledDate: string;
  answered: boolean;
  answerNote: string;
  createdAt: number;
}

interface PrayerPlan {
  day: number;
  started: boolean;
}

interface GuideStep {
  title: string;
  prompt: string;
}

interface GuideTemplate {
  id: string;
  name: string;
  description: string;
  steps: GuideStep[];
}

interface GuideState {
  templateId: string;
  step: number;
  answers: string[];
  updatedAt: number;
}

const PRAYER_KEY = "teoamoxtli.prayers.v1";
const PRAYER_PLAN_KEY = "teoamoxtli.prayer-plan.v1";
const GUIDE_KEY = "teoamoxtli.study-guide.v1";

const PRAYER_PROMPTS = [
  "Alabanza: reconoce quién es Dios hoy.",
  "Confesión: entrega lo que te aparta de Él.",
  "Gratitud: nombra tres dones concretos.",
  "Intercesión: ora por tu familia y tu iglesia.",
  "Petición: presenta una necesidad con confianza.",
  "Escucha: guarda silencio y medita en un salmo.",
  "Descanso: agradece la fidelidad de Dios esta semana.",
];

const GUIDE_TEMPLATES: GuideTemplate[] = [
  {
    id: "inductivo",
    name: "Método inductivo",
    description: "Observa, interpreta y aplica un pasaje.",
    steps: [
      { title: "Observa", prompt: "¿Quién habla, a quién, dónde y qué palabras se repiten?" },
      { title: "Contexto", prompt: "¿Qué ocurre antes y después? ¿A qué género pertenece?" },
      { title: "Interpreta", prompt: "¿Cuál es la idea central del pasaje en su contexto?" },
      { title: "Conecta", prompt: "¿Cómo se relaciona con Cristo y con toda la Escritura?" },
      { title: "Aplica", prompt: "¿Qué verdad, actitud o acción concreta debes cambiar?" },
      { title: "Ora", prompt: "Escribe una oración breve a partir del pasaje." },
    ],
  },
  {
    id: "devocional",
    name: "Devocional personal",
    description: "Lectura, meditación y oración diaria.",
    steps: [
      { title: "Lee", prompt: "Lee el pasaje lentamente y anota una frase que te detenga." },
      { title: "Medita", prompt: "¿Qué te muestra esta frase sobre Dios?" },
      { title: "Examina", prompt: "¿Qué te muestra sobre ti mismo?" },
      { title: "Responde", prompt: "¿Cuál será tu respuesta concreta hoy?" },
      { title: "Ora", prompt: "Convierte lo meditado en oración." },
    ],
  },
  {
    id: "palabra",
    name: "Estudio de palabra",
    description: "Analiza un término, su forma y sus usos.",
    steps: [
      { title: "Identifica", prompt: "Anota la palabra, el Strong y la morfología." },
      { title: "Define", prompt: "Resume la definición léxica con tus palabras." },
      { title: "Compara", prompt: "¿Cómo se usa en otros pasajes? Anota dos referencias." },
      { title: "Contextualiza", prompt: "¿Qué matiz aporta aquí frente a una lectura rápida?" },
      { title: "Aplica", prompt: "¿Cómo enriquece esto tu comprensión del pasaje?" },
    ],
  },
  {
    id: "sermon",
    name: "Preparación de sermón",
    description: "Del texto al bosquejo y la aplicación.",
    steps: [
      { title: "Texto", prompt: "Escribe el pasaje y su idea exegética central." },
      { title: "Caída", prompt: "¿Cuál es la necesidad humana que el texto enfrenta?" },
      { title: "Redención", prompt: "¿Cómo responde el texto con el evangelio?" },
      { title: "Bosquejo", prompt: "Define 3 movimientos con una idea cada uno." },
      { title: "Aplicación", prompt: "¿Qué debe creer, hacer o dejar el oyente?" },
      { title: "Oración", prompt: "Escribe la oración de cierre." },
    ],
  },
];

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizePrayers(): Prayer[] {
  const stored = loadJson<Array<Partial<Prayer>>>(PRAYER_KEY, []);
  return stored
    .filter((item) => item && item.id && item.title)
    .map((item) => ({
      id: String(item.id),
      title: String(item.title),
      body: String(item.body ?? ""),
      tags: Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      frequency:
        item.frequency === "daily" ||
        item.frequency === "weekly" ||
        item.frequency === "monthly" ||
        item.frequency === "once"
          ? item.frequency
          : "daily",
      scheduledDate: String(item.scheduledDate ?? ""),
      answered: Boolean(item.answered),
      answerNote: String(item.answerNote ?? ""),
      createdAt: Number(item.createdAt) || Date.now(),
    }));
}

function frequencyLabel(frequency: PrayerFrequency) {
  if (frequency === "weekly") return "Cada semana";
  if (frequency === "monthly") return "Cada mes";
  if (frequency === "once") return "Una vez";
  return "Cada día";
}

function isScheduledToday(prayer: Prayer) {
  if (prayer.answered) return false;
  if (prayer.frequency === "daily") return true;
  if (!prayer.scheduledDate) return true;
  const today = new Date().toISOString().slice(0, 10);
  return prayer.scheduledDate <= today;
}

export default function FormationWorkspace({
  initialTab = "prayer",
  onClose,
}: FormationWorkspaceProps) {
  const [tab, setTab] = useState<FormationTab>(initialTab);
  const [formationScale, setFormationScale] = useState(() => {
    const stored = Number(localStorage.getItem("teoamoxtli.formation-scale.v1"));
    return Number.isFinite(stored) && stored >= 0.8 && stored <= 1.8 ? stored : 1;
  });
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem("teoamoxtli.formation-expanded.v1") === "1",
  );
  const [prayers, setPrayers] = useState<Prayer[]>(normalizePrayers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prayerPlan, setPrayerPlan] = useState<PrayerPlan>(() =>
    loadJson(PRAYER_PLAN_KEY, { day: 0, started: false }),
  );
  const [guide, setGuide] = useState<GuideState>(() =>
    loadJson(GUIDE_KEY, {
      templateId: "inductivo",
      step: 0,
      answers: [],
      updatedAt: Date.now(),
    }),
  );

  useEffect(() => localStorage.setItem(PRAYER_KEY, JSON.stringify(prayers)), [prayers]);
  useEffect(() => localStorage.setItem(PRAYER_PLAN_KEY, JSON.stringify(prayerPlan)), [prayerPlan]);
  useEffect(() => localStorage.setItem(GUIDE_KEY, JSON.stringify(guide)), [guide]);
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    if (prayers.length > 0 && (!selectedId || !prayers.some((item) => item.id === selectedId))) {
      setSelectedId(prayers[0].id);
    }
  }, [prayers, selectedId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  useEffect(() => {
    localStorage.setItem("teoamoxtli.formation-scale.v1", String(formationScale));
  }, [formationScale]);
  useEffect(() => {
    localStorage.setItem("teoamoxtli.formation-expanded.v1", expanded ? "1" : "0");
  }, [expanded]);

  const template =
    GUIDE_TEMPLATES.find((item) => item.id === guide.templateId) ??
    GUIDE_TEMPLATES[0];
  const guideProgress = Math.round(
    ((guide.step + 1) / template.steps.length) * 100,
  );
  const planPrompt =
    PRAYER_PROMPTS[Math.min(prayerPlan.day, PRAYER_PROMPTS.length - 1)];
  const selected = prayers.find((item) => item.id === selectedId) ?? null;
  const scheduled = prayers.filter(isScheduledToday);
  const answeredCount = prayers.filter((item) => item.answered).length;

  function updatePrayer(id: string, patch: Partial<Prayer>) {
    setPrayers((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function addPrayer() {
    const prayer: Prayer = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: "Nueva oración",
      body: "",
      tags: [],
      frequency: "daily",
      scheduledDate: new Date().toISOString().slice(0, 10),
      answered: false,
      answerNote: "",
      createdAt: Date.now(),
    };
    setPrayers((current) => [prayer, ...current]);
    setSelectedId(prayer.id);
  }

  function removePrayer(id: string) {
    setPrayers((current) => current.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function advancePrayerPlan() {
    setPrayerPlan((current) => ({
      started: true,
      day: Math.min(PRAYER_PROMPTS.length, current.day + 1),
    }));
  }

  function setGuideTemplate(templateId: string) {
    const next =
      GUIDE_TEMPLATES.find((item) => item.id === templateId) ??
      GUIDE_TEMPLATES[0];
    setGuide({
      templateId,
      step: 0,
      answers: Array(next.steps.length).fill(""),
      updatedAt: Date.now(),
    });
  }

  function setGuideAnswer(value: string) {
    setGuide((current) => {
      const answers = [...current.answers];
      answers[current.step] = value;
      return { ...current, answers, updatedAt: Date.now() };
    });
  }

  function sharePrayerList() {
    const text = prayers
      .map(
        (item) =>
          `${item.answered ? "✓" : "○"} ${item.title}${item.body ? ` — ${item.body}` : ""}`,
      )
      .join("\n");
    if (text.trim()) void navigator.clipboard.writeText(text);
  }

  const guideText = useMemo(() => {
    return template.steps
      .map(
        (step, index) =>
          `${index + 1}. ${step.title}\n${guide.answers[index] ?? ""}`,
      )
      .join("\n\n");
  }, [template, guide.answers]);

  return (
    <div className="formation-backdrop" role="dialog" aria-modal="true">
      <section
        className={expanded ? "formation-panel expanded" : "formation-panel"}
        style={{ "--formation-scale": formationScale } as React.CSSProperties}
      >
        <header className="formation-head">
          <div>
            <span className="eyebrow">Formación espiritual</span>
            <h2>Oración y guías de estudio</h2>
          </div>
          <div className="formation-head-actions">
            <button
              type="button"
              className="formation-size-button"
              onClick={() => setFormationScale((current) => Math.max(0.8, current - 0.1))}
              title="Reducir el tamaño de la formación"
            >
              A−
            </button>
            <span className="formation-scale-value">{Math.round(formationScale * 100)}%</span>
            <button
              type="button"
              className="formation-size-button"
              onClick={() => setFormationScale((current) => Math.min(1.8, current + 0.1))}
              title="Aumentar el tamaño de la formación"
            >
              A+
            </button>
            <button
              type="button"
              className="formation-size-button"
              onClick={() => setFormationScale(1)}
              title="Restablecer al 100%"
            >
              100%
            </button>
            <button
              type="button"
              className="formation-size-button"
              onClick={() => setExpanded((current) => !current)}
              title={expanded ? "Restaurar tamaño" : "Maximizar formación"}
            >
              {expanded ? "Restaurar" : "Maximizar"}
            </button>
            <button type="button" className="word-study-close" onClick={onClose} aria-label="Cerrar">
              ×
            </button>
          </div>
        </header>
        <div className="formation-tabs" role="tablist">
          <button type="button" className={tab === "prayer" ? "active" : ""} onClick={() => setTab("prayer")}>
            Lista de oración
          </button>
          <button type="button" className={tab === "guides" ? "active" : ""} onClick={() => setTab("guides")}>
            Guías de estudio
          </button>
        </div>

        {tab === "prayer" && (
          <div className="formation-body prayer-document">
            <div className="prayer-document-head">
              <div>
                <span className="home-card-kicker">DOCUMENTO · LISTA DE ORACIÓN</span>
                <h3>Lista de oración devocional</h3>
                <p className="home-muted">
                  {answeredCount} respondidas · {prayers.length} totales
                </p>
              </div>
              <div className="prayer-document-actions">
                <button type="button" className="home-primary" onClick={addPrayer}>
                  + Agregar oración
                </button>
                <button type="button" className="secondary-button" onClick={sharePrayerList}>
                  Compartir
                </button>
              </div>
            </div>

            <div className="prayer-document-grid">
              <div className="prayer-lists">
                <article className="formation-card prayer-plan-card">
                  <div className="formation-card-head">
                    <span className="home-card-kicker">PLAN DEVOCIONAL · 7 DÍAS</span>
                    <strong>{Math.min(prayerPlan.day, 7)}/7</strong>
                  </div>
                  <p>{planPrompt}</p>
                  <div className="home-progress">
                    <span style={{ width: `${Math.min(100, (prayerPlan.day / 7) * 100)}%` }} />
                  </div>
                  <button
                    type="button"
                    className="home-primary"
                    onClick={advancePrayerPlan}
                    disabled={prayerPlan.day >= 7}
                  >
                    {prayerPlan.started ? "Marcar hoy completado" : "Comenzar plan"}
                  </button>
                </article>

                <div className="prayer-section">
                  <div className="prayer-section-head">
                    <h4>Calendarizado</h4>
                    <span>HOY</span>
                  </div>
                  {scheduled.map((prayer) => (
                    <div className="prayer-line" key={prayer.id}>
                      <button
                        type="button"
                        className="prayer-check"
                        onClick={() => updatePrayer(prayer.id, { answered: true })}
                        title="Marcar respondida"
                      >
                        ○
                      </button>
                      <button
                        type="button"
                        className="prayer-line-title"
                        onClick={() => setSelectedId(prayer.id)}
                      >
                        {prayer.title}
                      </button>
                      <small>{frequencyLabel(prayer.frequency)}</small>
                    </div>
                  ))}
                  {scheduled.length === 0 && (
                    <p className="home-muted">No hay oraciones programadas para hoy.</p>
                  )}
                </div>

                <div className="prayer-section">
                  <div className="prayer-section-head">
                    <h4>Todas las oraciones</h4>
                    <span>{prayers.length}</span>
                  </div>
                  {prayers.map((prayer) => (
                    <div
                      className={
                        selectedId === prayer.id
                          ? "prayer-line selected"
                          : prayer.answered
                            ? "prayer-line answered"
                            : "prayer-line"
                      }
                      key={prayer.id}
                    >
                      <button
                        type="button"
                        className="prayer-check"
                        onClick={() => updatePrayer(prayer.id, { answered: !prayer.answered })}
                        title={prayer.answered ? "Volver a pendiente" : "Marcar respondida"}
                      >
                        {prayer.answered ? "✓" : "○"}
                      </button>
                      <button
                        type="button"
                        className="prayer-line-title"
                        onClick={() => setSelectedId(prayer.id)}
                      >
                        {prayer.title}
                      </button>
                      {prayer.tags.length > 0 && (
                        <span className="prayer-tags">{prayer.tags.join(" · ")}</span>
                      )}
                    </div>
                  ))}
                  {prayers.length === 0 && (
                    <p className="home-muted">Agrega tu primera oración.</p>
                  )}
                </div>
              </div>

              <div className="prayer-editor">
                {selected ? (
                  <article className="formation-card">
                    <div className="formation-card-head">
                      <span className="home-card-kicker">DETALLE DE ORACIÓN</span>
                      <button
                        type="button"
                        className="prayer-delete"
                        onClick={() => removePrayer(selected.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                    <label className="prayer-field">
                      <span>Nombre</span>
                      <input
                        value={selected.title}
                        onChange={(event) => updatePrayer(selected.id, { title: event.target.value })}
                      />
                    </label>
                    <label className="prayer-field">
                      <span>Notas / petición</span>
                      <textarea
                        rows={5}
                        value={selected.body}
                        onChange={(event) => updatePrayer(selected.id, { body: event.target.value })}
                      />
                    </label>
                    <label className="prayer-field">
                      <span>Etiquetas (separadas por coma)</span>
                      <input
                        value={selected.tags.join(", ")}
                        onChange={(event) =>
                          updatePrayer(selected.id, {
                            tags: event.target.value
                              .split(",")
                              .map((tag) => tag.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                    <div className="prayer-field-row">
                      <label className="prayer-field">
                        <span>Frecuencia</span>
                        <select
                          value={selected.frequency}
                          onChange={(event) =>
                            updatePrayer(selected.id, {
                              frequency: event.target.value as PrayerFrequency,
                            })
                          }
                        >
                          <option value="daily">Cada día</option>
                          <option value="weekly">Cada semana</option>
                          <option value="monthly">Cada mes</option>
                          <option value="once">Una vez</option>
                        </select>
                      </label>
                      <label className="prayer-field">
                        <span>Fecha</span>
                        <input
                          type="date"
                          value={selected.scheduledDate}
                          onChange={(event) =>
                            updatePrayer(selected.id, { scheduledDate: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <label className="prayer-answered">
                      <input
                        type="checkbox"
                        checked={selected.answered}
                        onChange={(event) =>
                          updatePrayer(selected.id, { answered: event.target.checked })
                        }
                      />
                      <span>Respondida</span>
                    </label>
                    {selected.answered && (
                      <label className="prayer-field">
                        <span>Respuesta / comentario</span>
                        <textarea
                          rows={3}
                          value={selected.answerNote}
                          onChange={(event) =>
                            updatePrayer(selected.id, { answerNote: event.target.value })
                          }
                        />
                      </label>
                    )}
                  </article>
                ) : (
                  <article className="formation-card prayer-empty-editor">
                    <h3>Selecciona una oración</h3>
                    <p className="home-muted">
                      Haz clic en una oración de la lista para editar sus notas,
                      etiquetas y programación. También puedes agregar una nueva.
                    </p>
                  </article>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "guides" && (
          <div className="formation-body guide-layout">
            <aside className="guide-sidebar">
              <span className="home-card-kicker">PLANTILLA</span>
              {GUIDE_TEMPLATES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={guide.templateId === item.id ? "guide-template active" : "guide-template"}
                  onClick={() => setGuideTemplate(item.id)}
                >
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </button>
              ))}
            </aside>
            <div className="guide-main">
              <div className="formation-card-head">
                <span className="home-card-kicker">{template.name.toUpperCase()}</span>
                <strong>{guideProgress}%</strong>
              </div>
              <div className="home-progress">
                <span style={{ width: `${guideProgress}%` }} />
              </div>
              <div className="guide-steps">
                {template.steps.map((step, index) => (
                  <button
                    type="button"
                    key={step.title}
                    className={guide.step === index ? "guide-step active" : guide.step > index ? "guide-step done" : "guide-step"}
                    onClick={() => setGuide((current) => ({ ...current, step: index }))}
                  >
                    <span>{guide.step > index ? "✓" : index + 1}</span>
                    {step.title}
                  </button>
                ))}
              </div>
              <article className="formation-card guide-answer">
                <h3>{template.steps[guide.step].title}</h3>
                <p className="home-muted">{template.steps[guide.step].prompt}</p>
                <textarea
                  value={guide.answers[guide.step] ?? ""}
                  onChange={(event) => setGuideAnswer(event.target.value)}
                  placeholder="Escribe tu respuesta…"
                  rows={9}
                />
                <div className="guide-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setGuide((current) => ({ ...current, step: Math.max(0, current.step - 1) }))}
                    disabled={guide.step === 0}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="home-primary"
                    onClick={() =>
                      setGuide((current) => ({
                        ...current,
                        step: Math.min(template.steps.length - 1, current.step + 1),
                      }))
                    }
                    disabled={guide.step >= template.steps.length - 1}
                  >
                    Siguiente
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      if (guideText.trim()) void navigator.clipboard.writeText(guideText);
                    }}
                  >
                    Copiar guía
                  </button>
                </div>
              </article>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
