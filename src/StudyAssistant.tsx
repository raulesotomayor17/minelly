import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PaperModePicker } from "./CustomizationModal";

export interface RagContext {
  id: string;
  kind: string;
  resourceId: string;
  resourceTitle: string;
  label: string;
  text: string;
  book: number;
  chapter: number;
  verse: number;
  spine: number;
}

export interface RagAnswer {
  answer: string;
  contexts: RagContext[];
  model: string;
  localOnly: boolean;
}

interface SearchHit {
  kind: string;
  resourceId: string;
  resourceTitle: string;
  label: string;
  book: number;
  chapter: number;
  verse: number;
  html: string;
}

interface StudyAssistantProps {
  initialQuestion?: string;
  onClose: () => void;
  onOpenContext: (context: RagContext) => void;
  onOpenCustomization?: () => void;
}

export type AiProviderId =
  | "deepseek"
  | "gemini"
  | "openai-compatible"
  | "harvard-local";

export type AcademicPersonaId =
  | "harvard-exegesis"
  | "harvard-theology"
  | "pedagogical-mentor"
  | "comparative-seminar";

export interface TokenUsageRecord {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  provider: string;
  model: string;
  timestamp: string;
}

export interface ConversationTurn {
  id: string;
  query: string;
  taskLabel: string;
  personaLabel: string;
  providerLabel: string;
  model: string;
  answer: string;
  reasoning?: string;
  usedRemoteModel: boolean;
  contexts: RagContext[];
  usage: TokenUsageRecord;
}

interface ProviderPreset {
  id: AiProviderId;
  name: string;
  badge: string;
  defaultBaseUrl: string;
  defaultModel: string;
  models: { value: string; label: string }[];
  keyPlaceholder: string;
  helpText: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek / DeepSeek Harness",
    badge: "OpenAI-Compatible · Tokens por consumo",
    defaultBaseUrl: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat",
    models: [
      { value: "deepseek-chat", label: "deepseek-chat (DeepSeek-V3 · Académico rápido)" },
      { value: "deepseek-reasoner", label: "deepseek-reasoner (DeepSeek-R1 · Razonamiento profundo)" },
    ],
    keyPlaceholder: "sk-... (Tu API Key de DeepSeek o DeepSeek Harness)",
    helpText:
      "Conecta con la API oficial de DeepSeek o con tu propio endpoint de DeepSeek Harness. El gasto de tokens se calcula exactamente según el consumo devuelto por tu cuenta.",
  },
  {
    id: "gemini",
    name: "Google Gemini LLM (Google AI)",
    badge: "Google Generative Language API · Directo",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    models: [
      { value: "gemini-2.5-flash", label: "gemini-2.5-flash (Rápido, gran ventana de contexto)" },
      { value: "gemini-2.5-pro", label: "gemini-2.5-pro (Máxima profundidad académica y filológica)" },
      { value: "gemini-2.0-flash", label: "gemini-2.0-flash (Equilibrado y veloz)" },
    ],
    keyPlaceholder: "AIzaSy... (Tu API Key de Google AI Studio / Gemini)",
    helpText:
      "¡Sí es totalmente compatible! Conecta directamente con los modelos Google Gemini mediante tu clave de Google AI Studio (aistudio.google.com) y reporta los tokens exactos consumidos.",
  },
  {
    id: "openai-compatible",
    name: "Proveedor Compatible / Harness / Local",
    badge: "OpenAI / OpenRouter / Ollama / LM Studio",
    defaultBaseUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    models: [
      { value: "gpt-4o-mini", label: "gpt-4o-mini (Rápido y económico)" },
      { value: "gpt-4o", label: "gpt-4o (Alta precisión académica)" },
      { value: "claude-3-7-sonnet", label: "claude-3-7-sonnet (vía OpenRouter / Harness)" },
      { value: "llama3.3", label: "llama3.3 (Local vía Ollama / LM Studio)" },
    ],
    keyPlaceholder: "sk-... (Opcional si usas servidor local Ollama / LM Studio)",
    helpText:
      "Permite conectar cualquier proveedor compatible con el estándar OpenAI Chat Completions, proxies corporativos, OpenRouter o servidores locales.",
  },
  {
    id: "harvard-local",
    name: "Cátedra Académica Local (Sin API externa)",
    badge: "100% Local · 0 Tokens · Nivel Harvard",
    defaultBaseUrl: "local://harvard-exegesis-engine",
    defaultModel: "harvard-seminar-local-v2",
    models: [
      {
        value: "harvard-seminar-local-v2",
        label: "Motor Exegético y Documental Harvard (Síntesis Local Multi-Fuente)",
      },
    ],
    keyPlaceholder: "No requiere API Key (procesamiento 100% local)",
    helpText:
      "Agente autónomo local que cruza tus Biblias, Comentarios, Diccionarios y Libros importados para redactar un informe académico estructurado sin gastar tokens.",
  },
];

interface PersonaOption {
  id: AcademicPersonaId;
  title: string;
  subtitle: string;
  systemPrompt: string;
}

