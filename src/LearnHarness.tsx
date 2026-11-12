import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RagContext } from "./StudyAssistant";

type Mode = "harness" | "graph";
interface LearningSession {
  id: string; goalTitle: string; topicCategory: string; stage: string;
  dependencyPlan: Array<{ id: string; title: string; status: string }>;
  messages: Array<{ role: string; text: string; refs?: string[] }>;
  activeStepId: string; createdAt: number; updatedAt: number;
}
interface Proposition {
  id: string; sessionId: string; claim: string; reasoningPremise: string;
  relatedRefs: string[]; relatedStrongs: string[]; masteryState: string; createdAt: number;
}

export default function LearnHarness({
  mode, onModeChange, onOpenContext,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onOpenContext: (context: RagContext) => void;
}) {
  const [sessions, setSessions] = useState<LearningSession[]>([]);
  const [active, setActive] = useState<LearningSession | null>(null);
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [answer, setAnswer] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [confidence, setConfidence] = useState<"low" | "medium" | "high">("medium");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  async function refresh() {
    const [list, graph] = await Promise.all([
      invoke<LearningSession[]>("learning_session_list"),
      invoke<Proposition[]>("knowledge_graph_list", { sessionId: null }),
    ]);
    setSessions(list);
    setPropositions(graph);
    if (!active && list[0]) setActive(list[0]);
  }
  useEffect(() => { void refresh(); }, []);

  async function saveSession(next: LearningSession) {
    const saved = await invoke<LearningSession>("learning_session_save", {
      input: {
        id: next.id, goalTitle: next.goalTitle, topicCategory: next.topicCategory,
        stage: next.stage, dependencyPlan: next.dependencyPlan, messages: next.messages,
        activeStepId: next.activeStepId,
      },
    });
    setActive(saved);
    setSessions((current) => [saved, ...current.filter((s) => s.id !== saved.id)]);
  }

  async function createSession() {
    if (!goal.trim()) return;
    const next: LearningSession = {
      id: "", goalTitle: goal.trim(), topicCategory: "exegesis", stage: "measure",
      dependencyPlan: [], messages: [], activeStepId: "", createdAt: Date.now(), updatedAt: Date.now(),
    };
    await saveSession(next);
    setGoal("");
  }

  async function advance() {
    if (!active || busy) return;
    setBusy(true);
    try {
      const contexts = await invoke<Array<{ text: string; label: string; resourceTitle: string }>>(
        "search_everything", { query: active.goalTitle, limit: 5 },
      ).catch(() => []);
      const steps = [
        { id: "measure", title: "Medir comprensión", status: "active" },
        { id: "plan", title: "Planificar dependencias", status: "pending" },
        { id: "teach", title: "Enseñar un nodo", status: "pending" },
        { id: "practice", title: "Practicar con otro pasaje", status: "pending" },
      ];
      const nextStage = active.stage === "measure" ? "plan" : active.stage === "plan" ? "teach" : active.stage === "teach" ? "practice" : "practice";
      const refs = contexts.slice(0, 3).map((context) => context.label);
      const text = active.stage === "measure"
        ? `Antes de avanzar, responde: ¿qué crees que significa «${active.goalTitle}» y en qué texto te apoyas?`
        : active.stage === "plan"
          ? `Plan propuesto: 1) contexto literario, 2) término clave, 3) argumento del pasaje, 4) aplicación. Revisa el primer nodo y escribe tu predicción.`
          : active.stage === "teach"
            ? `Contrasta tu respuesta con las fuentes locales: ${contexts.map((c) => `${c.label} — ${c.text.slice(0, 120)}`).join(" · ")}`
            : `Practica: busca otro pasaje donde aparezca el mismo principio y explica cómo lo reconocerías sin que yo lo nombre.`;
      const next: LearningSession = {
        ...active, stage: nextStage,
        dependencyPlan: steps.map((step) => ({ ...step, status: step.id === nextStage ? "active" : ["measure", "plan"].includes(step.id) && nextStage !== step.id ? "done" : "pending" })),
        messages: [...active.messages, { role: "assistant", text, refs }],
        activeStepId: nextStage,
      };
      await saveSession(next);
      if (answer.trim() && (active.stage === "teach" || active.stage === "practice")) {
        await invoke("knowledge_proposition_add", {
          sessionId: active.id, claim: answer.trim(), reasoningPremise: reasoning.trim(),
          relatedRefs: refs, relatedStrongs: [],
        });
      }
      setAnswer(""); setReasoning("");
      await refresh();
    } finally { setBusy(false); }
  }

  async function saveToNotes(prop: Proposition) {
    const text = `${prop.claim}\n\nRazonamiento: ${prop.reasoningPremise}\n\n${prop.relatedRefs.map((ref) => `[[${ref}]]`).join(" ")}`;
    await invoke("note_create", {
      input: {
        notebookId: null,
        title: prop.claim.slice(0, 80),
        contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
        tags: ["Arnés de aprendizaje"],
        anchors: [],
      },
    });
  }

  const filteredProps = useMemo(
    () => propositions.filter((p) => !filter || `${p.claim} ${p.reasoningPremise}`.toLowerCase().includes(filter.toLowerCase())),
    [propositions, filter],
  );

  return (
    <div className="learnharness">
      <div className="learnharness-tabs">
        <button type="button" className={mode === "harness" ? "active" : ""} onClick={() => onModeChange("harness")}>Arnés de Aprendizaje</button>
        <button type="button" className={mode === "graph" ? "active" : ""} onClick={() => onModeChange("graph")}>Grafo de Conocimiento</button>
      </div>

      {mode === "harness" ? (
        <div className="learnharness-layout">
          <aside className="learnharness-sidebar">
            <div className="learnharness-new">
              <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Nueva meta de aprendizaje…" onKeyDown={(e) => e.key === "Enter" && void createSession()} />
              <button type="button" onClick={() => void createSession()}>+ Nueva meta</button>
            </div>
            {sessions.map((session) => (
              <button type="button" key={session.id} className={`learnharness-session ${active?.id === session.id ? "active" : ""}`} onClick={() => setActive(session)}>
                <strong>{session.goalTitle}</strong><small>{session.stage}</small>
              </button>
            ))}
            {active && (
              <div className="learnharness-plan">
                <span className="learnharness-label">Mapa de dependencias</span>
                {["measure", "plan", "teach", "practice"].map((stage, index) => (
                  <div key={stage} className={active.stage === stage ? "active" : ""}>
                    <b>{index < ["measure", "plan", "teach", "practice"].indexOf(active.stage) ? "✓" : active.stage === stage ? "●" : "○"}</b>
                    {index + 1}. {stage === "measure" ? "Medir" : stage === "plan" ? "Planificar" : stage === "teach" ? "Enseñar" : "Practicar"}
                  </div>
                ))}
              </div>
            )}
          </aside>

          <main className="learnharness-main">
            {active ? (
              <>
                <header><strong>{active.goalTitle}</strong><span>{active.stage}</span></header>
                <div className="learnharness-conversation">
                  {active.messages.map((message, index) => (
                    <article key={index} className={message.role}>
                      <p>{message.text}</p>
                      {message.refs?.map((ref) => <button type="button" key={ref} onClick={() => {
                        const match = ref.match(/(.+?)\s+(\d+):(\d+)/);
                        if (match) onOpenContext({ id: ref, kind: "bible", resourceId: "", resourceTitle: "Biblia", label: ref, text: "", book: 0, chapter: Number(match[2]), verse: Number(match[3]), spine: 0 } as RagContext);
                      }}>{ref}</button>)}
                    </article>
                  ))}
                </div>
                <div className="learnharness-think">
                  <label><span>Tu respuesta o predicción</span><textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} /></label>
                  <label><span>Tu razonamiento o duda</span><textarea value={reasoning} onChange={(e) => setReasoning(e.target.value)} rows={2} /></label>
                  <div className="learnharness-confidence">
                    <span>Seguridad:</span>
                    {(["low", "medium", "high"] as const).map((level) => (
                      <button type="button" key={level} className={confidence === level ? "active" : ""} onClick={() => setConfidence(level)}>{level === "low" ? "Baja" : level === "medium" ? "Media" : "Alta"}</button>
                    ))}
                    <button type="button" className="primary-button" onClick={() => void advance()} disabled={busy}>{busy ? "Avanzando…" : "Avanzar y consolidar"}</button>
                  </div>
                </div>
              </>
            ) : <p className="empty-hint">Crea una meta para comenzar.</p>}
          </main>
        </div>
      ) : (
        <div className="learnharness-graph">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar proposiciones…" />
          <div className="learnharness-graph-list">
            {filteredProps.map((prop) => (
              <article key={prop.id}>
                <strong>{prop.claim}</strong>
                <p>{prop.reasoningPremise}</p>
                <div>{prop.relatedRefs.map((ref) => <span key={ref}>{ref}</span>)}{prop.relatedStrongs.map((s) => <span key={s}>{s}</span>)}</div>
                <button type="button" onClick={() => void saveToNotes(prop)}>Guardar en Notas</button>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
