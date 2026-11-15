# Datos, derechos de autor y licencias

> **Aviso:** este documento es información general, no asesoramiento jurídico
> personalizado. Las leyes cambian por país y dependen de los hechos. Antes de
> publicar una biblioteca, un instalador o una captura, consulta a un abogado
> especializado en propiedad intelectual en tu jurisdicción.

Minelly es un **lector**. El repositorio no incluye Biblias, comentarios,
diccionarios, libros ni bases de datos derivadas de obras protegidas. Tú aportas
los módulos y eres responsable de tener derecho a usarlos y, sobre todo, a
redistribuirlos.

## Lo que sí incluye el repositorio

- Código fuente original bajo licencia MIT.
- Documentación y diseño original.
- Scripts para **generar** paquetes de datos a partir de fuentes que tú aportes.
- Avisos de terceros y textos de licencia de componentes incluidos.

## Lo que no incluye

- Traducciones de la Biblia (NTV, RVR1960, RVA2015, etc.).
- Comentarios (MacArthur, Mundo Hispano, JFB, etc.).
- Diccionarios y léxicos con derechos de autor.
- Libros EPUB, DOCX o PDF de terceros.
- `wordstudy.sqlite.gz`, `interlinear_factory.sqlite.gz`,
  `clean_catalog.sqlite.gz` ni `premium_catalog.sqlite.gz`.
- Instaladores o binarios.

El `.gitignore` excluye `data/`, `Recursos para biblioteca/`, `capturas/`,
`src-tauri/resources/*.sqlite*` y los paquetes de `packaging/windows/payload/`.
No los fuerces con `git add -f`.

## Traducciones de la Biblia

La mayoría de las traducciones modernas están protegidas por derechos de autor,
aunque el texto bíblico original sea de dominio público. Los derechos suelen
incluir la reproducción, la distribución y la adaptación. Ejemplos habituales:

- **NTV** (Nueva Traducción Viviente): © Biblica / Tyndale.
- **RVR1960**: © Sociedades Bíblicas Unidas.
- **RVA2015**: © Biblica.
- **LBLA / NBLA**: © Lockman Foundation.
- **DHH**: © Sociedades Bíblicas Unidas.

Los titulares suelen permitir citas breves con atribución, pero **no** permiten
distribuir el texto completo ni integrarlo en una base de datos pública. Una
cita en una nota personal es distinta de empaquetar la traducción completa en un
instalador.

### Dominio público

Algunas traducciones antiguas pueden estar en dominio público en tu país (por
ejemplo, la Reina-Valera 1909 en varias jurisdicciones), pero el régimen cambia
según la fecha de fallecimiento de los autores, las traducciones y las leyes
locales. Verifica cada caso; no asumas que «1909» significa automáticamente
dominio público en todo el mundo.

### Módulos e-Sword y MySword

Los formatos `.bbli`, `.cmti`, `.dcti`, `.bbl.mybible`, etc. son contenedores.
La licencia la determina **el contenido**, no el formato. Un módulo gratuito no
es necesariamente libre: puede permitir uso personal pero prohibir la
redistribución. Conserva el archivo de licencia original y no lo subas al
repositorio si no tienes permiso.

## Comentarios, diccionarios y libros

Los comentarios bíblicos, diccionarios, léxicos y libros de estudio son obras
protegidas. El hecho de que los hayas comprado te da una licencia de uso
personal; no te da derecho a distribuir copias, extraer el texto y publicarlo ni
a incluirlo en una app que regalas.

Los libros EPUB/DOCX/PDF que importes pueden tener DRM o condiciones de uso.
Minelly no elude DRM. Si un archivo no se puede abrir por protección, no busques
un bypass: usa una copia legal sin DRM.

## Datos académicos del estudio de palabra

`scripts/build_wordstudy.py` genera una base a partir de:

- **morphgnt/strongs-dictionary-xml**: Strong's Greek Dictionary, CC0.
- **morphgnt/tischendorf**: Tischendorf 8th Greek New Testament, dominio
  público.
- **eliranwong/BHS-Strong-no**: mapping de números Strong sobre la **Biblia
  Hebraica Stuttgartensia (BHS)**. El texto BHS es © 1977/1997 Deutsche
  Bibelgesellschaft; las anotaciones y el proyecto de origen tienen sus propias
  condiciones (CC BY, ETCBC/Open Hebrew Bible).

La base generada contiene entradas y ocurrencias de palabras. Aunque no
reproduzca el archivo original completo, puede incluir texto derivado de la BHS.
**No la distribuyas sin verificar los derechos.** Por eso el repositorio no
incluye `wordstudy.sqlite.gz`.

El interlineal de fábrica (`scripts/build_factory_interlinear.py`) se construye
desde un catálogo propio que puede contener una traducción como RVR1960. Ese
resultado **no se puede publicar** sin permiso del titular de la traducción.

## Capturas de pantalla y demostraciones

Una captura con el texto completo de una traducción protegida puede ser una
reproducción. Para el README, los issues o una demo:

- Usa textos de dominio público verificados.
- O usa fragmentos muy breves con atribución.
- O difumina/recorta el texto y muestra solo la interfaz.
- No publiques capturas de libros o comentarios completos.

## Inteligencia artificial y contenido de terceros

El asistente de estudio puede enviar fragmentos de tu biblioteca al proveedor
que configures (por defecto, DeepSeek). Enviar una obra protegida a un servicio
externo puede constituir una reproducción, una comunicación pública o un
tratamiento de datos personales. Antes de usarlo:

- Revisa los términos y la política de privacidad del proveedor.
- No envíes contenido que no tengas derecho a usar.
- No incluyas datos personales de terceros.
- Para pruebas, usa textos de dominio público o escritos propios.

Las respuestas generadas por IA pueden ser inexactas. No sustituyen la
verificación exegética ni el consejo de una persona cualificada.

## Software de terceros

Minelly usa dependencias con licencias permisivas (MIT, Apache-2.0, OFL, etc.).
Los avisos están en [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). Si
distribuyes un binario, incluye los textos de licencia de las dependencias y de
las fuentes; no basta con el código fuente.

## Marcas y nombres

«Minelly» y su logotipo no están cubiertos por la licencia MIT. No uses el
nombre para un fork ni sugieras afiliación con Logos, Faithlife, Biblica,
Sociedades Bíblicas Unidas u otras editoriales. Ver
[`TRADEMARKS.md`](../TRADEMARKS.md).

## Checklist antes de publicar una edición con datos

1. ¿Tengo permiso escrito para distribuir cada traducción, comentario,
   diccionario y libro?
2. ¿La licencia permite redistribución, no solo uso personal?
3. ¿Incluyo los avisos de copyright y licencia de cada obra?
4. ¿La base de datos contiene texto completo o solo índices/metadatos?
5. ¿Las capturas y la demo usan contenido permitido?
6. ¿El instalador incluye las licencias de las fuentes y dependencias?
7. ¿He consultado a un abogado si hay dudas?

Si alguna respuesta es «no» o «no lo sé», no publiques esa edición. Es mejor
publicar el código sin datos y dejar que cada usuario importe su biblioteca.