const ACADEMIC_PERSONAS: PersonaOption[] = [
  {
    id: "harvard-exegesis",
    title: "Cátedra Exegética Harvard",
    subtitle: "Filología Hebrea/Griega, método histórico-gramatical y aparato crítico",
    systemPrompt: `Actúas como Catedrático Senior de Exégesis Bíblica, Filología Semítica/Helénica y Literatura del Antiguo Cercano Oriente en la Universidad de Harvard (Harvard Divinity School / Department of Near Eastern Languages and Civilizations).
Tu objetivo es acompañar al investigador con rigor académico de clase mundial, claridad pedagógica y absoluta fidelidad documental a los recursos de su biblioteca en Minelly.

Directrices de Cátedra:
1. Fundamenta cada afirmación en los fragmentos recuperados de la biblioteca del usuario, citando siempre su identificador entre corchetes, por ejemplo [V1], [C2], [D3], [L4].
2. Estructura tu exposición con nivel de seminario doctoral pero lectura clara y amena:
   - I. Tesis Exegética y Contexto Literario-Histórico
   - II. Análisis Textual y Comparativo de las Fuentes Bíblicas
   - III. Examen Filológico, Léxico y Semántico (términos clave, raíces hebreas/griegas o matices de traducción)
   - IV. Diálogo con los Comentarios, Diccionarios y Libros de la Biblioteca
   - V. Síntesis Teológica y Conclusiones para el Estudio
3. Si una inferencia proviene del marco filológico/histórico general más allá de los fragmentos literales, indícalo con transparencia académica.`,
  },
  {
    id: "harvard-theology",
    title: "Seminario de Teología e Historia",
    subtitle: "Teología sistemática, historia de la interpretación y síntesis doctrinal",
    systemPrompt: `Actúas como Profesor Titular de Teología Histórica y Sistemática a nivel de posgrado en Harvard.
Tu labor es analizar los recursos de la biblioteca local del usuario y ofrecer una exposición profunda sobre el desarrollo doctrinal, las conexiones canónicas (Antiguo y Nuevo Testamento) y las posturas hermenéuticas presentes en las fuentes.
Cita siempre las fuentes de la biblioteca usando sus identificadores [V1], [C2], etc., y organiza la respuesta en secciones claras con subtítulos académicos.`,
  },
  {
    id: "pedagogical-mentor",
    title: "Profesor Guía: Explicación y Resumen",
    subtitle: "Acompañamiento paso a paso, resúmenes ejecutivos y explicaciones claras",
    systemPrompt: `Actúas como un Profesor Mentor de excelencia académica en Harvard, especializado en hacer accesibles los conceptos bíblicos, históricos y teológicos más complejos sin perder rigor.
Acompaña al estudiante dando:
1. Resumen Ejecutivo del tema o pasaje consultado.
2. Explicación paso a paso de los textos bíblicos y libros de su biblioteca (citando [V1], [C2], etc.).
3. Puntos Clave para recordar y preguntas de reflexión o investigación adicional.`,
  },
  {
    id: "comparative-seminar",
    title: "Auditoría Comparativa de Fuentes",
    subtitle: "Contrasta traducciones, comentarios, diccionarios y libros importados",
    systemPrompt: `Actúas como Director de un Seminario de Crítica Textual y Literatura Comparada en Harvard.
Tu tarea es contrastar minuciosamente lo que dicen las distintas versiones bíblicas, comentarios, diccionarios y libros presentes en los fragmentos recuperados de la biblioteca del usuario.
Señala convergencias, matices de traducción, énfasis particulares de cada autor/obra y cita cada fuente con su código [V1], [C2], [L3], etc.`,
  },
];

const QUICK_TASKS = [
  {
    id: "exegesis",
    label: "Exégesis profunda",
    prefix: "Realiza una exégesis académica completa y análisis filológico sobre: ",
  },
  {
    id: "summary",
    label: "Resumen estructurado",
    prefix: "Elabora un resumen estructurado y explica los puntos centrales de: ",
  },
  {
    id: "compare",
    label: "Comparar fuentes",
    prefix: "Compara y contrasta lo que enseñan las Biblias, comentarios y libros de mi biblioteca acerca de: ",
  },
  {
    id: "pedagogical",
    label: "Explicación didáctica",
    prefix: "Explícame como profesor guía paso a paso el significado, contexto e implicaciones de: ",
  },
];

const SAMPLE_QUERIES = [
  "Juan 3:2 Nicodemo, las señales y el nuevo nacimiento",
  "Josué 1:1-9 Esfuérzate y sé valiente en el Comentario a Josué",
  "Justificación por la fe y gracia en Romanos",
  "El pacto, el tabernáculo y la presencia de Dios",
];

const CONFIG_STORAGE_KEY = "teoamoxtli.assistant.config.v2";
const TOKEN_STORAGE_KEY = "teoamoxtli.assistant.tokens.v2";

interface StoredAssistantConfig {
  provider: AiProviderId;
  persona: AcademicPersonaId;
  baseUrlByProvider: Record<AiProviderId, string>;
  modelByProvider: Record<AiProviderId, string>;
  apiKeyByProvider: Record<AiProviderId, string>;
  rememberKeys: boolean;
  maxContextItems: number;
  temperature: number;
  textScale: number;
}

const DEFAULT_CONFIG: StoredAssistantConfig = {
  provider: "deepseek",
  persona: "harvard-exegesis",
  baseUrlByProvider: {
    deepseek: "https://api.deepseek.com/chat/completions",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    "openai-compatible": "https://api.openai.com/v1/chat/completions",
    "harvard-local": "local://harvard-exegesis-engine",
  },
  modelByProvider: {
    deepseek: "deepseek-chat",
    gemini: "gemini-2.5-flash",
    "openai-compatible": "gpt-4o-mini",
    "harvard-local": "harvard-seminar-local-v2",
  },
  apiKeyByProvider: {
    deepseek: "",
    gemini: "",
    "openai-compatible": "",
    "harvard-local": "",
  },
  rememberKeys: true,
  maxContextItems: 10,
  temperature: 0.25,
  textScale: 1,
};

function loadAssistantConfig(): StoredAssistantConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<StoredAssistantConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      baseUrlByProvider: {
        ...DEFAULT_CONFIG.baseUrlByProvider,
        ...(parsed.baseUrlByProvider ?? {}),
      },
      modelByProvider: {
        ...DEFAULT_CONFIG.modelByProvider,
        ...(parsed.modelByProvider ?? {}),
      },
      apiKeyByProvider: {
        ...DEFAULT_CONFIG.apiKeyByProvider,
        ...(parsed.apiKeyByProvider ?? {}),
      },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

interface CumulativeTokenStats {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  requestsCount: number;
  byProvider: Record<string, number>;
}

const INITIAL_TOKEN_STATS: CumulativeTokenStats = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  requestsCount: 0,
  byProvider: {},
};

