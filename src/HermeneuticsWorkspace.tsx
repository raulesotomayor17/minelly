import { useEffect, useMemo, useState } from "react";

interface HermeneuticsWorkspaceProps {
  initialBook: number;
  initialChapter: number;
  initialVerse: number;
  initialBookName: string;
  onOpenBible: (book: number, chapter: number, verse: number) => void;
  onClose: () => void;
}

type GenreId =
  | "epistola"
  | "narrativa"
  | "hechos"
  | "evangelio"
  | "parabola"
  | "ley"
  | "profecia"
  | "salmo"
  | "sabiduria"
  | "apocalipsis";

interface Stage {
  id: string;
  title: string;
  subtitle: string;
  questions: string[];
  traps: string[];
}

interface GenreTrack {
  id: GenreId;
  label: string;
  short: string;
  focus: string;
  stages: Stage[];
}

interface SavedSession {
  book: number;
  chapter: number;
  verse: number;
  genre: GenreId;
  stage: number;
  answers: Record<string, string>;
  updatedAt: number;
}

const STORAGE_KEY = "teoamoxtli.hermeneutics.v1";

const GENRES: GenreTrack[] = [
  {
    id: "epistola",
    label: "Epístola",
    short: "Argumentos y situaciones de iglesias locales",
    focus: "Sigue el hilo del argumento y reconstruye la situación de los destinatarios.",
    stages: [
      {
        id: "e1", title: "Situación", subtitle: "La ocasión de la carta",
        questions: [
          "¿Quién escribe, a quién y por qué?",
          "¿Qué problema o pregunta de la iglesia provocó esta sección?",
          "¿Qué sabemos del lugar, la época y las personas mencionadas?",
        ],
        traps: ["Leer la carta como un libro de frases sueltas.", "Ignorar que fue escrita a una iglesia concreta."],
      },
      {
        id: "e2", title: "Argumento", subtitle: "Cómo avanza el pensamiento",
        questions: [
          "¿Cuál es la afirmación principal de la unidad?",
          "¿Qué conectores (porque, por tanto, pero, para que) unen las ideas?",
          "¿Qué preguntas retóricas o contrastes usa el autor?",
        ],
        traps: ["Tomar una cláusula secundaria como idea central.", "Ignorar la lógica del párrafo."],
      },
      {
        id: "e3", title: "Contexto", subtitle: "Palabras en su mundo",
        questions: [
          "¿Qué palabras clave cambian de significado según el contexto?",
          "¿Cómo ilumina el Antiguo Testamento este argumento?",
          "¿Qué prácticas culturales son esenciales para entender el pasaje?",
        ],
        traps: ["Definir una palabra por su etimología sin mirar el uso.", "Importar un significado de otro autor o época."],
      },
      {
        id: "e4", title: "Teología", subtitle: "El evangelio en la carta",
        questions: [
          "¿Qué dice este pasaje sobre Dios y sobre Cristo?",
          "¿Cómo se relaciona con la justificación, la santidad o la iglesia?",
          "¿Qué error doctrinal o práctico corrige?",
        ],
        traps: ["Aislar la teología del argumento pastoral.", "Convertir una aplicación local en doctrina universal."],
      },
      {
        id: "e5", title: "Hermenéutica", subtitle: "Lo normativo y lo cultural",
        questions: [
          "¿Qué principio permanente enseña el pasaje?",
          "¿Qué circunstancia era propia del siglo primero?",
          "¿Existe una situación realmente comparable hoy?",
          "¿La aplicación se extiende más allá de lo que el texto autoriza?",
        ],
        traps: ["Obedecer la forma cultural y olvidar el principio.", "Descartar el texto por considerarlo 'anticuado'."],
      },
      {
        id: "e6", title: "Aplicación", subtitle: "La iglesia hoy",
        questions: [
          "¿Qué creencia debe corregirse?",
          "¿Qué práctica debe adoptarse en tu iglesia?",
          "¿Qué acción personal y concreta se deriva del texto?",
        ],
        traps: ["Aplicar sin pasar por el evangelio.", "Usar la libertad para justificar una conducta que el texto corrige."],
      },
    ],
  },
  {
    id: "narrativa",
    label: "Narrativa del AT",
    short: "Relatos, personajes y trama",
    focus: "Deja que la historia hable como historia; no la conviertas en una fábula moral.",
    stages: [
      {
        id: "n1", title: "Historia", subtitle: "Qué se narra",
        questions: ["¿Quiénes son los personajes principales?", "¿Cuál es el conflicto y cómo se resuelve?", "¿Qué cambia entre el inicio y el final?"],
        traps: ["Tratar a cada personaje como ejemplo moral.", "Alegorizar objetos o detalles."],
      },
      {
        id: "n2", title: "Escena", subtitle: "Dónde y cómo",
        questions: ["¿Qué escena se describe y qué detalles son significativos?", "¿Qué diálogo revela el carácter o la intención?", "¿Cómo usa el narrador el tiempo y el espacio?"],
        traps: ["Ignorar el papel del narrador.", "Confundir un detalle descriptivo con una enseñanza."],
      },
      {
        id: "n3", title: "Trama", subtitle: "El movimiento de la historia",
        questions: ["¿Cuál es la tensión central?", "¿Qué giros o repeticiones estructuran el relato?", "¿Qué evaluación hace el narrador de los hechos?"],
        traps: ["Leer un episodio sin la unidad mayor.", "Convertir la trama en una regla abstracta."],
      },
      {
        id: "n4", title: "Teología", subtitle: "Dios en la historia",
        questions: ["¿Qué hace Dios en esta narrativa?", "¿Qué revela sobre su carácter, pacto o juicio?", "¿Cómo apunta a la historia de la redención?"],
        traps: ["Reducir a Dios a un ejemplo de moral.", "Ignorar el pacto y el contexto de Israel."],
      },
      {
        id: "n5", title: "Niveles", subtitle: "Universal, Israel, individuo",
        questions: ["¿Qué verdad universal muestra la historia?", "¿Qué significa dentro de la historia de Israel?", "¿Qué enseña sobre la vida del individuo sin convertirlo en ley?"],
        traps: ["Aplicar el nivel individual como norma universal.", "Saltar directamente a una lección moral."],
      },
      {
        id: "n6", title: "Aplicación", subtitle: "Desde la historia completa",
        questions: ["¿Qué aprende la comunidad de fe sobre Dios?", "¿Qué actitud o acción concreta surge del relato?", "¿Cómo se conecta con Cristo sin forzar el texto?"],
        traps: ["Moralizar sin gracia.", "Usar el éxito de un personaje como promesa para hoy."],
      },
    ],
  },
  {
    id: "hechos",
    label: "Hechos",
    short: "Historia, misión y precedentes",
    focus: "Distingue lo que Dios hizo una vez de lo que ordena repetir siempre.",
    stages: [
      { id: "h1", title: "Historia", subtitle: "El relato de la misión", questions: ["¿Qué acontece y quiénes participan?", "¿Cómo guía el Espíritu la misión?", "¿Qué conflicto se resuelve?"], traps: ["Convertir cada evento en norma.", "Ignorar el propósito narrativo de Lucas."] },
      { id: "h2", title: "Contexto", subtitle: "El mundo del primer siglo", questions: ["¿Qué sabemos de la ciudad, la sinagoga o la cultura?", "¿Qué tensiones políticas o religiosas aparecen?", "¿Cómo se relaciona con el judaísmo y el Imperio?"], traps: ["Leer Hechos sin el Antiguo Testamento.", "Suponer que toda costumbre se repite."] },
      { id: "h3", title: "Precedente", subtitle: "Descriptivo y normativo", questions: ["¿El texto describe o prescribe?", "¿Qué principio permanente se puede extraer?", "¿Qué circunstancia era única?"], traps: ["Imitar un método sin su principio.", "Hacer obligatorio un hecho histórico."] },
      { id: "h4", title: "Teología", subtitle: "Reino y Espíritu", questions: ["¿Qué revela sobre el reino de Dios?", "¿Cómo actúa el Espíritu?", "¿Qué lugar ocupa la resurrección?"], traps: ["Separar la misión del evangelio.", "Reducir Hechos a modelos de liderazgo."] },
      { id: "h5", title: "Hermenéutica", subtitle: "Lo repetible", questions: ["¿Qué es esencial a la misión de la iglesia?", "¿Qué es cultural o circunstancial?", "¿Qué aplicación es fiel al conjunto?"], traps: ["Universalizar una experiencia personal.", "Descartar todo precedente."] },
      { id: "h6", title: "Aplicación", subtitle: "Misión hoy", questions: ["¿Cómo participas en la misión?", "¿Qué acción requiere tu iglesia?", "¿Qué dependencia del Espíritu debes recuperar?"], traps: ["Activismo sin oración.", "Imitación sin contexto."] },
    ],
  },
  {
    id: "evangelio",
    label: "Evangelio",
    short: "Una historia, cuatro testigos",
    focus: "Lee cada Evangelio como una obra completa y compara horizontal y verticalmente.",
    stages: [
      { id: "g1", title: "Historia", subtitle: "Jesús en su contexto", questions: ["¿Qué episodio se narra?", "¿Qué muestra sobre Jesús?", "¿Qué espera el evangelista del lector?"], traps: ["Armonizar antes de entender cada relato.", "Ignorar el propósito del evangelista."] },
      { id: "g2", title: "Horizontal", subtitle: "Comparar evangelios", questions: ["¿Cómo narra el mismo episodio otro evangelio?", "¿Qué cambia y por qué?", "¿Qué énfasis es propio de cada autor?"], traps: ["Explicar diferencias como errores.", "Forzar una armonía plana."] },
      { id: "g3", title: "Vertical", subtitle: "El lugar en el libro", questions: ["¿Dónde está el episodio en la estructura del Evangelio?", "¿Qué viene antes y después?", "¿Cómo contribuye al retrato de Jesús?"], traps: ["Leer un milagro aislado.", "Ignorar la progresión narrativa."] },
      { id: "g4", title: "Teología", subtitle: "El Mesías", questions: ["¿Qué revela sobre la identidad y misión de Jesús?", "¿Cómo cumple o reinterpreta el Antiguo Testamento?", "¿Qué responde a la situación de la comunidad?"], traps: ["Separar enseñanza y persona.", "Convertir una aplicación histórica en ley."] },
      { id: "g5", title: "Enseñanza", subtitle: "Mandatos y relatos", questions: ["¿A quién se dirige la enseñanza?", "¿Es un principio o una instrucción situacional?", "¿Cómo se aplica a la iglesia?"], traps: ["Aplicar una instrucción sin contexto.", "Ignorar la diferencia entre relato y mandato."] },
      { id: "g6", title: "Aplicación", subtitle: "Seguir a Jesús", questions: ["¿Qué revela esto sobre el discipulado?", "¿Qué acción concreta exige?", "¿Cómo lo proclamarías hoy?"], traps: ["Imitar solo el ejemplo externo.", "Olvidar la cruz y la resurrección."] },
    ],
  },
  {
    id: "parabola",
    label: "Parábola",
    short: "Una comparación con un punto central",
    focus: "Busca la audiencia, la ocasión y el giro principal; no alegorices cada detalle.",
    stages: [
      { id: "p1", title: "Ocasión", subtitle: "Por qué se cuenta", questions: ["¿A quién se dirige la parábola?", "¿Qué pregunta o conflicto la provoca?", "¿Qué reacción busca?"], traps: ["Interpretarla sin su contexto.", "Convertirla en alegoría."] },
      { id: "p2", title: "Historia", subtitle: "El mundo de la parábola", questions: ["¿Qué situaciones y personajes resultan sorprendentes?", "¿Qué expectativas rompe la historia?", "¿Cuál es el punto de comparación?"], traps: ["Dar significado a cada detalle.", "Ignorar el impacto original."] },
      { id: "p3", title: "Reino", subtitle: "El mensaje central", questions: ["¿Qué enseña sobre el reino de Dios?", "¿Qué revela sobre Dios, el hombre o el juicio?", "¿Qué crisis produce?"], traps: ["Reducirla a una moraleja genérica.", "Separarla del mensaje de Jesús."] },
      { id: "p4", title: "Teología", subtitle: "La sorpresa del evangelio", questions: ["¿Qué imagen de Dios presenta?", "¿Qué conversión exige?", "¿Cómo apunta a la gracia?"], traps: ["Convertirla en una regla moral sin gracia.", "Alegorizar a los personajes."] },
      { id: "p5", title: "Hermenéutica", subtitle: "El punto principal", questions: ["¿Cuál es la idea que no puede perderse?", "¿Qué detalles son solo ambientación?", "¿Qué aplicación autoriza?"], traps: ["Multiplicar lecciones.", "Ignorar el giro final."] },
      { id: "p6", title: "Aplicación", subtitle: "La respuesta", questions: ["¿Qué debes creer o hacer?", "¿Qué resistencia interna debes vencer?", "¿Cómo orarás?"], traps: ["Quedarse en admiración estética.", "Aplicar sin arrepentimiento."] },
    ],
  },
  {
    id: "ley",
    label: "Ley",
    short: "El pacto y sus estipulaciones",
    focus: "Entiende la ley dentro del pacto de Israel y su cumplimiento en Cristo.",
    stages: [
      { id: "l1", title: "Pacto", subtitle: "El marco", questions: ["¿Qué pacto y qué situación?", "¿Quién es el pueblo y quién es Dios?", "¿Qué propósito tiene la ley?"], traps: ["Leer la ley como código moderno.", "Separarla de la gracia del éxodo."] },
      { id: "l2", title: "Tipo", subtitle: "Forma y función", questions: ["¿Es ley apodíctica o casuística?", "¿Qué valores protege?", "¿A quién obliga y en qué circunstancia?"], traps: ["Confundir principio y aplicación concreta.", "Ignorar la diferencia entre leyes."] },
      { id: "l3", title: "Teología", subtitle: "Santidad y pecado", questions: ["¿Qué revela sobre la santidad de Dios?", "¿Cómo muestra el problema del pecado?", "¿Por qué se necesita un mediador?"], traps: ["Usar la ley sin evangelio.", "Reducirla a moral personal."] },
      { id: "l4", title: "Cristo", subtitle: "Cumplimiento", questions: ["¿Cómo cumple Cristo esta ley?", "¿Qué queda superado y qué continúa?", "¿Qué cambia para la iglesia?"], traps: ["Abolir todo sin discernir.", "Imponer toda la ley al creyente."] },
      { id: "l5", title: "Hermenéutica", subtitle: "Principio y forma", questions: ["¿Cuál es el principio permanente?", "¿Qué elementos eran ceremoniales o civiles?", "¿Cómo se aplica sin legalismo?"], traps: ["Extrapolar una sanción civil.", "Ignorar la cultura del pacto."] },
      { id: "l6", title: "Aplicación", subtitle: "Obediencia y gracia", questions: ["¿Qué virtud exige?", "¿Qué ídolo confronta?", "¿Cómo responderás con gratitud?"], traps: ["Obedecer para ganar aceptación.", "Despreciar la ley."] },
    ],
  },
  {
    id: "profecia",
    label: "Profecía",
    short: "Voceros del pacto y esperanza",
    focus: "Escucha al profeta en su crisis histórica; la predicción no es el centro.",
    stages: [
      { id: "pr1", title: "Crisis", subtitle: "La situación del profeta", questions: ["¿En qué reinado y crisis habla?", "¿A quién se dirige?", "¿Qué acusación del pacto presenta?"], traps: ["Aislar un oráculo.", "Leerlo solo como predicción del futuro."] },
      { id: "pr2", title: "Poesía", subtitle: "Imágenes y forma", questions: ["¿Qué imágenes y paralelismos usa?", "¿Qué emociones expresa?", "¿Qué estructura tiene el oráculo?"], traps: ["Literalizar una metáfora.", "Ignorar la poesía hebrea."] },
      { id: "pr3", title: "Covenant", subtitle: "Juicio y esperanza", questions: ["¿Qué violación del pacto denuncia?", "¿Qué juicio anuncia?", "¿Qué esperanza promete?"], traps: ["Separar juicio y gracia.", "Convertir la denuncia en política partidista."] },
      { id: "pr4", title: "Teología", subtitle: "Dios y su pueblo", questions: ["¿Qué revela sobre Dios?", "¿Cómo llama al arrepentimiento?", "¿Cómo apunta a Cristo?"], traps: ["Usar el texto para condenar a otros sin examinarse.", "Ignorar la esperanza."] },
      { id: "pr5", title: "Hermenéutica", subtitle: "Cumplimiento", questions: ["¿Qué se cumplió en la historia?", "¿Qué espera el Nuevo Testamento?", "¿Qué no autoriza a calcular fechas?"], traps: ["Leer profecía como noticias actuales.", "Multiplicar cumplimientos arbitrarios."] },
      { id: "pr6", title: "Aplicación", subtitle: "Voz profética hoy", questions: ["¿Qué denuncia profética debe escuchar tu iglesia?", "¿Qué esperanza debes proclamar?", "¿Qué acción de justicia y misericordia?"], traps: ["Protestar sin amor.", "Esperanza sin arrepentimiento."] },
    ],
  },
  {
    id: "salmo",
    label: "Salmo",
    short: "Oraciones y poesía de Israel",
    focus: "Ora con el salmo en su género y en su emoción, sin literalizar toda imagen.",
    stages: [
      { id: "s1", title: "Tipo", subtitle: "Qué clase de oración", questions: ["¿Es lamento, alabanza, gratitud, confianza o historia?", "¿Quién habla y en qué situación?", "¿Cuál es el movimiento del salmo?"], traps: ["Leer todo salmo como promesa personal.", "Ignorar el tipo de salmo."] },
      { id: "s2", title: "Poesía", subtitle: "Cómo habla", questions: ["¿Qué paralelismos, repeticiones e imágenes aparecen?", "¿Qué exageraciones poéticas hay?", "¿Qué emociones se expresan?"], traps: ["Literalizar toda metáfora.", "Ignorar la estructura poética."] },
      { id: "s3", title: "Teología", subtitle: "Dios en la oración", questions: ["¿Qué atributos de Dios celebra o cuestiona?", "¿Cómo expresa confianza o queja?", "¿Cómo apunta a Cristo?"], traps: ["Convertir la queja en rebeldía.", "Ignorar la comunidad."] },
      { id: "s4", title: "Hermenéutica", subtitle: "Orar con el salmo", questions: ["¿Qué parte te cuesta orar y por qué?", "¿Qué imagen de Dios corrige?", "¿Qué salmo o pasaje complementa?"], traps: ["Usar solo salmos cómodos.", "Prometer resultados automáticos."] },
      { id: "s5", title: "Cristo", subtitle: "El salmo y Jesús", questions: ["¿Cómo resuena este salmo en Jesús?", "¿Qué cumple o transforma?", "¿Qué esperanza abre?"], traps: ["Forzar cada detalle a Cristo.", "Ignorar el sentido original."] },
      { id: "s6", title: "Aplicación", subtitle: "Tu oración", questions: ["¿Qué palabra llevarás a tu oración?", "¿Qué emoción ofrecerás a Dios?", "¿Cómo orarás por tu comunidad?"], traps: ["Orar sin honestidad.", "Quedarse en emoción sin acción."] },
    ],
  },
  {
    id: "sabiduria",
    label: "Sabiduría",
    short: "Proverbios, Job y Eclesiastés",
    focus: "Un proverbio no es una garantía; es una observación memorable dentro de una colección.",
    stages: [
      { id: "w1", title: "Género", subtitle: "Qué es un proverbio", questions: ["¿Es proverbio, poema, discurso o reflexión?", "¿Qué pretende enseñar?", "¿Qué límites tiene la forma?"], traps: ["Convertir un proverbio en promesa absoluta.", "Aislarlo de la colección."] },
      { id: "w2", title: "Observación", subtitle: "La afirmación", questions: ["¿Qué contraste o comparación presenta?", "¿Qué palabras clave se repiten?", "¿Qué situación de la vida describe?"], traps: ["Generalizar sin matices.", "Ignorar la ironía."] },
      { id: "w3", title: "Teología", subtitle: "El temor del Señor", questions: ["¿Qué revela sobre la sabiduría de Dios?", "¿Cómo se relaciona con la creación?", "¿Qué límite humano muestra?"], traps: ["Reducir la sabiduría a éxito material.", "Ignorar el sufrimiento."] },
      { id: "w4", title: "Tensión", subtitle: "Job y Eclesiastés", questions: ["¿Qué excepción o tensión aparece?", "¿Qué no puede resolver la sabiduría humana?", "¿Dónde está la esperanza?"], traps: ["Usar Proverbios para juzgar al que sufre.", "Resolver demasiado rápido el misterio."] },
      { id: "w5", title: "Hermenéutica", subtitle: "Aplicar con humildad", questions: ["¿Qué principio general enseña?", "¿En qué circunstancias no se cumple literalmente?", "¿Cómo se aplica con temor de Dios?"], traps: ["Prometer prosperidad.", "Culpar a la víctima."] },
      { id: "w6", title: "Aplicación", subtitle: "Sabiduría práctica", questions: ["¿Qué decisión necesitas revisar?", "¿Qué relación requiere sabiduría?", "¿Cómo cultivarás el temor del Señor?"], traps: ["Aplicar sin oración.", "Confundir prudencia con cobardía."] },
    ],
  },
  {
    id: "apocalipsis",
    label: "Apocalipsis",
    short: "Imágenes de juicio y esperanza",
    focus: "Lee el simbolismo desde el Antiguo Testamento y el mensaje a las iglesias; no como noticiero.",
    stages: [
      { id: "a1", title: "Género", subtitle: "Apocalíptica y carta", questions: ["¿Qué simbolismo y visiones aparecen?", "¿A qué iglesias se escribe?", "¿Qué crisis enfrentan?"], traps: ["Leer cada imagen como evento actual.", "Ignorar el género apocalíptico."] },
      { id: "a2", title: "Símbolos", subtitle: "El lenguaje de las imágenes", questions: ["¿Qué imágenes vienen del Antiguo Testamento?", "¿Qué contraste expresan?", "¿Qué emociones buscan?"], traps: ["Asignar un significado único a cada símbolo.", "Ignorar el contexto literario."] },
      { id: "a3", title: "Teología", subtitle: "El Cordero y el trono", questions: ["¿Qué revela sobre el poder de Dios?", "¿Cómo vence el Cordero?", "¿Qué esperanza para los mártires?"], traps: ["Convertir a Dios en vengador sin amor.", "Separar juicio y esperanza."] },
      { id: "a4", title: "Historia", subtitle: "Contexto y cumplimiento", questions: ["¿Qué situaciones históricas iluminan el texto?", "¿Qué principios permanecen?", "¿Qué no podemos fechar?"], traps: ["Calcular fechas o nombres.", "Negar toda referencia histórica."] },
      { id: "a5", title: "Hermenéutica", subtitle: "El mensaje central", questions: ["¿Qué verdad sostiene a la iglesia perseguida?", "¿Qué advertencia y consuelo da?", "¿Qué aplicación autoriza?"], traps: ["Sensacionalismo.", "Alegoría sin control bíblico."] },
      { id: "a6", title: "Aplicación", subtitle: "Fidelidad y esperanza", questions: ["¿Cómo perseverar en prueba?", "¿Qué ídolo debes resistir?", "¿Qué esperanza proclamarás?"], traps: ["Miedo sin esperanza.", "Esperanza sin santidad."] },
    ],
  },
];

