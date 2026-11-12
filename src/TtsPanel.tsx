import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import SelectMenu from "./SelectMenu";

interface TtsVoice {
  voiceId: string;
  displayName: string;
  language: string;
}

interface TtsAudio {
  audioBase64: string;
  mime: string;
}

interface TtsHealth {
  modelLoaded: boolean;
  qwenAvailable: boolean;
  error: string;
}

interface TtsPanelProps {
  text: string;
  label: string;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function TransportIcon({
  name,
}: {
  name: "prev" | "rewind" | "play" | "pause" | "stop" | "forward" | "next";
}) {
  const paths: Record<typeof name, string> = {
    prev: "M6 5v14M18 6l-8 6 8 6z",
    rewind: "M11 6L4 12l7 6V6zM20 6l-7 6 7 6V6z",
    play: "M8 5l11 7-11 7z",
    pause: "M7 5h3v14H7zM14 5h3v14h-3z",
    stop: "M6 6h12v12H6z",
    forward: "M4 6l7 6-7 6V6zM13 6l7 6-7 6V6z",
    next: "M18 5v14M6 6l8 6-8 6z",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export default function TtsPanel({
  text,
  label,
  onClose,
  onPrev,
  onNext,
}: TtsPanelProps) {
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [neuralVoices, setNeuralVoices] = useState<TtsVoice[]>([]);
  const [neuralAvailable, setNeuralAvailable] = useState(false);
  const [engine, setEngine] = useState<"system" | "neural">("system");
  const [voiceId, setVoiceId] = useState("");
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [continuous, setContinuous] = useState(true);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const continuousRef = useRef(continuous);
  const autoNextRef = useRef(false);

  useEffect(() => {
    continuousRef.current = continuous;
  }, [continuous]);

  useEffect(() => {
    let cancelled = false;
    invoke<TtsVoice[]>("tts_system_voices")
      .then((nextVoices) => {
        if (cancelled) return;
        setVoices(nextVoices);
        const spanish = nextVoices.find((voice) =>
          voice.language.toLowerCase().startsWith("es"),
        );
        setVoiceId((current) => current || spanish?.voiceId || nextVoices[0]?.voiceId || "");
      })
      .catch((value) => {
        if (!cancelled) setError(String(value));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<TtsHealth>("tts_health", {})
      .then(async (health) => {
        if (cancelled || !health.modelLoaded) return;
        const list = await invoke<{ voices: TtsVoice[] }>("tts_voices", {});
        if (cancelled) return;
        setNeuralAvailable(true);
        setNeuralVoices(list.voices);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const list = engine === "neural" ? neuralVoices : voices;
    setVoiceId((current) =>
      list.some((voice) => voice.voiceId === current)
        ? current
        : list[0]?.voiceId ?? "",
    );
  }, [engine, voices, neuralVoices]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
    setPaused(false);
    setProgress(0);
    setDuration(0);
    if (!text) return;
    if (autoNextRef.current) {
      autoNextRef.current = false;
      const timer = window.setTimeout(() => void play(), 120);
      return () => window.clearTimeout(timer);
    }
  }, [text]);

  async function play() {
    if (!text.trim()) {
      setError("Este versículo no tiene texto para leer.");
      return;
    }
    setLoading(true);
    setError("");
    setPaused(false);
    audioRef.current?.pause();
    try {
      const audio =
        engine === "neural"
          ? await invoke<TtsAudio>("tts_synthesize", {
              text,
              voiceId,
              speed,
            })
          : await invoke<TtsAudio>("tts_system_synthesize", {
              text,
              voiceId,
              speed,
            });
      const element = new Audio(
        `data:${audio.mime};base64,${audio.audioBase64}`,
      );
      audioRef.current = element;
      element.onloadedmetadata = () => setDuration(element.duration || 0);
      element.ontimeupdate = () => setProgress(element.currentTime || 0);
      element.onplay = () => setPlaying(true);
      element.onpause = () => setPlaying(false);
      element.onended = () => {
        setPlaying(false);
        setPaused(false);
        setProgress(0);
        if (continuousRef.current) {
          autoNextRef.current = true;
          onNext();
        }
      };
      element.onerror = () => {
        setPlaying(false);
        setError("No se pudo reproducir el audio generado.");
      };
      await element.play();
      setPlaying(true);
    } catch (value) {
      setError(String(value));
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }

  function togglePlay() {
    if (!audioRef.current) {
      void play();
      return;
    }
    if (audioRef.current.paused) {
      void audioRef.current.play();
      setPaused(false);
    } else {
      audioRef.current.pause();
      setPaused(true);
    }
  }

  function stop() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(false);
    setPaused(false);
    setProgress(0);
  }

  function skip(seconds: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(
        audioRef.current.duration || 0,
        audioRef.current.currentTime + seconds,
      ),
    );
  }

  function move(direction: "prev" | "next") {
    stop();
    if (direction === "prev") onPrev();
    else onNext();
  }

  return (
    <aside className="tts-panel tts-player">
      <header className="tts-header">
        <div>
          <span className="eyebrow">Lectura en voz alta</span>
          <strong>Reproductor</strong>
        </div>
        <button onClick={onClose} aria-label="Cerrar reproductor">
          ×
        </button>
      </header>

      <div className="tts-context">
        <span>{label}</span>
        <p>{text.slice(0, 220)}</p>
      </div>

      <div className="tts-now-playing">
        <span className={playing ? "tts-equalizer active" : "tts-equalizer"}>
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>
          {playing
            ? "Reproduciendo"
            : loading
              ? "Preparando voz…"
              : paused
                ? "Pausado"
                : "Listo"}
        </span>
      </div>

      <div className="tts-progress">
        <span>{formatTime(progress)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.05"
          value={Math.min(progress, duration || 0)}
          onChange={(event) => {
            if (audioRef.current) {
              audioRef.current.currentTime = Number(event.target.value);
              setProgress(Number(event.target.value));
            }
          }}
          aria-label="Progreso de lectura"
        />
        <span>{formatTime(duration)}</span>
      </div>

      <div className="tts-transport">
        <button onClick={() => move("prev")} title="Versículo anterior">
          <TransportIcon name="prev" />
        </button>
        <button onClick={() => skip(-10)} title="Retroceder 10 segundos">
          <TransportIcon name="rewind" />
        </button>
        <button
          className="tts-play"
          onClick={togglePlay}
          disabled={loading}
          title={playing ? "Pausar" : "Reproducir"}
        >
          {loading ? (
            <span className="tts-loading-dot">…</span>
          ) : (
            <TransportIcon name={playing ? "pause" : "play"} />
          )}
        </button>
        <button onClick={stop} title="Detener">
          <TransportIcon name="stop" />
        </button>
        <button onClick={() => skip(10)} title="Avanzar 10 segundos">
          <TransportIcon name="forward" />
        </button>
        <button onClick={() => move("next")} title="Versículo siguiente">
          <TransportIcon name="next" />
        </button>
      </div>

      {error && <div className="tts-error">{error}</div>}

      {neuralAvailable && (
        <div className="tts-engine">
          <button
            className={engine === "system" ? "active" : ""}
            onClick={() => setEngine("system")}
          >
            Voz del sistema
          </button>
          <button
            className={engine === "neural" ? "active" : ""}
            onClick={() => setEngine("neural")}
          >
            Voz neural
          </button>
        </div>
      )}

      <div className="tts-controls">
        <SelectMenu
          className="tts-voice-select"
          value={voiceId}
          onChange={setVoiceId}
          ariaLabel="Voz de lectura"
          options={(engine === "neural" ? neuralVoices : voices).map((voice) => ({
            value: voice.voiceId,
            label: voice.displayName,
          }))}
        />
        <label className="tts-continuous">
          <input
            type="checkbox"
            checked={continuous}
            onChange={(event) => setContinuous(event.target.checked)}
          />
          Continuo
        </label>
      </div>

      <label className="tts-speed">
        Velocidad {speed.toFixed(2)}×
        <input
          type="range"
          min="0.7"
          max="1.4"
          step="0.05"
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
        />
      </label>

      <div className="tts-footer-note">
        {engine === "neural"
          ? "Motor neural local · más natural"
          : "Voz local del sistema · sin conexión"}
      </div>
    </aside>
  );
}
