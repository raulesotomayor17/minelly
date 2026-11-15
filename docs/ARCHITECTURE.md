# Arquitectura

Minelly es una aplicación de escritorio **Tauri 2** con un núcleo en **Rust** y
una interfaz en **React 19 + TypeScript**. La persistencia principal es un
archivo **SQLite** local con **FTS5** para búsqueda.

## Vista general

```text
┌──────────────────────────────────────────────────────────┐
│ Interfaz React (src/)                                    │
│  · Lector, biblioteca, lienzo modular, notas, sermones   │
│  · Zustand para estado de UI                             │
│  · TipTap para edición enriquecida                        │
└──────────────────────────┬───────────────────────────────┘
                           │ invoke() / eventos Tauri
┌──────────────────────────▼───────────────────────────────┐
│ Núcleo Rust (src-tauri/src/)                             │
│  · commands.rs: API que consume la interfaz              │
│  · db.rs: catálogo SQLite, consultas y migraciones       │
│  · import/: e-Sword, MySword, EPUB, DOCX, PDF            │
│  · indexer.rs / indexer_v2.rs: FTS5                      │
│  · notes.rs, sermon.rs, pbb.rs, reading.rs...            │
│  · export.rs, document_export.rs, typeset.rs             │
└──────────────────────────┬───────────────────────────────┘
                           │
                 ┌─────────▼─────────┐
                 │ catalog.sqlite    │
                 │ + recursos FTS5   │
                 └───────────────────┘
```

## Capas

### Interfaz (`src/`)

- `App.tsx` y `App.css`: shell, barra superior, temas y navegación.
- `EreaderWorkspace.tsx`: lector de libros y paneles de lectura.
- `ModularWorkspace.tsx` y `lienzo/`: árbol de paneles, pestañas, divisiones,
  paneles flotantes y *link sets*.
- `StudyAssistant.tsx` y `AiTypesetter.tsx`: asistente RAG y tipografía asistida.
- `Sermon*.tsx`, `SlideCanvas.tsx`, `PixabayPicker.tsx`: módulo de sermones.
- `Notes*.tsx`, `notebook*`: notas, etiquetas y anclajes.
- `ResourceSearch.tsx`: búsqueda global unificada.
- `i18n.en.ts`: cadenas en inglés.

La interfaz no accede directamente a SQLite: todo pasa por comandos Tauri. Los
permisos de la ventana están en `src-tauri/capabilities/default.json`.

### Núcleo Rust (`src-tauri/src/`)

| Archivo | Responsabilidad |
| --- | --- |
| `lib.rs` | Arranque, migración del catálogo, siembra de datos opcionales y registro de comandos. |
| `commands.rs` | Fachada de comandos expuestos a React. |
| `db.rs` | Esquema, consultas, recursos, versículos, comentarios y diccionario. |
| `books.rs` | Los 66 libros, abreviaturas y numeración OSIS. |
| `import/mod.rs` | Importador e-Sword / MySword. |
| `import/epub.rs` | Lector e importador EPUB. |
| `import/docx.rs` | Extracción de estructura de DOCX. |
| `import/pdf.rs` | Conversión opcional de PDF con Calibre. |
| `indexer.rs`, `indexer_v2.rs` | Índice FTS5 y búsqueda global. |
| `notes.rs` | Notas, cuadernos, etiquetas, resaltados y anclajes. |
| `sermon.rs` | CRUD de sermones y diapositivas. |
| `pbb.rs` | Compilación de libros personales (PBB). |
| `reading.rs` | Estado de lectura y entornos. |
| `resource_search.rs` | Búsqueda dentro de recursos. |
| `interlinear.rs`, `wordstudy.rs` | Interlineal y estudio de palabra. |
| `rag.rs` | Recuperación de fragmentos para el asistente. |
| `typeset.rs` | Corrección tipográfica y estructural de libros. |
| `export.rs` | Exportación PPTX, ODP y PDF. |
| `document_export.rs` | Exportación DOCX y ODT. |
| `library.rs` | Catalogación y metadatos de la biblioteca. |
| `editorial.rs` | Utilidades editoriales. |

### Esquema de datos

Tablas principales:

- `resources`: metadatos de cada recurso (Biblia, comentario, diccionario,
  libro, etc.).
- `verses`: texto por recurso, libro, capítulo y versículo.
- `commentary`: entradas de comentario con rangos.
- `dictionary`: temas y definiciones.
- `epub_chapters` y `pbb_books`: libros y capítulos.
- `notebooks`, `notes`, `tags`, `highlights`, `annotations`: estudio personal.
- `sermons`, `sermon_slides`: sermones y diapositivas.
- Tablas FTS5: `search_index` y variantes por recurso.

El esquema se crea y migra en `db.rs`. Antes de cambiar una tabla, añade una
migración compatible y prueba con un catálogo existente.

## Flujo de importación

1. El usuario elige una carpeta o archivo con el diálogo nativo.
2. Rust detecta el formato por extensión y contenido.
3. Se lee el módulo en su ruta original (no se copia el archivo completo).
4. Se normaliza el HTML, se sanea con `ammonia` y se inserta en SQLite.
5. Se indexa el texto en FTS5.
6. La interfaz refresca la biblioteca.

El importador no elude DRM ni formatos propietarios de Logos.

## Datos opcionales empaquetados

Al arrancar, `lib.rs` busca:

- `clean_catalog.sqlite.gz` o `premium_catalog.sqlite.gz` para una biblioteca de
  fábrica.
- `wordstudy.sqlite.gz` para el estudio de palabra.
- `interlinear_factory.sqlite.gz` para el interlineal.

Si no existen, la app sigue funcionando con un catálogo vacío. El repositorio no
los incluye; consulta [`DATA.md`](DATA.md) antes de generarlos o redistribuirlos.

## Decisiones de seguridad

- `csp: null` en `tauri.conf.json` permite contenido local y remoto, pero reduce
  la defensa contra inyección de HTML. Es una limitación conocida.
- La ventana solo declara permisos de diálogo, portapapeles, *opener* y pantalla
  completa.
- Las claves de API viven en `localStorage`; no se envían al proyecto.
- Los textos importados se sanean antes de mostrarse, pero el contenido de
  terceros debe tratarse como no confiable.

## Pruebas y verificación

- `npm run build` valida TypeScript y el bundle de Vite.
- `cargo check --manifest-path src-tauri/Cargo.toml` valida Rust.
- `npm run tauri build -- --no-bundle` valida el empaquetado sin instaladores.
- Los *smoke tests* de `src-tauri/src/bin/` requieren la feature `tools`:

  ```bash
  cargo run --features tools --bin pbb_smoke
  ```

No hay una suite de tests automatizada completa. Si añades lógica de importación
o de base de datos, incluye pruebas y datos de ejemplo **de dominio público**.
