# Contribuir a Minelly

Gracias por querer mejorar Minelly. Este documento explica cómo reportar fallos,
proponer funciones y enviar cambios sin romper el proyecto ni los derechos de
terceros.

## Antes de empezar

- Busca en los *issues* abiertos y cerrados para no duplicar trabajo.
- Para cambios grandes (nuevo módulo, cambio de esquema, nueva dependencia),
  abre primero un *issue* de propuesta y espera una respuesta.
- Lee el [Código de Conducta](CODE_OF_CONDUCT.md).
- No publiques datos con derechos de autor, claves de API, rutas personales ni
  capturas con texto bíblico protegido.

## Reportar un fallo

Usa la plantilla de *bug report* e incluye:

- Sistema operativo y versión (Windows 11, Fedora 44, Ubuntu 24.04, macOS...).
- Versión de Minelly (`0.2.x`) y cómo la instalaste (código, RPM, instalador).
- Pasos concretos para reproducirlo.
- Qué esperabas y qué ocurrió.
- Registros o capturas **sin datos personales ni texto con derechos de autor**.
- Si afecta a la importación, indica el formato y el origen legal del módulo,
  pero **no adjuntes el módulo**.

## Proponer una función

Describe el problema de estudio o de accesibilidad que resuelve, no solo la
solución técnica. Si es una función de IA, explica qué datos se envían a qué
servicio y cómo se puede usar sin conexión.

## Entorno de desarrollo

Requisitos: Node.js 22+, Rust estable y las dependencias de Tauri 2 de tu
sistema. En Fedora:

```bash
sudo dnf install gcc gcc-c++ make cmake pkgconf-pkg-config \
  openssl-devel curl wget file patchelf \
  webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
  librsvg2-devel libxdo-devel espeak-ng
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Después:

```bash
git clone https://github.com/raulesotomayor17/minelly.git
cd minelly
npm ci
npm run tauri dev
```

Comprobaciones antes de enviar un *pull request*:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Si tu cambio toca el empaquetado, prueba también:

```bash
npm run tauri build -- --no-bundle
```

Las instrucciones completas por sistema están en [`docs/BUILD.md`](docs/BUILD.md).

## Pull requests

1. Haz un *fork* y crea una rama descriptiva:
   `fix/importacion-epub`, `feat/comparador-5-versiones`.
2. Mantén el cambio enfocado. Un PR debe resolver un problema o una función.
3. Añade o actualiza la documentación y, si es posible, una prueba.
4. Cuida la accesibilidad: foco visible, etiquetas, contraste y navegación por
   teclado.
5. No reformatees archivos completos si no es necesario; dificulta la revisión.
6. Firma tus commits con el *Developer Certificate of Origin*:

   ```bash
   git commit -s -m "fix: corrige el índice del lector EPUB"
   ```

   La firma añade `Signed-off-by: Tu Nombre <tu@email>` y certifica que tienes
   derecho a contribuir con ese código bajo la licencia MIT.

7. Abre el PR contra `main` y explica qué cambia, por qué y cómo lo probaste.

## Licencia de las contribuciones

Al enviar un *pull request* aceptas que tu contribución se distribuya bajo la
licencia **MIT** de este repositorio. No se requiere cesión de copyright: cada
persona conserva la autoría de su trabajo, pero concede a todos los derechos que
figuran en [`LICENSE`](LICENSE).

## Qué no aceptamos

- Módulos, textos o imágenes con derechos de autor sin permiso.
- Cambios que eludan DRM o protecciones tecnológicas.
- Claves de API, tokens o datos personales en el código, los *issues* o los
  ejemplos.
- Código copiado de proyectos con licencias incompatibles.
- Funciones que envíen la biblioteca del usuario a un servicio externo sin
  consentimiento explícito y documentado.

## Traducciones y documentación

La interfaz está en español y tiene textos en inglés en
`src/i18n.en.ts`. Las traducciones son bienvenidas. Para la documentación,
prefiere español claro y enlaces relativos; si añades una guía nueva, enlázala
desde el README.

## Contacto

Para dudas de contribución, abre un *issue* con la etiqueta `question`. Para
seguridad, usa el canal privado de [`SECURITY.md`](SECURITY.md).
