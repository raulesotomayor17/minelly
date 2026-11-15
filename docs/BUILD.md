# Compilar Minelly

Esta guía cubre el desarrollo y la creación de binarios/instaladores en Linux,
Windows y macOS. Para contribuir, empieza por [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Requisitos comunes

- **Node.js 22+** (recomendado 24, que es lo que usa el CI).
- **Rust estable** (`rustup`).
- **Tauri 2** y sus dependencias de sistema.
- **Git**.

Comprueba las versiones:

```bash
node --version
npm --version
rustc --version
cargo --version
```

## Fedora

Instala las dependencias nativas:

```bash
sudo dnf install -y \
  gcc gcc-c++ make cmake pkgconf-pkg-config \
  openssl-devel curl wget file patchelf \
  webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
  librsvg2-devel libxdo-devel rpm-build espeak-ng
```

Si no tienes Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

Después:

```bash
npm ci
npm run tauri dev          # desarrollo con recarga
npm run tauri build        # binario + paquetes para tu sistema
```

El resultado queda en `src-tauri/target/release/bundle/`. Para generar solo el
binario, sin instaladores:

```bash
npm run tauri build -- --no-bundle
```

### Fedora con contenedor

El repositorio incluye `packaging/fedora44.Dockerfile` y
`packaging/README.md` para compilar en un contenedor Podman. Es la vía
recomendada si no quieres instalar las dependencias en el sistema:

```bash
podman build -t localhost/minelly-f44-builder -f packaging/fedora44.Dockerfile .
podman run --rm -v "$PWD:/workspace:Z" -w /workspace \
  localhost/minelly-f44-builder \
  bash -lc 'export PATH="/root/.cargo/bin:$PATH"; npm ci; npm run tauri build -- --bundles rpm'
```

## Ubuntu / Debian

En Ubuntu 24.04 o Debian 13:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  espeak-ng
```

Luego:

```bash
npm ci
npm run tauri build
```

> En Ubuntu 22.04, `libwebkit2gtk-4.1-dev` no está en los repositorios
> estándar. Usa Ubuntu 24.04, un PPA o compila WebKitGTK; el CI usa 24.04.

## Windows

1. Instala **Microsoft C++ Build Tools** con el SDK de Windows.
2. Instala **Rust** con el toolchain `stable-x86_64-pc-windows-msvc`.
3. Instala **Node.js 22+**.
4. Asegúrate de tener **WebView2** (Windows 11 lo incluye).
5. Opcional: **NSIS** para el instalador `.exe`.

En PowerShell:

```powershell
npm ci
npm run tauri dev
npm run tauri build
```

Los artefactos quedan en `src-tauri\target\release\bundle\`.

## macOS

Instala Xcode Command Line Tools:

```bash
xcode-select --install
```

Instala Rust y Node, y compila:

```bash
npm ci
npm run tauri build
```

Para distribuir fuera de tu equipo necesitarás firma y notarización de Apple.

## Paquetes de datos opcionales

La compilación por defecto **no** requiere datos bíblicos. La app arranca con un
catálogo vacío y puedes importar tus módulos desde la interfaz.

Si quieres crear una edición con datos incluidos, genera los paquetes y usa una
configuración de empaquetado que los declare:

```bash
# 1. Estudio de palabra (requiere las fuentes descritas en scripts/build_wordstudy.py)
python3 scripts/build_wordstudy.py /ruta/a/fuentes /tmp/wordstudy.sqlite
gzip -9 -c /tmp/wordstudy.sqlite > src-tauri/resources/wordstudy.sqlite.gz

# 2. Interlineal de fábrica (requiere un catálogo propio con RVR1960 y léxicos)
python3 scripts/build_factory_interlinear.py /ruta/a/catalog.sqlite \
  src-tauri/resources/interlinear_factory.sqlite.gz
```

Después:

```bash
npm run tauri build -- --config src-tauri/tauri.bundle.example.json
```

`src-tauri/tauri.bundle.example.json` es una plantilla. Revisa
[`DATA.md`](DATA.md) antes de distribuir el resultado: las traducciones,
comentarios y la BHS tienen derechos de autor y no se pueden redistribuir sin
permiso.

## CI

- `.github/workflows/build.yml`: compila en Windows, Ubuntu 24.04, macOS y
  Fedora 44 con `--no-bundle`.
- `.github/workflows/fedora.yml`: compila un RPM en `fedora:44` y lo sube como
  artefacto. Se lanza manualmente porque empaquetar un RPM en cada push es más
  lento y no siempre es necesario.

Los workflows no incluyen datos ni instaladores firmados.

## Problemas frecuentes

### `cargo: orden no encontrada`

Añade Cargo al `PATH`:

```bash
source "$HOME/.cargo/env"
```

### `webkit2gtk-4.1` no encontrado

Instala `libwebkit2gtk-4.1-dev` (Ubuntu 24.04) o `webkit2gtk4.1-devel` (Fedora).

### `npm ci` falla por el lockfile

No mezcles `npm install` y `npm ci` en la misma rama sin actualizar
`package-lock.json`. Si cambias dependencias:

```bash
npm install
npm run build
git add package.json package-lock.json
```

### El bundle falla porque faltan `resources/*.sqlite.gz`

La configuración por defecto ya no los exige. Si usas
`tauri.bundle.example.json`, genera los archivos o elimina esas entradas.

### La ventana queda en blanco en modo release

Comprueba que `dist/` se generó (`npm run build`) y que compilas con la feature
`custom-protocol` (está activa por defecto en `src-tauri/Cargo.toml`).

### La lectura TTS no funciona en Linux

Instala `espeak-ng`:

```bash
sudo dnf install espeak-ng
# o
sudo apt install espeak-ng
```
