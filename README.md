<p align="center">
  <img src="design-system/minelly/logos/lockup-A-curvas.svg" alt="Minelly · Estudio Bíblico" width="420">
</p>

<h1 align="center">Minelly · Estudio Bíblico</h1>

<p align="center">
  Aplicación de escritorio <strong>local-first</strong> para estudiar la Biblia,
  comparar versiones, tomar notas y preparar sermones.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licencia: MIT" src="https://img.shields.io/badge/licencia-MIT-2ea44f"></a>
  <img alt="Estado: alfa" src="https://img.shields.io/badge/estado-alfa-orange">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-stable-000000?logo=rust">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react">
</p>

---

**Minelly** es una aplicación original de estudio bíblico para Windows, Linux y
macOS. El motor está escrito en **Rust** y la interfaz en **Tauri 2 + React +
TypeScript**. Funciona con una biblioteca SQLite local y **no incluye Biblias,
comentarios ni libros**: tú importas los módulos que tengas derecho a usar.

> Interfaz y flujo de estudio originales, inspirados en la organización visual de
> las aplicaciones bíblicas profesionales. Minelly no está afiliada a Logos,
> Faithlife ni a ninguna editorial, y no usa su código, sus imágenes ni sus
> marcas.

## Estado

- **Alfa pública (0.2.x).** Hay funciones completas y estables, pero la interfaz
  y el esquema de datos pueden cambiar antes de la versión 1.0.
- Probado principalmente en **Windows 11 x64**. La compilación en **Fedora** y
  **Ubuntu** está soportada y verificada por CI; macOS se compila en CI, pero
  aún no tiene pruebas manuales exhaustivas.
- El repositorio **no contiene datos bíblicos ni instaladores**. Los datos y los
  binarios se producen localmente o se publican como artefactos de release.

## Funciones principales

| Área | Qué incluye |
| --- | --- |
| **Lectura** | Biblia por libro, capítulo y versículo; modos versículo, página y libro completo; formato dinámico; modo enfoque e inmersivo. |
| **Biblioteca** | Catálogo SQLite local, prioridad de recursos, filtros, estadísticas y búsqueda. |
| **Estudio** | Comentarios sincronizados, diccionarios, comparador de 2–5 versiones, interlineal inverso del NT y estudio de palabra (Strong, morfología, Tischendorf, BHS). |
| **Comparación** | Filas alineadas, scroll único, diferencias palabra por palabra y porcentaje de diferencia. |
| **Lienzo modular** | Árbol de paneles con división, pestañas, paneles flotantes y *link sets* A–F que sincronizan pasaje y scroll. |
| **Entornos** | Diseños de trabajo guardables, exportables e importables en JSON. |
| **Notas** | Cuadernos jerárquicos, etiquetas, resaltados, editor TipTap y anclajes OSIS (`bible:JHN:3:16`) o de recurso. |
| **Libros** | Lector EPUB, importación de DOCX/PDF y Constructor de Libros Personales (PBB) con compilación SQLite/FTS5. |
| **Sermones** | Administrador, preparador por bloques y cinco vistas; exportación a PPTX, ODP, PDF, DOCX y ODT. |
| **Búsqueda** | Índice FTS5 unificado de Biblias, comentarios, diccionarios, libros y notas. |
| **Voz** | Lectura TTS local con `espeak-ng` (Linux), SAPI (Windows) o `say` (macOS); Qwen3-TTS opcional. |
| **IA** | Asistente RAG que usa tu propia clave de DeepSeek; sin clave solo muestra los fragmentos recuperados. |
| **Apariencia** | Temas, fuentes locales (Literata, Crimson Pro, Cormorant Garamond, Libre Baskerville, Inter), barra lateral movible y controles accesibles. |

Hay una descripción más detallada en [`docs/FEATURES.md`](docs/FEATURES.md).

## Requisitos

- **Node.js 22 o superior** (el CI usa Node 24).
- **Rust estable** y las dependencias de Tauri 2 para tu sistema.
- **Linux:** WebKitGTK 4.1, GTK 3, `libappindicator`, `librsvg`, `libxdo`,
  `openssl` y `espeak-ng` si quieres la lectura en voz alta.
