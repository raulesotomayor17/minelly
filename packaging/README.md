# Reproducir paquetes

## Fedora 44

```bash
podman build -t localhost/teoamoxtli-f44-builder -f packaging/fedora44.Dockerfile .
podman run --rm -v "$PWD:/workspace:Z" -w /workspace \
  localhost/teoamoxtli-f44-builder \
  bash -lc 'export PATH="/root/.cargo/bin:$PATH"; npm run tauri build -- --bundles rpm'
```

Salida: `src-tauri/target/release/bundle/rpm/`.

## Windows 11 x64

```bash
podman build -t localhost/teoamoxtli-win-builder -f packaging/windows.Dockerfile .
podman run --rm -v "$PWD:/workspace:Z" -v "$PWD/.xwin-cache:/xwin-cache:Z" \
  -e XWIN_CACHE_DIR=/xwin-cache -w /workspace \
  localhost/teoamoxtli-win-builder \
  bash -lc 'export PATH="/root/.cargo/bin:$PATH"; node_modules/.bin/tauri build --target x86_64-pc-windows-msvc --runner /usr/local/bin/cargo-xwin-run --bundles nsis --no-sign'
```

El instalador oficial queda en
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.
El ZIP portable se arma con `teoamoxtli.exe` y `resources/wordstudy.sqlite.gz`.
El instalador es `currentUser`, instala en `%LOCALAPPDATA%\Teoamoxtli` y usa
`downloadBootstrapper` para WebView2. Los artefactos no están firmados.
