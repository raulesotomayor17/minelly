#!/usr/bin/env bash
set -euo pipefail

# Compila Teoamoxtli para Fedora.
# Uso: ./build-fedora.sh [rpm|appimage|rpm,appimage]
# Requiere Fedora (dnf) y permisos sudo para instalar dependencias.

cd "$(dirname "$0")"
BUNDLES="${1:-rpm}"

if ! command -v dnf >/dev/null 2>&1; then
  echo "Este script debe ejecutarse en Fedora (dnf no está disponible)." >&2
  exit 1
fi

sudo dnf install -y \
  gcc gcc-c++ make cmake pkgconf-pkg-config \
  openssl-devel curl wget file patchelf \
  webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel \
  rpm-build nodejs npm espeak-ng

if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

npm ci
npm run tauri build -- --bundles "$BUNDLES"

echo
echo "Paquetes generados:"
find src-tauri/target/release/bundle -maxdepth 3 -type f \
  \( -name '*.rpm' -o -name '*.AppImage' \) -print 2>/dev/null || true
