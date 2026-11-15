# Changelog

Todas las fechas usan el formato AAAA-MM-DD. El proyecto sigue un versionado
semántico aproximado mientras está en alfa.

## [No publicado]

- Preparación de la primera publicación del código fuente.
- Documentación de compilación, datos, privacidad, seguridad y contribución.
- Limpieza del repositorio: se excluyen artefactos de compilación, registros
  internos y paquetes de datos con posibles derechos de terceros.
- Licencia MIT para el código.

## [0.2.0] — 2026-11-14

Primera instantánea pública del código.

### Añadido

- Lector de Biblia con modos versículo, página y libro completo.
- Catálogo SQLite local e importadores de e-Sword, MySword y EPUB sin DRM.
- Comentarios sincronizados, diccionarios y comparador de 2–5 versiones.
- Interlineal inverso del NT y estudio de palabra con Strong, morfología,
  Tischendorf y BHS.
- Lienzo modular con paneles flotantes, pestañas y *link sets* A–F.
- Entornos de trabajo guardables, exportables e importables.
- Notas, cuadernos, etiquetas, resaltados y anclajes OSIS.
- Lector EPUB, importación DOCX/PDF y Constructor de Libros Personales (PBB).
- Administrador y preparador de sermones con exportación a PPTX, ODP, PDF, DOCX
  y ODT.
- Búsqueda global FTS5.
- Lectura TTS local y asistente de estudio RAG con clave propia.
- Temas, fuentes locales, barra lateral movible y modo inmersivo.
- CI para Windows, Ubuntu, macOS y Fedora.

### Notas

- No se incluyen Biblias, comentarios, diccionarios ni libros.
- No se incluyen binarios ni instaladores en el repositorio.
- La compilación por defecto no requiere los paquetes de datos opcionales.
