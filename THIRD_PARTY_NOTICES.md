# Avisos de terceros

Minelly incluye o utiliza los siguientes componentes de terceros. Cada uno
conserva su licencia y sus titulares. Esta lista no sustituye los textos
completos que acompañan a cada paquete.

## Código incluido en el repositorio

| Componente | Ubicación | Licencia | Titular |
| --- | --- | --- | --- |
| **foliate-js** | `src/vendor/foliate-js/` | MIT | Copyright © 2022 John Factotum |
| **PDF.js** | `src/vendor/foliate-js/vendor/pdfjs/` | Apache-2.0 | Copyright © Mozilla Foundation |
| **Estilos CSL** (APA, Chicago, SBL) | `src/csl/` | CC BY-SA 3.0 | Citation Style Language contributors; cada archivo incluye su atribución en `<info>` |

El texto completo de la licencia MIT de foliate-js está en
`src/vendor/foliate-js/LICENSE`. Los archivos de PDF.js conservan su cabecera
Apache-2.0; el texto de la licencia está disponible en
<https://www.apache.org/licenses/LICENSE-2.0>. Los estilos CSL conservan su
bloque `<rights>` con el enlace a
<https://creativecommons.org/licenses/by-sa/3.0/>.

## Fuentes

Las fuentes se instalan como dependencias de `@fontsource` y se distribuyen bajo
la **SIL Open Font License 1.1 (OFL-1.1)**:

| Fuente | Paquete | Titular |
| --- | --- | --- |
| Literata | `@fontsource/literata` | The Literata Project Authors |
| Crimson Pro | `@fontsource/crimson-pro` | The Crimson Pro Project Authors |
| Cormorant Garamond | `@fontsource/cormorant-garamond` | The Cormorant Project Authors |
| Libre Baskerville | `@fontsource/libre-baskerville` | The Libre Baskerville Project Authors |
| Inter | `@fontsource/inter` | The Inter Project Authors |

El texto de la OFL-1.1 y los avisos de cada fuente están en los paquetes
correspondientes de `node_modules/@fontsource/*/LICENSE`. Quien distribuya un
binario debe incluir esos avisos.

## Dependencias de la aplicación

El resto de dependencias se declaran en `package.json`, `package-lock.json` y
`src-tauri/Cargo.toml` / `Cargo.lock`. Entre ellas:

- **Tauri** (MIT / Apache-2.0), **React** (MIT), **React DOM** (MIT).
- **dockview** (MIT), **Zustand** (MIT), **TipTap** (MIT).
- **citation-js** (MIT), **rusqlite** (MIT), **serde** (MIT / Apache-2.0),
  **reqwest** (MIT / Apache-2.0), **image** (MIT / Apache-2.0), **zip** (MIT),
  **flate2** (MIT / Apache-2.0), **ammonia** (MIT), **regex** (MIT / Apache-2.0).

Las licencias completas están en los paquetes descargados por npm y Cargo. Antes
de publicar un instalador, genera un inventario de licencias (`cargo about`,
`license-checker` o equivalente) e inclúyelo en el artefacto.

## Datos bíblicos y académicos

El repositorio **no distribuye** bases de datos bíblicas ni módulos de terceros.
Los scripts de `scripts/` pueden generar paquetes a partir de fuentes que el
usuario aporte. Esas fuentes tienen sus propias licencias; consulta
[`docs/DATA.md`](docs/DATA.md) antes de redistribuir cualquier resultado.

En particular, el archivo `wordstudy.sqlite.gz` que se genera con
`scripts/build_wordstudy.py` combina datos con distintos regímenes:

- **Strong's Greek Dictionary** (`morphgnt/strongs-dictionary-xml`): CC0.
- **Tischendorf 8th Greek New Testament**: dominio público.
- **Biblia Hebraica Stuttgartensia (BHS)**: texto © 1977/1997 Deutsche
  Bibelgesellschaft; las anotaciones y la mappings de números Strong tienen sus
  propias condiciones (CC BY en el proyecto de origen).

Por eso el repositorio no incluye ese archivo. Si lo generas y lo distribuyes,
debes verificar los derechos aplicables en tu jurisdicción.

## Marcas

Las marcas mencionadas en la documentación pertenecen a sus titulares. Ver
[`TRADEMARKS.md`](TRADEMARKS.md).

## Cómo reportar un problema de licencia

Abre un *issue* indicando el componente, la versión y el derecho que consideras
afectado. No publiques el contenido completo de una obra protegida; basta con
la referencia.
