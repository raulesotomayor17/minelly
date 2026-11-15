# Qwen3-TTS en Teoamoxtli

## Estado de instalación

Repositorio extraído en:

```text
<ruta-del-repositorio-Qwen3-TTS>
```

Se creó un entorno aislado con Python 3.12 y se instalaron las dependencias del
servidor:

```text
.venv\Scripts\python.exe
fastapi, uvicorn, numpy, soundfile
qwen-tts (editable, --no-deps)
```

El servidor arranca con:

```powershell
cd <ruta-del-repositorio-Qwen3-TTS>
.\.venv\Scripts\python.exe -m uvicorn server.tts_server:app --host 127.0.0.1 --port 8000
```

`GET /health` responde. En esta máquina devuelve:

```json
{
  "model_loaded": false,
  "qwen_available": false,
  "error": "torch no está instalado en este entorno."
}
```

No se instalaron `torch`, `torchaudio` ni los pesos del modelo. Se intentó
descargar torch CUDA 12.1 (rueda de 2.4 GB), pero la descarga se detuvo; además, la GPU de 4 GB
del equipo de desarrollo se queda corta para las variantes mayores.

El reproductor no depende de Qwen: usa el motor del sistema. El selector
“Voz neural” solo aparece si `/health` informa `model_loaded: true`. Para Qwen
real faltan torch, transformers, accelerate, librosa, los pesos y un WAV de
referencia con su transcripción.

## Análisis del JSON propuesto

### Modelo

`Qwen3-TTS-12Hz-0.6B-Base` existe y soporta español. Es la variante **Base**:
está pensada para clonación con audio de referencia. No es la variante
`CustomVoice`, que usa timbres predefinidos como Ryan.

Con Base, **todas** las voces deben tener:

- `reference_audio_path` (WAV de 3–10 s, ruta válida de Windows).
- `reference_text` (transcripción exacta de ese audio).
- `language: "Spanish"`.

El JSON original solo trae `reference_audio_path`; sin `reference_text` la
clonación pierde calidad o se rechaza. El servidor actual exige ambos.

### Streaming

La documentación de Qwen habla de streaming de baja latencia, pero en la API
Python `generate_voice_clone()` devuelve `(wavs, sample_rate)` después de
generar. `non_streaming_mode=False` simula entrada de texto en streaming; no
expone un flujo de audio token por token.

El endpoint `/api/v1/tts/stream` implementado devuelve WAV por trozos **después**
de generar el segmento. Para un audiolibro real conviene:

1. Sintetizar versículo N.
2. Reproducirlo.
3. Precargar N+1 en segundo plano.
4. Empezar a reproducir N+1 mientras se genera N+2.

No se debe prometer latencia de 97 ms en hardware modesto.

### `speed_factor`

No es un parámetro nativo de `generate_voice_clone`. El servidor lo aplica
como post-proceso con `librosa.effects.time_stretch`; si `librosa` no está
instalado, mantiene la velocidad normal. Para control real de prosodia hay que
usar `instruct` en modelos que lo soporten o regenerar.

### Hardware

El equipo de desarrollo tiene una **GPU de 4 GB**.

- 0.6B en fp16 puede quedar justo en 4 GB; el tokenizer y Transformers añaden
  memoria. Es la única variante razonable.
- 1.7B probablemente no entra en 4 GB.
- FlashAttention 2 no es fiable en GPUs de gama baja; el servidor usa `sdpa`.
- Alternativa: CPU (lento) o GPU con más VRAM.

## Esquema corregido de voz

```json
{
  "voice_id": "usr_ejemplo_01",
  "display_name": "Voz de ejemplo (clon personal)",
  "reference_audio_path": "voices/clones/ejemplo_5sec_sample.wav",
  "reference_text": "Texto exacto de la grabación de referencia.",
  "language": "Spanish",
  "is_custom_clone": true
}
```

## Servidor implementado

`server/tts_server.py`:

- `GET /health`
- `GET /api/v1/voices`
- `POST /api/v1/voices/reload`
- `POST /api/v1/tts` → WAV
- `POST /api/v1/tts/stream` → WAV por chunks

Carga el modelo de forma perezosa; si faltan dependencias, devuelve un error
claro en lugar de caerse.

## Reproductor activo multiplataforma

Para que la función esté operativa sin esperar a torch/Qwen, el lector usa el
motor de voz del sistema:

| Sistema | Motor |
| --- | --- |
| Windows | SAPI / `System.Speech`; Microsoft Sabina (es-MX) |
| macOS | `say`; conversión a WAV con `afconvert` |
| Linux | `espeak-ng` o `espeak` con `--stdout` |

Rust devuelve el audio en base64 y el mismo panel lo reproduce. Incluye
play/pausa, stop, ±10 s, versículo anterior/siguiente, progreso, velocidad y
lectura continua. Qwen queda como motor opcional interno; no se muestra su
marca en el reproductor.

En Linux hay que instalar `espeak-ng` (por ejemplo
`sudo apt install espeak-ng`) si no está presente. macOS trae `say` de fábrica.

## App

El lector tiene un botón de audio y el panel `TtsPanel`:

- Consulta salud y voces.
- Muestra el estado real del modelo.
- Permite elegir voz y velocidad.
- Sintetiza el versículo actual.
- Reproduce el WAV con `Audio`.
- Navega al versículo anterior/siguiente.

El puente Tauri está en `commands.rs` (`tts_health`, `tts_voices`,
`tts_synthesize`).

## Pendiente para audio real

1. Instalar torch/torchaudio CUDA 12.1 en el venv.
2. Instalar dependencias del modelo (`transformers`, `accelerate`, etc.).
3. Descargar `Qwen/Qwen3-TTS-12Hz-0.6B-Base`.
4. Colocar un WAV de referencia y su transcripción exacta.
5. Añadir una voz de locutor con su propio WAV.
6. Probar en la GPU disponible; si hay OOM, usar CPU o cuantización.

Comandos orientativos:

```powershell
.\.venv\Scripts\python.exe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
.\.venv\Scripts\python.exe -m pip install -r server\requirements.txt
```

El modelo se descarga automáticamente en el primer uso si hay conexión.
