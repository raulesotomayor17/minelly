# Análisis de Calibre aplicado a Teoamoxtli

## Fuente analizada

- ZIP original: `<ruta-del-repositorio>/calibre-master.zip`
- Repositorio extraído: `<ruta-del-repositorio>/calibre-master`
- Origen: https://github.com/kovidgoyal/calibre
- Calibre instalado en el equipo de desarrollo: 9.15.0, con `ebook-convert.exe`
  en la ruta de instalación habitual de Windows.

## Módulos revisados

| Módulo | Qué aporta |
| --- | --- |
| `src/calibre/ebooks/conversion/plugins/docx_input.py` | Entrada DOCX/DOCM, conversión a HTML y detección de portada. |
| `src/calibre/ebooks/docx/to_html.py` | Conversión de estilos, tablas, listas, notas, imágenes y estructura. |
| `src/calibre/ebooks/metadata/docx.py` | Lectura de propiedades del documento y portada. |
| `src/calibre/ebooks/conversion/plumber.py` | Pipeline de conversión, opciones, plugins de entrada/salida y depuración. |
| `src/calibre/gui2/actions/add.py` | Añadir archivos, formatos, duplicados y confirmación de reemplazo. |

## Decisiones adoptadas

1. **Detección por extensión y contenido**: `.docx` se trata como contenedor ZIP
   con XML; `.pdf` se convierte opcionalmente con Calibre.
2. **Pipeline por etapas**: se replica la idea de conversión por fases, pero con
   los nombres del manual PBB: Starting, Converting, Compiling, Discovering.
3. **Metadatos**: se leen `docProps/core.xml` y `docProps/app.xml`; la portada se
   busca en `word/media`.
4. **Cola ordenada**: los documentos se guardan con `orderIndex` y se pueden
   subir/bajar antes de compilar.
5. **Conversión externa**: para PDF se invoca `ebook-convert` y se reutiliza el
   parser DOCX nativo. La ruta se detecta por variable de entorno, rutas comunes
   de Windows o `where.exe`.
6. **Diagnóstico**: cada compilación escribe un `.log` con etapas, errores,
   advertencias y referencias detectadas.
7. **No se copió código de Calibre**. Calibre es GPLv3; Teoamoxtli implementa en
   Rust un subconjunto original inspirado en sus ideas.

## Diferencias con Calibre

- Calibre convierte a EPUB/MOBI/PDF; Teoamoxtli compila a un recurso SQLite con
  capítulos HTML y FTS5.
- Calibre tiene plugins completos de estilos, notas, tablas e imágenes; la
  primera versión PBB cubre encabezados, párrafos, negritas, cursivas, subrayado,
  tablas como párrafos y referencias bíblicas.
- La sincronización con la nube no está conectada: se genera un paquete local
  `.pbbundle.json` y el libro queda marcado como inmutable.

## Pruebas

- `ebook-convert` convirtió el manual PDF de PBB a DOCX correctamente.
- El smoke test `pbb_smoke` compiló un DOCX con capítulos, referencias y FTS5.
- El DOCX inválido produjo los diagnósticos `EMPTY_HEADING_BREAK`,
  `EMPTY_HEADING` y `ZERO_LENGTH_ARTICLE`.
