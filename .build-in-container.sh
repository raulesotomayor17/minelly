#!/usr/bin/env bash
# Compila el RPM de Teoamoxtli dentro del contenedor Fedora 43.
set -o pipefail
export CARGO_TERM_COLOR=never
export CI=true

echo "== npm ci =="
if ! npm ci > /src/npm-ci.log 2>&1; then
  echo "NPM_CI_FAILED"
  tail -60 /src/npm-ci.log
  exit 1
fi
echo "== npm ci OK =="

echo "== tauri build --bundles rpm =="
npm run tauri build -- --bundles rpm 2>&1 | tee /src/build.log
rc=${PIPESTATUS[0]}
echo "TAURI_EXIT=$rc"
exit "$rc"