function loadSession(): SavedSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedSession;
  } catch {
    // sesión nueva
  }
  return {
    book: 43, chapter: 3, verse: 16,
    genre: "evangelio", stage: 0, answers: {}, updatedAt: Date.now(),
  };
}

function passageLabel(chapter: number, verse: number, bookName: string) {
  return `${bookName} ${chapter}:${verse}`;
}

export default function HermeneuticsWorkspace({
  initialBook,
  initialChapter,
  initialVerse,
  initialBookName,
  onOpenBible,
  onClose,
}: HermeneuticsWorkspaceProps) {
  const [session, setSession] = useState<SavedSession>(() => {
    const saved = loadSession();
    return {
      ...saved,
      book: initialBook || saved.book,
      chapter: initialChapter || saved.chapter,
      verse: initialVerse || saved.verse,
    };
  });
  const [book, setBook] = useState(session.book);
  const [chapter, setChapter] = useState(session.chapter);
  const [verse, setVerse] = useState(session.verse);
  const [savedLabel, setSavedLabel] = useState("Guardado local");

  const track = GENRES.find((item) => item.id === session.genre) ?? GENRES[0];
  const stages = track.stages;
  const stage = stages[Math.min(session.stage, stages.length - 1)];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = {
        ...session,
        book,
        chapter,
        verse,
        updatedAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSavedLabel("Guardado local");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [session, book, chapter, verse]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const answered = Object.values(session.answers).filter((answer) => answer.trim()).length;
  const totalQuestions = stages.reduce((sum, item) => sum + item.questions.length, 0);
  const progress = Math.round((answered / Math.max(1, totalQuestions)) * 100);
  const stageDone = (item: Stage) =>
    item.questions.every((question) => Boolean(session.answers[question]?.trim()));

  function selectGenre(genre: GenreId) {
    setSession((current) => ({
      ...current,
      genre,
      stage: 0,
      answers: {},
      updatedAt: Date.now(),
    }));
  }

  function updateAnswer(question: string, value: string) {
    setSession((current) => ({
      ...current,
      answers: { ...current.answers, [question]: value },
      updatedAt: Date.now(),
    }));
  }

  function goToPassage() {
    onOpenBible(book, chapter, verse);
  }

  function startNew() {
    setSession({
      book,
      chapter,
      verse,
      genre: "epistola",
      stage: 0,
      answers: {},
      updatedAt: Date.now(),
    });
  }

  const summary = useMemo(() => {
    const lines = [
      `Pasaje: ${passageLabel(chapter, verse, initialBookName)}`,
      `Género: ${track.label}`,
      "",
    ];
    for (const [index, item] of stages.entries()) {
      const stageAnswers = item.questions
        .map((question) => {
          const answer = session.answers[question]?.trim();
          return answer ? `- ${question}\n  ${answer}` : "";
        })
        .filter(Boolean);
      if (stageAnswers.length) {
        lines.push(`${index + 1}. ${item.title}`);
        lines.push(...stageAnswers);
        lines.push("");
      }
    }
    return lines.join("\n");
  }, [book, chapter, verse, initialBookName, track, stages, session.answers]);

  return (
    <div className="hermeneutics-backdrop" role="dialog" aria-modal="true">
      <section className="hermeneutics-panel">
        <header className="hermeneutics-head">
          <div>
            <span className="eyebrow">Entorno de interpretación</span>
            <h2>Hermenéutica guiada</h2>
            <p>Observa, contextualiza, interpreta y aplica sin saltarte el texto.</p>
          </div>
          <button type="button" className="word-study-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className="hermeneutics-toolbar">
          <div className="hermeneutics-reference">
            <span className="hermeneutics-passage-name" title={initialBookName}>{initialBookName}</span>
            <input
              type="number"
              min={1}
              max={66}
              value={book}
              onChange={(event) => setBook(Number(event.target.value) || 1)}
              aria-label="Libro"
            />
            <input
              type="number"
              min={1}
              value={chapter}
              onChange={(event) => setChapter(Number(event.target.value) || 1)}
              aria-label="Capítulo"
            />
            <input
              type="number"
              min={1}
              value={verse}
              onChange={(event) => setVerse(Number(event.target.value) || 1)}
              aria-label="Versículo"
            />
            <button type="button" className="secondary-button" onClick={goToPassage}>Abrir en Biblia</button>
          </div>
          <div className="hermeneutics-actions">
            <span>{savedLabel}</span>
            <button type="button" className="secondary-button" onClick={startNew}>Nueva sesión</button>
            <button
              type="button"
              className="home-primary"
              onClick={() => {
                if (summary.trim()) void navigator.clipboard.writeText(summary);
              }}
            >
              Copiar síntesis
            </button>
          </div>
        </div>

        <div className="hermeneutics-progress">
          <span style={{ width: `${progress}%` }} />
          <small>{progress}% completado · {answered} respuestas</small>
        </div>

        <div className="hermeneutics-body">
          <aside className="hermeneutics-sidebar">
            <span className="hermeneutics-kicker">GÉNERO DEL PASAJE</span>
            <div className="hermeneutics-genres">
              {GENRES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === session.genre ? "genre-button active" : "genre-button"}
                  onClick={() => selectGenre(item.id)}
                >
                  <strong>{item.label}</strong>
                  <small>{item.short}</small>
                </button>
              ))}
            </div>

            <span className="hermeneutics-kicker">ETAPAS</span>
            <div className="hermeneutics-stages">
              {stages.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className={
                    index === session.stage
                      ? "hermeneutics-stage active"
                      : stageDone(item)
                        ? "hermeneutics-stage done"
                        : "hermeneutics-stage"
                  }
                  onClick={() => setSession((current) => ({ ...current, stage: index }))}
                >
                  <span>{stageDone(item) ? "✓" : index + 1}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <main className="hermeneutics-main">
            <div className="hermeneutics-stage-head">
              <div>
                <span className="hermeneutics-kicker">{track.label.toUpperCase()} · ETAPA {session.stage + 1}</span>
                <h3>{stage.title}</h3>
                <p>{stage.subtitle} — {track.focus}</p>
              </div>
              <div className="hermeneutics-stage-nav">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={session.stage === 0}
                  onClick={() => setSession((current) => ({ ...current, stage: Math.max(0, current.stage - 1) }))}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="home-primary"
                  disabled={session.stage >= stages.length - 1}
                  onClick={() => setSession((current) => ({ ...current, stage: Math.min(stages.length - 1, current.stage + 1) }))}
                >
                  Siguiente
                </button>
              </div>
            </div>

            <div className="hermeneutics-questions">
              {stage.questions.map((question) => (
                <label className="hermeneutics-question" key={question}>
                  <span>{question}</span>
                  <textarea
                    rows={3}
                    value={session.answers[question] ?? ""}
                    onChange={(event) => updateAnswer(question, event.target.value)}
                    placeholder="Escribe tu respuesta…"
                  />
                </label>
              ))}
            </div>

            <aside className="hermeneutics-traps">
              <div>
                <span className="hermeneutics-kicker">TRAMPAS A EVITAR</span>
                <ul>
                  {stage.traps.map((trap) => <li key={trap}>{trap}</li>)}
                </ul>
              </div>
              <div className="hermeneutics-rule">
                <strong>Regla de oro</strong>
                <p>El significado del texto no depende de lo que yo quiero que diga, sino de lo que el autor comunicó a sus primeros lectores y de cómo la Escritura lo desarrolla.</p>
              </div>
            </aside>
          </main>
        </div>
      </section>
    </div>
  );
}