function loadTokenStats(): CumulativeTokenStats {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return INITIAL_TOKEN_STATS;
    return { ...INITIAL_TOKEN_STATS, ...JSON.parse(raw) };
  } catch {
    return INITIAL_TOKEN_STATS;
  }
}

function cleanSnippetText(htmlOrText: string): string {
  return htmlOrText
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "verse":
    case "bible":
      return "Biblia";
    case "commentary":
      return "Comentario";
    case "dictionary":
      return "Diccionario";
    case "book":
    case "pbb":
      return "Libro / Obra";
    default:
      return kind;
  }
}

/**
 * Síntesis Académica Local al Nivel de Cátedra Harvard cuando no se usa API externa (0 tokens)
 * o como respaldo autónomo.
 */
function buildHarvardLocalSynthesis(
  query: string,
  persona: PersonaOption,
  contexts: RagContext[],
): string {
  if (contexts.length === 0) {
    return [
      `# ${persona.title}`,
      `**Consulta de investigación:** *«${query}»*`,
      "",
      "## I. Estado de la Cuestión en el Catálogo Local",
      "No se localizaron fragmentos literales directos para esta formulación exacta en el índice local. Te sugiero:",
      "- Emplear términos nucleares (ej. `Juan 3`, `Nicodemo`, `Josué 1`, `pacto`, `gracia`, `fe`).",
      "- O bien, si conectas tu API Key de **DeepSeek Harness** o **Google Gemini LLM**, el profesor podrá responder combinando tu biblioteca con su acervo filológico e histórico completo.",
    ].join("\n");
  }

  const biblical = contexts.filter((c) => c.kind === "verse" || c.kind === "bible");
  const commentaries = contexts.filter((c) => c.kind === "commentary");
  const dictionaries = contexts.filter((c) => c.kind === "dictionary");
  const books = contexts.filter((c) => c.kind !== "verse" && c.kind !== "bible" && c.kind !== "commentary" && c.kind !== "dictionary");

  const keyTerms = Array.from(
    new Set(
      query
        .replace(/[^\p{L}\p{N}\s:]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4),
    ),
  ).slice(0, 6);

  const lines: string[] = [
    `# ${persona.title} — Informe Exegético y Documental`,
    `**Tema / Pasaje examinado:** *«${query}»*`,
    `**Fuentes primarias y secundarias inspeccionadas:** ${contexts.length} documentos del catálogo local (${biblical.length} pasajes bíblicos, ${commentaries.length} comentarios, ${dictionaries.length} entradas léxicas/diccionario, ${books.length} capítulos de libros/monografías).`,
    "",
    "---",
    "",
    "## I. Planteamiento Exegético y Metodología",
    `Desde la perspectiva de la **${persona.title}** (${persona.subtitle}), el estudio riguroso de *«${query}»* exige articular tres niveles de evidencia documental presentes en tu biblioteca de Teoamoxtli: (1) el testimonio textual bíblico primario, (2) la recepción hermenéutica en los comentarios exegéticos, y (3) la precisión semántica y monográfica aportada por los diccionarios y libros especializados.`,
    keyTerms.length > 0
      ? `\n**Ejes semánticos detectados en la consulta:** ${keyTerms.map((t) => `\`${t}\``).join(" · ")}.`
      : "",
    "",
  ];

  if (biblical.length > 0) {
    lines.push("## II. Testimonio Textual Bíblico Comparado");
    lines.push(
      "Las fuentes canónicas recuperadas establecen el marco primario de lectura:",
      "",
    );
    for (const item of biblical) {
      lines.push(
        `- **[${item.id}] ${item.resourceTitle} — ${item.label}**: «${cleanSnippetText(item.text)}»`,
      );
    }
    lines.push(
      "",
      "**Observación de Cátedra:** Al contrastar las formulaciones verbales de estos pasajes, conviene prestar especial atención a los conectores lógicos, tiempos verbales y títulos empleados en el discurso bíblico, los cuales delimitan el alcance teológico del pasaje.",
      "",
    );
  }

  if (commentaries.length > 0 || books.length > 0) {
    lines.push("## III. Aparato Exegético: Comentarios y Monografías de tu Biblioteca");
    lines.push(
      "El análisis especializado dentro de tus recursos instalados aporta las siguientes claves interpretativas:",
      "",
    );
    for (const item of [...commentaries, ...books]) {
      lines.push(
        `- **[${item.id}] ${item.resourceTitle} (${item.label})**: ${cleanSnippetText(item.text)}`,
      );
    }
    lines.push("");
  }

  if (dictionaries.length > 0) {
    lines.push("## IV. Precisión Léxica, Filológica y Conceptual");
    lines.push(
      "Los repertorios léxicos y diccionarios bíblicos de tu colección contextualizan los conceptos clave:",
      "",
    );
    for (const item of dictionaries) {
      lines.push(
        `- **[${item.id}] ${item.resourceTitle} — ${item.label}**: ${cleanSnippetText(item.text)}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## V. Síntesis Magistral y Guía de Estudio",
    `1. **Lectura Sinóptica e Integrada:** Las evidencias reunidas (${contexts.map((c) => `[${c.id}]`).join(", ")}) convergen en mostrar que el tema consultado posee tanto una dimensión histórica inmediata como una proyección teológica canónica.`,
    "2. **Verificación Directa en el Lector:** Haz clic en el botón **«Abrir en el lector»** de cualquiera de las tarjetas del panel derecho para saltar directamente al capítulo, versículo o sección del libro en Minelly.",
    "3. **Profundización con IA Generativa Externa:** Si deseas que este análisis sea expandido con generación libre de párrafos, traducción de raíces hebreas/griegas o resúmenes a medida, selecciona **DeepSeek Harness** o **Google Gemini LLM** arriba e ingresa tu API Key.",
  );

  return lines.join("\n");
}