- **Windows:** Microsoft C++ Build Tools, WebView2 (incluido en Windows 11) y,
  opcionalmente, NSIS para el instalador.
- **macOS:** Xcode Command Line Tools.

## Inicio rápido

```bash
git clone https://github.com/raulesotomayor17/minelly.git
cd minelly
npm ci
npm run tauri dev
```

Para compilar el binario sin generar instaladores:

```bash
npm run tauri build -- --no-bundle
```

Para generar RPM, DEB, AppImage, MSI/NSIS o DMG, consulta
[`docs/BUILD.md`](docs/BUILD.md). La compilación por defecto no necesita los
paquetes de datos opcionales.

## Datos, derechos y privacidad

Este repositorio **no distribuye** Biblias, comentarios, diccionarios, libros ni
bases de datos derivadas de obras con derechos de autor. Tampoco incluye
`wordstudy.sqlite.gz` ni `interlinear_factory.sqlite.gz`.

- Usa únicamente módulos que hayas comprado, que sean de dominio público o que
  tengas permiso expreso de distribuir.
- No adjuntes texto bíblico, comentarios ni módulos con derechos de autor en
  *issues*, *pull requests* o capturas de pantalla.
- El importador lee e-Sword, MySword y EPUB **sin DRM**. No elude protecciones
  tecnológicas.
- La app es local-first: no tiene telemetría. Solo hace peticiones de red si
  configuras el asistente de IA, el buscador de imágenes o un servidor TTS.

Lee [`docs/DATA.md`](docs/DATA.md) antes de publicar una biblioteca o un
instalador, y [`PRIVACY.md`](PRIVACY.md) para el detalle de datos personales.

## Estructura del proyecto

```text
src/                    Interfaz React + TypeScript
src-tauri/              Motor Rust, comandos Tauri y empaquetado
  src/                  Biblioteca, importadores, notas, sermones, PBB...
  icons/                Iconos de la aplicación
  capabilities/         Permisos de la ventana Tauri
design-system/          Identidad visual y documentos de arquitectura
docs/                   Guías de compilación, datos y arquitectura
scripts/                Utilidades para generar paquetes de datos
.github/                CI y plantillas de contribución
```

Una explicación técnica más amplia está en
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Contribuir

Las contribuciones son bienvenidas: correcciones, traducciones, pruebas en otros
sistemas, documentación y mejoras de accesibilidad.

1. Lee [`CONTRIBUTING.md`](CONTRIBUTING.md).
2. Respeta el [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
3. Firma tus commits con `git commit -s` (Developer Certificate of Origin).
4. No incluyas datos con derechos de autor ni claves de API.

Para vulnerabilidades, usa el canal privado descrito en [`SECURITY.md`](SECURITY.md).

## Licencia y marca

- **Código:** [MIT](LICENSE). Puedes usar, modificar, distribuir y vender el
  software, conservando el aviso de copyright.
- **Nombre, logotipo e identidad visual:** no están cubiertos por la licencia MIT.
  Si publicas una versión modificada, usa otro nombre y otro icono. Ver
  [`TRADEMARKS.md`](TRADEMARKS.md).
- **Dependencias y recursos de terceros:** ver
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Agradecimientos

A las comunidades de Tauri, Rust, React, foliate-js, PDF.js, Citation Style
Language y a los proyectos de datos bíblicos de dominio público que hacen posible
este tipo de herramientas. Y a todas las personas que prueben, reporten y
mejoren Minelly.

---

<details>
<summary>English summary</summary>

**Minelly** is an original, local-first Bible study desktop app built with Tauri
2, Rust, React, and TypeScript. It imports the user's own e-Sword, MySword, EPUB,
DOCX, and PDF modules; no copyrighted Bible translations or commentaries are
bundled. The source code is released under the MIT License. See
[`docs/BUILD.md`](docs/BUILD.md) to build it and [`docs/DATA.md`](docs/DATA.md)
for the data and copyright policy.

</details>
