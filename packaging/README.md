# Empaquetado

Los instaladores, binarios y paquetes de datos **no se guardan en Git**. Esta
carpeta solo contiene las recetas para generarlos. Antes de distribuir una
edición con Biblias o comentarios, lee [`../docs/DATA.md`](../docs/DATA.md).

## Fedora 44 (RPM)

```bash
podman build -t localhost/minelly-f44-builder -f packaging/fedora44.Dockerfile .
podman run --rm -v "$PWD:/workspace:Z" -w /workspace \
  localhost/minelly-f44-builder \
  bash -lc 'export PATH="/root/.cargo/bin:$PATH"; npm ci; npm run tauri build -- --bundles rpm'
```

Salida: `src-tauri/target/release/bundle/rpm/`.

## Windows 11 x64 (NSIS)

Primero construye la imagen base de Fedora 44 de la sección anterior. Después:

```bash
podman build -t localhost/minelly-win-builder -f packaging/windows.Dockerfile .
podman run --rm -v "$PWD:/workspace:Z" -v "$PWD/.xwin-cache:/xwin-cache:Z" \
  -e XWIN_CACHE_DIR=/xwin-cache -w /workspace \
  localhost/minelly-win-builder \
  bash -lc 'export PATH="/root/.cargo/bin:$PATH"; npm ci; node_modules/.bin/tauri build --target x86_64-pc-windows-msvc --runner /usr/local/bin/cargo-xwin-run --bundles nsis --no-sign'
```

Salida: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

El ejecutable es `minelly.exe`. El instalador es `currentUser`, instala en
`%LOCALAPPDATA%\Minelly` y usa `downloadBootstrapper` para WebView2. Los
artefactos no están firmados.

`packaging/windows/installer.nsi` es una plantilla NSIS antigua que se conserva
como referencia. La vía recomendada es el empaquetado NSIS de Tauri.

## Datos opcionales

Si quieres incluir `wordstudy.sqlite.gz` o `interlinear_factory.sqlite.gz`,
genéralos y usa `src-tauri/tauri.bundle.example.json` como se explica en
[`../docs/BUILD.md`](../docs/BUILD.md). No los subas al repositorio.