export function StudyAssistant({
  initialQuestion = "",
  onClose,
  onOpenContext,
  onOpenCustomization,
}: StudyAssistantProps) {
  const [config, setConfig] = useState<StoredAssistantConfig>(loadAssistantConfig);
  const [tokenStats, setTokenStats] = useState<CumulativeTokenStats>(loadTokenStats);
  const [query, setQuery] = useState(
    initialQuestion || "Juan 3:2 Nicodemo y las señales de Jesús",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialQuestion.trim()) setQuery(initialQuestion);
  }, [initialQuestion]);
  const [error, setError] = useState("");
  const [showConfigPanel, setShowConfigPanel] = useState(true);
  const [showKeyPlain, setShowKeyPlain] = useState(false);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const currentProvider = useMemo(
    () =>
      PROVIDER_PRESETS.find((p) => p.id === config.provider) ?? PROVIDER_PRESETS[0],
    [config.provider],
  );

  const currentPersona = useMemo(
    () =>
      ACADEMIC_PERSONAS.find((p) => p.id === config.persona) ?? ACADEMIC_PERSONAS[0],
    [config.persona],
  );

  const activeBaseUrl =
    config.baseUrlByProvider[config.provider] || currentProvider.defaultBaseUrl;
  const activeModel =
    config.modelByProvider[config.provider] || currentProvider.defaultModel;
  const activeApiKey = config.apiKeyByProvider[config.provider] || "";

  useEffect(() => {
    try {
      const toSave: StoredAssistantConfig = {
        ...config,
        apiKeyByProvider: config.rememberKeys
          ? config.apiKeyByProvider
          : {
              deepseek: "",
              gemini: "",
              "openai-compatible": "",
              "harvard-local": "",
            },
      };
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // ignore storage errors
    }
  }, [config]);

  useEffect(() => {
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenStats));
    } catch {
      // ignore storage errors
    }
  }, [tokenStats]);

  const activeTurn = useMemo(
    () => turns.find((t) => t.id === activeTurnId) ?? turns[0] ?? null,
    [turns, activeTurnId],
  );

  function updateProvider(provider: AiProviderId) {
    setConfig((prev) => ({ ...prev, provider }));
  }

  function updatePersona(persona: AcademicPersonaId) {
    setConfig((prev) => ({ ...prev, persona }));
  }

  function updateBaseUrl(value: string) {
    setConfig((prev) => ({
      ...prev,
      baseUrlByProvider: {
        ...prev.baseUrlByProvider,
        [prev.provider]: value,
      },
    }));
  }

  function updateModel(value: string) {
    setConfig((prev) => ({
      ...prev,
      modelByProvider: {
        ...prev.modelByProvider,
        [prev.provider]: value,
      },
    }));
  }

  function updateApiKey(value: string) {
    setConfig((prev) => ({
      ...prev,
      apiKeyByProvider: {
        ...prev.apiKeyByProvider,
        [prev.provider]: value,
      },
    }));
  }

  function adjustTextScale(delta: number) {
    setConfig((prev) => ({
      ...prev,
      textScale: Math.min(1.6, Math.max(0.85, Number((prev.textScale + delta).toFixed(2)))),
    }));
  }

  function recordTokenUsage(usage: TokenUsageRecord) {
    if (usage.totalTokens <= 0) return;
    setTokenStats((prev) => ({
      totalPromptTokens: prev.totalPromptTokens + usage.promptTokens,
      totalCompletionTokens: prev.totalCompletionTokens + usage.completionTokens,
      totalTokens: prev.totalTokens + usage.totalTokens,
      requestsCount: prev.requestsCount + 1,
      byProvider: {
        ...prev.byProvider,
        [usage.provider]: (prev.byProvider[usage.provider] ?? 0) + usage.totalTokens,
      },
    }));
  }

  async function gatherLibraryContexts(searchPrompt: string): Promise<RagContext[]> {
    const cleanQuery = searchPrompt
      .replace(/^Realiza una exégesis académica completa y análisis filológico sobre:\s*/i, "")
      .replace(/^Elabora un resumen estructurado y explica los puntos centrales de:\s*/i, "")
      .replace(/^Compara y contrasta lo que enseñan las Biblias, comentarios y libros de mi biblioteca acerca de:\s*/i, "")
      .replace(/^Explícame como profesor guía paso a paso el significado, contexto e implicaciones de:\s*/i, "")
      .trim();

    const [ragRes, ftsRes, pbbRes] = await Promise.allSettled([
      invoke<RagAnswer>("ask_study_assistant", {
        query: cleanQuery || searchPrompt,
        apiKey: "",
        model: "local",
      }),
      invoke<SearchHit[]>("search", {
        query: cleanQuery || searchPrompt,
        limit: 16,
      }),
      invoke<SearchHit[]>("pbb_search", {
        query: cleanQuery || searchPrompt,
        limit: 10,
      }),
    ]);

    const merged: RagContext[] = [];
    const seen = new Set<string>();

    const pushItem = (item: Omit<RagContext, "id">) => {
      const snippetClean = cleanSnippetText(item.text);
      if (!snippetClean) return;
      const dedupeKey = `${item.resourceId}::${item.label}::${snippetClean.slice(0, 80)}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      const prefix =
        item.kind === "verse" || item.kind === "bible"
          ? "V"
          : item.kind === "commentary"
            ? "C"
            : item.kind === "dictionary"
              ? "D"
              : "L";
      const id = `${prefix}${merged.length + 1}`;
      merged.push({
        ...item,
        id,
        text: snippetClean.slice(0, 620),
      });
    };

    if (ragRes.status === "fulfilled" && ragRes.value?.contexts) {
      for (const ctx of ragRes.value.contexts) {
        pushItem(ctx);
      }
    }

    if (ftsRes.status === "fulfilled" && Array.isArray(ftsRes.value)) {
      for (const hit of ftsRes.value) {
        pushItem({
          kind: hit.kind === "verse" ? "bible" : hit.kind,
          resourceId: hit.resourceId,
          resourceTitle: hit.resourceTitle,
          label: hit.label,
          book: hit.book || 1,
          chapter: hit.chapter || 1,
          verse: hit.verse || 1,
          spine: hit.chapter || 0,
          text: hit.html,
        });
      }
    }

    if (pbbRes.status === "fulfilled" && Array.isArray(pbbRes.value)) {
      for (const hit of pbbRes.value) {
        pushItem({
          kind: hit.kind || "book",
          resourceId: hit.resourceId,
          resourceTitle: hit.resourceTitle,
          label: hit.label,
          book: hit.book || 1,
          chapter: hit.chapter || 1,
          verse: hit.verse || 1,
          spine: hit.chapter || 0,
          text: hit.html,
        });
      }
    }

    return merged.slice(0, config.maxContextItems);
  }

  function buildContextBlock(contexts: RagContext[]): string {
    if (contexts.length === 0) {
      return "No se hallaron fragmentos literales exactos en la búsqueda local para esta consulta; responde con tu conocimiento académico de nivel Harvard indicando que citas el marco general.";
    }
    return contexts
      .map(
        (ctx) =>
          `[${ctx.id}] (${kindLabel(ctx.kind)}) ${ctx.resourceTitle} — ${ctx.label}:\n"${ctx.text}"`,
      )
      .join("\n\n");
  }

  async function callGoogleGemini(
    userQuestion: string,
    contexts: RagContext[],
  ): Promise<{
    answer: string;
    usage: TokenUsageRecord;
  }> {
    const key = activeApiKey.trim();
    if (!key) {
      throw new Error(
        "Ingresa tu API Key de Google Gemini (Google AI Studio) para consultar a Gemini LLM, o cambia el proveedor a «Cátedra Académica Local».",
      );
    }
    const base = activeBaseUrl.replace(/\/+$/, "");
    const modelName = activeModel.trim() || "gemini-2.5-flash";
    const endpoint = base.includes(":generateContent")
      ? `${base}${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`
      : `${base}/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(key)}`;

    const promptText = [
      `CONSULTA DEL INVESTIGADOR:\n${userQuestion}`,
      "",
      `RECURSOS DE LA BIBLIOTECA LOCAL EN MINELLY (${contexts.length} fragmentos recuperados):`,
      buildContextBlock(contexts),
      "",
      "INSTRUCCIÓN: Responde en español con el rigor académico solicitado, citando los recursos con [V1], [C2], [D3], [L4] cuando corresponda.",
    ].join("\n");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: currentPersona.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: promptText }],
          },
        ],
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: 2800,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `Google Gemini API devolvió estado ${response.status}: ${errText.slice(0, 260) || response.statusText}`,
      );
    }

    const data = await response.json();
    const parts: Array<{ text?: string }> =
      data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((p) => p.text ?? "")
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("Google Gemini no devolvió texto en la respuesta.");
    }

    const promptTokens = Number(data?.usageMetadata?.promptTokenCount ?? 0);
    const completionTokens = Number(
      data?.usageMetadata?.candidatesTokenCount ?? 0,
    );
    const totalTokens =
      Number(data?.usageMetadata?.totalTokenCount ?? 0) ||
      promptTokens + completionTokens;

    return {
      answer: text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        provider: "Google Gemini LLM",
        model: modelName,
        timestamp: new Date().toLocaleTimeString(),
      },
    };
  }

  async function callOpenAiCompatibleOrDeepSeek(
    userQuestion: string,
    contexts: RagContext[],
  ): Promise<{
    answer: string;
    reasoning?: string;
    usage: TokenUsageRecord;
  }> {
    const key = activeApiKey.trim();
    if (!key && config.provider === "deepseek") {
      throw new Error(
        "Ingresa tu API Key de DeepSeek / DeepSeek Harness para realizar la petición externa, o selecciona «Cátedra Académica Local» si deseas usar el agente sin API.",
      );
    }

    let endpoint = activeBaseUrl.trim() || currentProvider.defaultBaseUrl;
    if (
      !endpoint.endsWith("/chat/completions") &&
      !endpoint.includes("/chat/completions?")
    ) {
      endpoint = `${endpoint.replace(/\/+$/, "")}/chat/completions`;
    }

    const modelName = activeModel.trim() || currentProvider.defaultModel;
    const userMessage = [
      `CONSULTA DEL INVESTIGADOR:\n${userQuestion}`,
      "",
      `FRAGMENTOS DE LA BIBLIOTECA LOCAL EN MINELLY (${contexts.length} recursos):`,
      buildContextBlock(contexts),
      "",
      "Responde en español con nivel de cátedra académica, explicaciones claras, resúmenes útiles y citas [V1], [C2], etc.",
    ].join("\n");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (key) {
      headers.Authorization = `Bearer ${key}`;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: currentPersona.systemPrompt },
            { role: "user", content: userMessage },
          ],
          temperature: config.temperature,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        throw new Error(
          `El proveedor (${endpoint}) devolvió HTTP ${response.status}: ${errBody.slice(0, 260) || response.statusText}`,
        );
      }

      const data = await response.json();
      const messageObj = data?.choices?.[0]?.message;
      const content = String(messageObj?.content ?? "").trim();
      const reasoning = messageObj?.reasoning_content
        ? String(messageObj.reasoning_content).trim()
        : undefined;

      if (!content) {
        throw new Error("El proveedor respondió sin contenido de mensaje.");
      }

      const promptTokens = Number(data?.usage?.prompt_tokens ?? 0);
      const completionTokens = Number(data?.usage?.completion_tokens ?? 0);
      const totalTokens =
        Number(data?.usage?.total_tokens ?? 0) ||
        promptTokens + completionTokens;

      return {
        answer: content,
        reasoning,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          provider: currentProvider.name,
          model: modelName,
          timestamp: new Date().toLocaleTimeString(),
        },
      };
    } catch (fetchErr) {
      // Si es DeepSeek estándar y hubiera restricción CORS en algún entorno, respaldamos con el comando nativo de Tauri
      if (
        config.provider === "deepseek" &&
        key &&
        endpoint.includes("api.deepseek.com")
      ) {
        const fallback = await invoke<RagAnswer>("ask_study_assistant", {
          query: `${currentPersona.title}: ${userQuestion}`,
          apiKey: key,
          model: modelName,
        });
        const estPrompt = Math.round((userMessage.length + currentPersona.systemPrompt.length) / 4);
        const estCompletion = Math.round(fallback.answer.length / 4);
        return {
          answer: fallback.answer,
          usage: {
            promptTokens: estPrompt,
            completionTokens: estCompletion,
            totalTokens: estPrompt + estCompletion,
            provider: "DeepSeek (vía Tauri Rust)",
            model: fallback.model,
            timestamp: new Date().toLocaleTimeString(),
          },
        };
      }
      throw fetchErr;
    }
  }

  async function ask(customQuery?: string, taskLabel = "Consulta académica") {
    const finalQuery = (customQuery ?? query).trim();
    if (!finalQuery) return;
    setBusy(true);
    setError("");

    try {
      const contexts = await gatherLibraryContexts(finalQuery);

      let answerText = "";
      let reasoningText: string | undefined;
      let usedRemote = false;
      let usageRecord: TokenUsageRecord = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        provider: "Agente Local Harvard",
        model: "harvard-seminar-local-v2",
        timestamp: new Date().toLocaleTimeString(),
      };

      if (config.provider === "harvard-local" || !activeApiKey.trim()) {
        answerText = buildHarvardLocalSynthesis(
          finalQuery,
          currentPersona,
          contexts,
        );
        usedRemote = false;
      } else if (config.provider === "gemini") {
        const geminiRes = await callGoogleGemini(finalQuery, contexts);
        answerText = geminiRes.answer;
        usageRecord = geminiRes.usage;
        usedRemote = true;
      } else {
        const oaRes = await callOpenAiCompatibleOrDeepSeek(
          finalQuery,
          contexts,
        );
        answerText = oaRes.answer;
        reasoningText = oaRes.reasoning;
        usageRecord = oaRes.usage;
        usedRemote = true;
      }

      if (usedRemote) {
        recordTokenUsage(usageRecord);
      }

      const newTurn: ConversationTurn = {
        id: `turn-${Date.now()}`,
        query: finalQuery,
        taskLabel,
        personaLabel: currentPersona.title,
        providerLabel: usedRemote
          ? currentProvider.name
          : "Cátedra Académica Local (Sin gasto de tokens)",
        model: usedRemote ? activeModel : "harvard-seminar-local-v2",
        answer: answerText,
        reasoning: reasoningText,
        usedRemoteModel: usedRemote,
        contexts,
        usage: usageRecord,
      };

      setTurns((prev) => [newTurn, ...prev]);
      setActiveTurnId(newTurn.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleQuickTask(prefix: string, label: string) {
    const baseTopic = query
      .replace(/^Realiza una exégesis académica completa y análisis filológico sobre:\s*/i, "")
      .replace(/^Elabora un resumen estructurado y explica los puntos centrales de:\s*/i, "")
      .replace(/^Compara y contrasta lo que enseñan las Biblias, comentarios y libros de mi biblioteca acerca de:\s*/i, "")
      .replace(/^Explícame como profesor guía paso a paso el significado, contexto e implicaciones de:\s*/i, "")
      .trim();
    const nextQ = `${prefix}${baseTopic || "Juan 3:1-16"}`;
    setQuery(nextQ);
    void ask(nextQ, label);
  }

  return (
    <section
      className="assistant-workspace"
      aria-label="Asistente de estudio e investigación académica"
      style={
        {
          "--assistant-scale": config.textScale,
        } as React.CSSProperties
      }
    >
      <header className="assistant-header">
        <div className="assistant-header-titles">
          <div className="eyebrow">
            CÁTEDRA ACADÉMICA HARVARD · MULTI-PROVEEDOR IA Y BIBLIOTECA LOCAL
          </div>
          <h1>Asistente de Estudio e Investigación Exegética</h1>
          <p>
            Conecta tu API de confianza (<strong>DeepSeek Harness</strong>,{" "}
            <strong>Google Gemini LLM</strong> u OpenAI/Local) o utiliza el{" "}
            <strong>Agente Académico Local</strong> para consultar tus Biblias,
            comentarios, diccionarios y libros importados.
          </p>
        </div>

        <div className="assistant-header-actions">
          <div className="assistant-scale-controls" title="Tamaño de letra del Asistente">
            <span>Texto</span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => adjustTextScale(-0.08)}
              title="Reducir letra del asistente"
            >
              A−
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => adjustTextScale(0.08)}
              title="Aumentar letra del asistente"
            >
              A+
            </button>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowConfigPanel((v) => !v)}
          >
            {showConfigPanel ? "Ocultar configuración IA" : "⚙ Configurar API / Proveedor"}
          </button>

          <PaperModePicker compact />

          {onOpenCustomization && (
            <button
              type="button"
              className="secondary-button"
              onClick={onOpenCustomization}
              title="Personalizar tamaño de menús, fuentes y colores del sistema"
            >
              Aa Personalizar
            </button>
          )}

          <button type="button" className="primary-button" onClick={onClose}>
            Volver al lector
          </button>
        </div>
      </header>

      {/* Barra de Contabilidad de Tokens y Estado del Proveedor */}
      <div className="assistant-token-bar">
        <div className="assistant-token-status">
          <span className={`assistant-provider-pill ${config.provider}`}>
            {currentProvider.name}
          </span>
          <span className="assistant-persona-pill">
            🎓 {currentPersona.title}
          </span>
          <span className="assistant-model-pill">
            Modelo: <strong>{activeModel}</strong>
          </span>
        </div>

        <div className="assistant-token-metrics">
          {activeTurn && (
            <span className="token-metric-chip last">
              Última consulta:{" "}
              <strong>{activeTurn.usage.totalTokens.toLocaleString()} tokens</strong>{" "}
              <small>
                ({activeTurn.usage.promptTokens} prompt +{" "}
                {activeTurn.usage.completionTokens} respuesta)
              </small>
            </span>
          )}
          <span className="token-metric-chip cumulative">
            Consumo acumulado:{" "}
            <strong>{tokenStats.totalTokens.toLocaleString()} tokens</strong>{" "}
            <small>({tokenStats.requestsCount} consultas con API)</small>
          </span>
          {tokenStats.totalTokens > 0 && (
            <button
              type="button"
              className="token-reset-btn"
              onClick={() => setTokenStats(INITIAL_TOKEN_STATS)}
              title="Reiniciar contador acumulado de tokens"
            >
              Reiniciar contador
            </button>
          )}
        </div>
      </div>

      <div className="assistant-layout">
        <div className="assistant-main">
          {showConfigPanel && (
            <section className="assistant-config-card">
              <div className="assistant-config-section">
                <span className="assistant-section-label">
                  1. Elige tu Proveedor de IA o Agente Local
                </span>
                <div className="assistant-provider-grid">
                  {PROVIDER_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`assistant-provider-card ${
                        config.provider === preset.id ? "active" : ""
                      }`}
                      onClick={() => updateProvider(preset.id)}
                    >
                      <strong>{preset.name}</strong>
                      <span>{preset.badge}</span>
                    </button>
                  ))}
                </div>
                <p className="assistant-provider-help">{currentProvider.helpText}</p>
              </div>

              <div className="assistant-config-section">
                <span className="assistant-section-label">
                  2. Nivel y Especialidad del Profesor Académico (Estándar Harvard)
                </span>
                <div className="assistant-persona-grid">
                  {ACADEMIC_PERSONAS.map((persona) => (
                    <button
                      key={persona.id}
                      type="button"
                      className={`assistant-persona-card ${
                        config.persona === persona.id ? "active" : ""
                      }`}
                      onClick={() => updatePersona(persona.id)}
                    >
                      <strong>🎓 {persona.title}</strong>
                      <span>{persona.subtitle}</span>
                    </button>
                  ))}
                </div>
              </div>

              {config.provider !== "harvard-local" && (
                <div className="assistant-credentials-grid">
                  <label className="assistant-field">
                    <span>
                      API Key ({currentProvider.name})
                      <button
                        type="button"
                        className="assistant-inline-link"
                        onClick={() => setShowKeyPlain((v) => !v)}
                      >
                        {showKeyPlain ? "Ocultar" : "Mostrar"}
                      </button>
                    </span>
                    <input
                      type={showKeyPlain ? "text" : "password"}
                      value={activeApiKey}
                      onChange={(e) => updateApiKey(e.target.value)}
                      placeholder={currentProvider.keyPlaceholder}
                    />
                  </label>

                  <label className="assistant-field">
                    <span>Modelo del proveedor</span>
                    <div className="assistant-model-input-row">
                      <select
                        value={
                          currentProvider.models.some((m) => m.value === activeModel)
                            ? activeModel
                            : "__custom__"
                        }
                        onChange={(e) => {
                          if (e.target.value !== "__custom__") {
                            updateModel(e.target.value);
                          }
                        }}
                      >
                        {currentProvider.models.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                        <option value="__custom__">Otro modelo personalizado…</option>
                      </select>
                      <input
                        type="text"
                        value={activeModel}
                        onChange={(e) => updateModel(e.target.value)}
                        placeholder="ID del modelo (ej. deepseek-chat, gemini-2.5-flash)"
                      />
                    </div>
                  </label>

                  <label className="assistant-field">
                    <span>Endpoint / URL de conexión (Editable para Harness o Proxy)</span>
                    <input
                      type="text"
                      value={activeBaseUrl}
                      onChange={(e) => updateBaseUrl(e.target.value)}
                      placeholder={currentProvider.defaultBaseUrl}
                    />
                  </label>

                  <div className="assistant-field assistant-checkbox-row">
                    <label className="assistant-checkbox-label">
                      <input
                        type="checkbox"
                        checked={config.rememberKeys}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            rememberKeys: e.target.checked,
                          }))
                        }
                      />
                      <span>
                        Guardar mi API Key y proveedor en este equipo para futuras sesiones
                      </span>
                    </label>

                    <label className="assistant-context-count">
                      <span>Fuentes de biblioteca por consulta:</span>
                      <select
                        value={config.maxContextItems}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            maxContextItems: Number(e.target.value),
                          }))
                        }
                      >
                        <option value={6}>6 fuentes (Ahorro de tokens)</option>
                        <option value={10}>10 fuentes (Equilibrado)</option>
                        <option value={15}>15 fuentes (Investigación exhaustiva)</option>
                      </select>
                    </label>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Panel de Consulta e Instrucciones Rápidas */}
          <div className="assistant-prompt-card">
            <div className="assistant-quick-tasks">
              <span>Acciones académicas rápidas:</span>
              {QUICK_TASKS.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="assistant-task-chip"
                  onClick={() => handleQuickTask(task.prefix, task.label)}
                  disabled={busy}
                >
                  ✦ {task.label}
                </button>
              ))}
            </div>

            <textarea
              className="assistant-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Escribe tu pregunta, pasaje bíblico o tema para que el Profesor analice tus Biblias, Comentarios, Diccionarios y Libros…"
              rows={3}
            />

            <div className="assistant-examples">
              <span>Ejemplos sugeridos:</span>
              {SAMPLE_QUERIES.map((sample) => (
                <button
                  type="button"
                  key={sample}
                  onClick={() => {
                    setQuery(sample);
                    void ask(sample);
                  }}
                  disabled={busy}
                >
                  {sample}
                </button>
              ))}
            </div>

            <div className="assistant-submit-row">
              <div className="assistant-submit-hint">
                {config.provider === "harvard-local" || !activeApiKey.trim() ? (
                  <span>
                    🟢 Modo activo: <strong>Síntesis Académica Local Harvard</strong> (0 tokens).
                    {config.provider !== "harvard-local" &&
                      " Si ingresas tu API Key arriba, se conectará automáticamente a tu proveedor externo."}
                  </span>
                ) : (
                  <span>
                    🔵 Conectado a <strong>{currentProvider.name}</strong> ({activeModel}). Se enviarán hasta{" "}
                    {config.maxContextItems} fragmentos relevantes de tu biblioteca local.
                  </span>
                )}
              </div>

              <button
                type="button"
                className="primary-button assistant-ask-btn"
                onClick={() => void ask()}
                disabled={busy || !query.trim()}
              >
                {busy
                  ? "Analizando biblioteca y redactando cátedra…"
                  : "Consultar al Profesor de Estudio"}
              </button>
            </div>
          </div>

          {error && <div className="import-error">{error}</div>}

          {activeTurn ? (
            <article className="assistant-answer-card">
              <div className="assistant-answer-meta">
                <div className="assistant-answer-badges">
                  <span
                    className={`assistant-mode ${
                      activeTurn.usedRemoteModel ? "remote" : "local"
                    }`}
                  >
                    {activeTurn.providerLabel}
                  </span>
                  <span className="assistant-model">{activeTurn.personaLabel}</span>
                  <span className="assistant-model">{activeTurn.model}</span>
                  {activeTurn.usage.totalTokens > 0 && (
                    <span className="assistant-token-badge">
                      ⚡ {activeTurn.usage.totalTokens.toLocaleString()} tokens
                    </span>
                  )}
                </div>

                <div className="assistant-answer-tools">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      void navigator.clipboard.writeText(activeTurn.answer);
                      setCopiedId(activeTurn.id);
                      setTimeout(() => setCopiedId(null), 2000);
                    }}
                  >
                    {copiedId === activeTurn.id ? "✓ Copiado" : "Copiar cátedra"}
                  </button>
                </div>
              </div>

              {activeTurn.reasoning && (
                <details className="assistant-reasoning-box">
                  <summary>
                    Ver cadena de razonamiento interno ({activeTurn.model})
                  </summary>
                  <pre>{activeTurn.reasoning}</pre>
                </details>
              )}

              <div className="assistant-answer-body">
                {activeTurn.answer.split(/\n{2,}/).map((block, index) => {
                  const trimmed = block.trim();
                  if (trimmed.startsWith("# ")) {
                    return <h2 key={index}>{trimmed.replace(/^#\s+/, "")}</h2>;
                  }
                  if (trimmed.startsWith("## ")) {
                    return <h3 key={index}>{trimmed.replace(/^##\s+/, "")}</h3>;
                  }
                  if (trimmed.startsWith("### ")) {
                    return <h4 key={index}>{trimmed.replace(/^###\s+/, "")}</h4>;
                  }
                  if (trimmed === "---") {
                    return <hr key={index} />;
                  }
                  return <p key={index}>{block}</p>;
                })}
              </div>

              {turns.length > 1 && (
                <div className="assistant-history-bar">
                  <span>Consultas de esta sesión ({turns.length}):</span>
                  <div className="assistant-history-chips">
                    {turns.map((turn, idx) => (
                      <button
                        key={turn.id}
                        type="button"
                        className={`assistant-history-chip ${
                          turn.id === activeTurn.id ? "active" : ""
                        }`}
                        onClick={() => setActiveTurnId(turn.id)}
                      >
                        #{turns.length - idx}: {turn.query.slice(0, 38)}…
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ) : (
            <div className="assistant-empty">
              <h2>Tu Seminario Académico Personal en Minelly</h2>
              <p>
                Formula cualquier pregunta bíblica, teológica, histórica o sobre tus
                libros importados. El asistente localizará primero la evidencia en tu
                catálogo local y te responderá como un profesor universitario de
                Harvard, ya sea mediante tu API de <strong>DeepSeek Harness</strong>,{" "}
                <strong>Google Gemini LLM</strong> o con el{" "}
                <strong>Motor Académico Local</strong>.
              </p>
            </div>
          )}
        </div>

        <aside className="assistant-side">
          <div className="assistant-side-heading">
            <div className="eyebrow">EVIDENCIA DOCUMENTAL DE TU BIBLIOTECA</div>
            <h2>
              Fuentes Citadas ({activeTurn?.contexts.length ?? 0})
            </h2>
            <p className="assistant-side-subtitle">
              Haz clic en cualquier fuente para abrirla inmediatamente en el lector principal.
            </p>
          </div>

          <div className="assistant-contexts">
            {(activeTurn?.contexts ?? []).map((context) => (
              <div className="rag-context" key={context.id}>
                <div className="rag-context-heading">
                  <span className="rag-citation">[{context.id}]</span>
                  <span className={`rag-kind-badge ${context.kind}`}>
                    {kindLabel(context.kind)}
                  </span>
                  <strong>{context.label}</strong>
                </div>
                <div className="rag-resource-title">{context.resourceTitle}</div>
                <p>{context.text}</p>
                <div className="rag-context-footer">
                  <code>{context.resourceId}</code>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onOpenContext(context)}
                  >
                    Abrir en el lector →
                  </button>
                </div>
              </div>
            ))}

            {(!activeTurn || activeTurn.contexts.length === 0) && (
              <div className="assistant-side-card">
                <strong>¿Cómo funciona la conexión con tu biblioteca?</strong>
                <ul>
                  <li>
                    <strong>1. Búsqueda Multi-Índice:</strong> El asistente rastrea en
                    tiempo real tus Biblias, Comentarios, Diccionarios y Libros PBB/EPUB.
                  </li>
                  <li>
                    <strong>2. Inyección Documental (RAG):</strong> Los fragmentos exactos
                    se entregan al modelo con códigos <code>[V1]</code>, <code>[C2]</code>,{" "}
                    <code>[D3]</code>, <code>[L4]</code>.
                  </li>
                  <li>
                    <strong>3. Transparencia de Tokens:</strong> Cuando usas{" "}
                    <strong>DeepSeek Harness</strong> o <strong>Google Gemini</strong>, la
                    barra superior te muestra los tokens reales de entrada y salida.
                  </li>
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

export default StudyAssistant;
