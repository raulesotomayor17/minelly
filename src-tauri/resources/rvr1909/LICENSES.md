# Edición RVR1909

Esta edición incluye datos empaquetados:

- **Reina-Valera 1909** (`mysword:rvr1909.bbl.mybible`).
- **Interlineal hebreo/griego** con tokens, números Strong, morfología,
  transliteración y léxico de apoyo.

No incluye NTV, RVR1960, RVA2015, LBLA, comentarios, diccionarios editoriales ni
libros de terceros.

## Atribución y licencias

- **Reina-Valera 1909:** se distribuye como texto de dominio público. Verifica
  el régimen aplicable en los países donde se comparta esta edición; el dominio
  público no es idéntico en todas las jurisdicciones.
- **STEPBible TAGNT/TAHOT:** © STEPBible.org / Tyndale House Cambridge,
  licencia **CC BY 4.0**. Se incluyen atribución y enlace en la release.
- **Strong's Greek Dictionary** (`morphgnt/strongs-dictionary-xml`): CC0.
- **Tischendorf 8th Greek New Testament:** dominio público.
- **BHS-Strong-no / ETCBC:** anotaciones bajo **CC BY**; el texto de la Biblia
  Hebraica Stuttgartensia es © 1977/1997 Deutsche Bibelgesellschaft. Revisa los
  derechos aplicables antes de redistribuir esta edición en tu jurisdicción.
- **STEPBible Lexicon:** © STEPBible.org / Tyndale House Cambridge, **CC BY 4.0**.
  Se incluye como apoyo léxico del interlineal, con atribución.
- **Strong-PLUS no se incluye** en esta edición: su licencia es CC BY-NC-ND y
  está limitada a uso personal, por lo que no se redistribuye.

## Compilar

```bash
npm ci
npm run tauri build -- --config src-tauri/tauri.rvr1909.json --bundles rpm
```

En Windows:

```powershell
npm ci
npm run tauri build -- --config src-tauri/tauri.rvr1909.json --bundles nsis
```

El identificador `com.minelly.rvr1909` usa una carpeta de datos distinta de la
edición general, para no heredar catálogos antiguos.

## Aviso

Esta es una edición separada de la release de código. Si distribuyes el
instalador, conserva este archivo de atribuciones y no añadas Biblias,
comentarios o libros que no tengas derecho a distribuir.
