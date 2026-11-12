# RAG en Teoamoxtli

## Decisión

La biblioteca no se envía completa al modelo. El asistente usa recuperación
local primero y solo manda a DeepSeek la pregunta y los fragmentos recuperados.

## Flujo

```text
Pregunta
  → recuperación local (SQLite)
  → hasta 6 fragmentos con ID
  → prompt con instrucciones y citas
  → DeepSeek /chat/completions
  → respuesta + contextos
  → citas [ID: ...] convertidas en enlaces
  → lector, comentario o libro
```

## Recuperación local

Fuentes:

| Tabla | Tipo |
| --- | --- |
| `verses` | Biblias |
| `commentary` | Comentarios |
| `dictionary` | Diccionarios |
| `epub_chapters` | EPUB y libros PBB |

Se tokeniza la pregunta, se eliminan palabras vacías y se buscan coincidencias
léxicas. Si se detecta un libro (`Romanos`, `Juan`, etc.), se filtra por ese
libro en Biblias y comentarios. Los resultados se recortan a texto plano y se
limitan a 6.

Cada fragmento tiene un ID canónico:

```text
verse:<resource_id>:<book>:<chapter>:<verse>
commentary:<resource_id>:<book>:<chapter>:<verse>
dictionary:<resource_id>:<topic>
book:<resource_id>:<spine>
```

## Prompt

El sistema ordena:

- Usar únicamente los fragmentos.
- No añadir conocimiento externo.
- No inventar citas.
- Avisar si no hay información suficiente.
- Citar con `[ID: ...]` sin modificar los IDs.
- Responder en español.

## Contrato

```rust
#[tauri::command]
pub async fn ask_study_assistant(
    state: State<'_, AppState>,
    query: String,
    api_key: String,
    model: Option<String>,
) -> Result<RagAnswer, String>
```

`RagAnswer`:

```json
{
  "answer": "… [ID: verse:…] …",
  "contexts": [
    {
      "id": "verse:esword:01-rvr1960:bbl:45:4:25",
      "kind": "bible",
      "resourceId": "esword:01-rvr1960:bbl",
      "resourceTitle": "RVR1960",
      "label": "Romanos 4:25",
      "book": 45,
      "chapter": 4,
      "verse": 25,
      "spine": 0,
      "text": "…"
    }
  ],
  "model": "deepseek-chat",
  "localOnly": false
}
```

## Privacidad

- La API key no se guarda en SQLite ni en `localStorage`; el frontend la
  mantiene en memoria.
- Solo se envían la pregunta y los fragmentos recuperados.
- No se envían notas, historial de navegación ni la biblioteca completa.
- Sin clave API no hay llamada de red: se muestran solo los fragmentos locales.

## Límites actuales

- Recuperación léxica, no vectorial. La siguiente fase puede añadir embeddings
  locales (SQLite-VSS o Qdrant) y combinar BM25 + similitud.
- Faltan resumen/traducción de selección y generación de sermones.
- La calidad de la respuesta depende de que el usuario tenga una API key válida
  y de la relevancia de los fragmentos recuperados.
