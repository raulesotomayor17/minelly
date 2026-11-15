# Funciones

Esta es una descripción amplia de lo que hace Minelly en la versión 0.2.x.
Algunas funciones dependen de los módulos que importes y de los servicios que
configures.

## Lectura de la Biblia

- Biblioteca local con libros, capítulos y versículos.
- Tres modos de lectura: **versículo**, **página** y **libro completo**.
- Navegación por libro, capítulo y versículo desde la barra superior.
- Números de versículo, títulos y notas activables.
- Formato por versículo o en párrafo corrido.
- Fuente, tamaño, interlineado y ancho de lectura ajustables.
- Modo enfoque y modo inmersivo; pantalla completa nativa (`F11`).
- Retoma la última ubicación al abrir la app.

## Biblioteca y recursos

- Catálogo SQLite con metadatos, tipo, idioma y prioridad.
- Importación de e-Sword (`.bbli`, `.cmti`, `.dcti`, `.refi`, `.mapx`),
  MySword (`.bbl.mybible`, `.cmt.mybible`, `.dct.mybible`) y EPUB sin DRM.
- Importación de DOCX y conversión opcional de PDF con Calibre.
- Selección nativa de carpeta; no hay que escribir rutas.
- Filtros, búsqueda y estadísticas de la biblioteca.
- Borrado y edición de metadatos de recursos.
- Los módulos originales no se copian: se leen en su ruta y el catálogo guarda
  el texto normalizado y saneado.

## Estudio

- Panel de comentario sincronizado con el versículo.
- Diccionario con búsqueda por tema o palabra.
- Comparador de 2–5 versiones con filas alineadas, scroll único y diferencias
  palabra por palabra.
- Interlineal inverso del Nuevo Testamento: texto español, griego, lema,
  número Strong, morfología y transliteración.
- Estudio de palabra con Strong, Tischendorf y BHS.
- Referencias cruzadas y mapas catalogados (visor en desarrollo).

## Lienzo modular y entornos

- Árbol binario de paneles con división horizontal y vertical.
- Pestañas de cualquier tipo dentro de un panel.
- Paneles flotantes que se pueden mover, redimensionar y volver a acoplar.
- *Link sets* A–F: los paneles del mismo grupo sincronizan libro, capítulo,
  versículo y scroll.
- Diseños guardables con nombre, carga, exportación e importación JSON.
- Entornos que recuperan versión, pasaje, modo, fuente, panel y enfoque.

## Notas y anclajes

- Cuadernos jerárquicos con etiquetas.
- Editor TipTap con formato enriquecido.
- Anclajes bíblicos OSIS (`bible:JHN:3:16`) y de recurso (`res:<id>#...`).
- Resaltados y anotaciones.
- Popup de selección, filtros, *backlinks* y exportación `.teonotes`.
- Búsqueda de notas dentro del índice global.

## Libros y documentos

- Lector EPUB con índice de capítulos, secciones y citas.
- Panel de vista con 1–3 columnas, ancho, interlineado, justificación, sangría,
  capitular y regla entre columnas.
- Barra de progreso y porcentaje leído.
- Constructor de Libros Personales (PBB): metadatos bibliográficos, cola de
  DOCX/PDF, validación, log de diagnóstico y compilación SQLite/FTS5.
- Ciclo de vida PBB: abrir, recompilar, eliminar y sincronizar.

## Sermones y diapositivas

- Administrador con filtros por serie, lugar, servicio, tema y libro bíblico.
- Preparador por bloques con encabezados H1–H5, citas, ilustraciones y
  referencias bíblicas insertadas con `Alt+Enter`.
- Vistas: Editar, Texto, Diapositivas, Hoja informativa y Preguntas.
- Lienzo libre de texto e imágenes con movimiento, redimensionado, fondos y
  orden persistente.
- Exportación a PPTX, ODP, PDF, DOCX y ODT.
- Buscador de imágenes Pixabay e imágenes locales.

## Búsqueda y voz

- Índice FTS5 unificado de Biblias, comentarios, diccionarios, libros, PBB y
  notas.
- Resultados agrupados por tipo, con fragmentos y aviso de indexación.
- Lectura TTS local verso por verso con `espeak-ng`, SAPI o `say`.
- Panel con estado del servidor, voces, velocidad, pausa, stop y navegación.
- Qwen3-TTS opcional si hay un servidor local configurado.

## Asistente de estudio

- Recupera fragmentos de la biblioteca local (RAG).
- Redacta una respuesta con citas clicables usando tu propia clave de DeepSeek.
- Sin clave, muestra solo los fragmentos recuperados.
- Historial y contador de tokens locales.
- No hay servidor central de Minelly.

## Apariencia y accesibilidad

- Temas Glassmorphism, Azul, Gris, Verde y Blanco.
- Fuentes locales: Literata, Crimson Pro, Cormorant Garamond, Libre Baskerville
  e Inter.
- Barra lateral movible (izquierda, derecha, arriba, abajo), colapsable y con
  auto-ocultado.
- Desplegables propios, foco visible y controles accesibles.
- Interfaz principal en español; cadenas en inglés en `src/i18n.en.ts`.

## Lo que no hace

- No lee formatos propietarios de Logos (`.logos4`, `.lbssd`, etc.).
- No elude DRM ni protecciones tecnológicas.
- No incluye Biblias, comentarios ni libros.
- No sincroniza automáticamente con la nube.
- No tiene telemetría ni cuentas.
- No es una app móvil; el foco es escritorio.

## Estado de verificación

- Windows 11 x64: compilado, abierto y probado con recursos propios.
- Fedora/Ubuntu: compilación soportada y CI configurado.
- macOS: CI configurado; falta prueba manual.
- La app no incluye datos de prueba en el repositorio.
